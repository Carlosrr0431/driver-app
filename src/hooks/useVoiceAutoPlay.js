import { useEffect, useRef, useCallback } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { AppState } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import Toast from 'react-native-toast-message';

const VOICE_AUTOPLAY_POLL_MS = 7000;
const VOICE_AUTOPLAY_RECENT_WINDOW_MS = 45 * 60 * 1000;
const MAX_PLAYED_IDS_CACHE = 160;

/**
 * Lightweight hook that subscribes to voice_messages in realtime
 * and auto-plays any incoming message from base.
 * Should be mounted once at HomeScreen level so it works
 * even when VoiceChatModal is closed.
 */
export function useVoiceAutoPlay() {
  const { driver } = useAuthStore();
  const driverId = driver?.id;
  const channelRef = useRef(null);
  const pollRef = useRef(null);
  const soundRef = useRef(null);
  const isSyncingRef = useRef(false);
  const playedIdsRef = useRef(new Set());

  const rememberPlayedId = useCallback((msgId) => {
    if (!msgId) return;
    playedIdsRef.current.add(msgId);

    if (playedIdsRef.current.size > MAX_PLAYED_IDS_CACHE) {
      const keep = [...playedIdsRef.current].slice(-Math.floor(MAX_PLAYED_IDS_CACHE / 2));
      playedIdsRef.current = new Set(keep);
    }
  }, []);

  const hasPlayedId = useCallback((msgId) => {
    if (!msgId) return false;
    return playedIdsRef.current.has(msgId);
  }, []);

  const stopCurrentSound = useCallback(async () => {
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  }, []);

  const markAsPlayed = useCallback(async (msgId) => {
    if (!driverId || !msgId) return;
    try {
      await supabase
        .from('voice_messages')
        .update({ is_played: true })
        .eq('id', msgId)
        .eq('driver_id', driverId);
    } catch (err) {
      console.warn('Error marking voice message as played:', err?.message || err);
    }
  }, [driverId]);

  const playAudio = useCallback(async (url, msgId) => {
    if (!url || !msgId || hasPlayedId(msgId)) return false;
    rememberPlayedId(msgId);

    try {
      await stopCurrentSound();

      // Configure audio for speaker output at full volume
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const { sound } = await Audio.Sound.createAsync(
        { uri: url },
        { shouldPlay: false, volume: 1.0 }
      );
      soundRef.current = sound;

      sound.setOnPlaybackStatusUpdate((status) => {
        if (status.didJustFinish) {
          sound.unloadAsync().catch(() => {});
          if (soundRef.current === sound) soundRef.current = null;
        }
      });

      // Explicitly play after loading for reliability
      await sound.playAsync();

      // Persist the played status so fallback sync doesn't replay it.
      markAsPlayed(msgId).catch(() => {});

      Toast.show({
        type: 'info',
        text1: '🎙️ Mensaje de la base',
        text2: 'Reproduciendo audio...',
        visibilityTime: 2000,
      });
      return true;
    } catch (err) {
      console.error('Error auto-playing voice:', err);
      // Clean up on error
      if (soundRef.current) {
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }
      return false;
    }
  }, [hasPlayedId, markAsPlayed, rememberPlayedId, stopCurrentSound]);

  const handleIncomingBaseMessage = useCallback(async (message) => {
    if (!message || message.sender_type !== 'base' || !message.audio_url || !message.id) return;
    await playAudio(message.audio_url, message.id);
  }, [playAudio]);

  const syncPendingBaseMessages = useCallback(async () => {
    if (!driverId || isSyncingRef.current) return;

    isSyncingRef.current = true;
    try {
      const sinceIso = new Date(Date.now() - VOICE_AUTOPLAY_RECENT_WINDOW_MS).toISOString();
      const { data, error } = await supabase
        .from('voice_messages')
        .select('id, sender_type, audio_url, created_at, is_played')
        .eq('driver_id', driverId)
        .eq('sender_type', 'base')
        .eq('is_played', false)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(5);

      if (error) {
        console.warn('Error syncing pending voice messages:', error?.message || error);
        return;
      }

      const pending = Array.isArray(data) ? data : [];
      for (const message of pending) {
        if (!message?.id) continue;
        if (hasPlayedId(message.id)) {
          markAsPlayed(message.id).catch(() => {});
          continue;
        }

        const played = await handleIncomingBaseMessage(message);
        if (played) break;
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, [driverId, handleIncomingBaseMessage, hasPlayedId, markAsPlayed]);

  useEffect(() => {
    if (!driverId) return;

    syncPendingBaseMessages();

    pollRef.current = setInterval(() => {
      syncPendingBaseMessages();
    }, VOICE_AUTOPLAY_POLL_MS);

    const appStateSub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        syncPendingBaseMessages();
      }
    });

    channelRef.current = supabase
      .channel(`voice_autoplay_${driverId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'voice_messages',
        filter: `driver_id=eq.${driverId}`,
      }, (payload) => {
        const msg = payload.new;
        handleIncomingBaseMessage(msg);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          syncPendingBaseMessages();
        }
      });

    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      appStateSub.remove();
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      stopCurrentSound();
    };
  }, [driverId, handleIncomingBaseMessage, stopCurrentSound, syncPendingBaseMessages]);
}
