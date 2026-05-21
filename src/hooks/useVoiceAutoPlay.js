import { useEffect, useRef, useCallback } from 'react';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { AppState } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import Toast from 'react-native-toast-message';

const VOICE_AUTOPLAY_POLL_MS = 3000;
const VOICE_AUTOPLAY_RECENT_WINDOW_MS = 45 * 60 * 1000;
const MAX_PLAYED_IDS_CACHE = 160;

/**
 * Hook que hace polling cada 3s para reproducir automáticamente
 * mensajes de voz de la base. Usa expo-audio (SDK 54).
 */
export function useVoiceAutoPlay() {
  const { driver } = useAuthStore();
  const driverId = driver?.id;
  const pollRef = useRef(null);
  const isSyncingRef = useRef(false);
  const playedIdsRef = useRef(new Set());
  const currentUrlRef = useRef(null);
  const player = useAudioPlayer(null);

  const rememberPlayedId = useCallback((msgId) => {
    if (!msgId) return;
    playedIdsRef.current.add(msgId);
    if (playedIdsRef.current.size > MAX_PLAYED_IDS_CACHE) {
      const keep = [...playedIdsRef.current].slice(-Math.floor(MAX_PLAYED_IDS_CACHE / 2));
      playedIdsRef.current = new Set(keep);
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
    } catch {}
  }, [driverId]);

  const playAudio = useCallback(async (url, msgId) => {
    if (!url || !msgId) return false;
    if (playedIdsRef.current.has(msgId)) return false;
    rememberPlayedId(msgId);

    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        interruptionModeAndroid: 'duckOthers',
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
        allowsRecording: false,
      });

      currentUrlRef.current = url;
      player.replace({ uri: url });
      player.play();

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
      return false;
    }
  }, [player, markAsPlayed, rememberPlayedId]);

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
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) return;

      for (const msg of (data || [])) {
        if (!msg?.id) continue;
        if (playedIdsRef.current.has(msg.id)) continue;
        if (msg.is_played === true) {
          rememberPlayedId(msg.id);
          continue;
        }
        if (msg.sender_type !== 'base' || !msg.audio_url) continue;
        const played = await playAudio(msg.audio_url, msg.id);
        if (played) break;
      }
    } finally {
      isSyncingRef.current = false;
    }
  }, [driverId, playAudio, rememberPlayedId]);

  useEffect(() => {
    if (!driverId) return;

    syncPendingBaseMessages();

    pollRef.current = setInterval(syncPendingBaseMessages, VOICE_AUTOPLAY_POLL_MS);

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncPendingBaseMessages();
    });

    return () => {
      clearInterval(pollRef.current);
      pollRef.current = null;
      appStateSub.remove();
    };
  }, [driverId, syncPendingBaseMessages]);
}
