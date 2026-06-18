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
 *
 * Flujo: consulta voice_messages con is_played=false, espera a que
 * el player cargue el audio (evento 'loaded'), y recién ahí llama play().
 */
export function useVoiceAutoPlay() {
  const { driver } = useAuthStore();
  const driverId = driver?.id;
  const pollRef = useRef(null);
  const isSyncingRef = useRef(false);
  const playedIdsRef = useRef(new Set());
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

  const playAudio = useCallback((url, msgId) => {
    if (!url || !msgId) return Promise.resolve(false);
    if (playedIdsRef.current.has(msgId)) return Promise.resolve(false);
    rememberPlayedId(msgId);

    return new Promise(async (resolve) => {
      let resolved = false;
      let timeoutId = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        player.removeListener('playbackStatusUpdate', onStatus);
      };

      const onStatus = (status) => {
        if (resolved) return;
        if (status.isLoaded && !status.isBuffering) {
          resolved = true;
          cleanup();
          player.play();
          markAsPlayed(msgId).catch(() => {});
          Toast.show({
            type: 'info',
            text1: '🎙️ Mensaje de la base',
            text2: 'Reproduciendo audio...',
            visibilityTime: 2000,
          });
          resolve(true);
        }
      };

      try {
        await setAudioModeAsync({
          playsInSilentMode: true,
          interruptionMode: 'duckOthers',
          interruptionModeAndroid: 'duckOthers',
          shouldDuckAndroid: false,
          playThroughEarpieceAndroid: false,
          allowsRecording: false,
        });

        player.addListener('playbackStatusUpdate', onStatus);
        player.replace({ uri: url });

        timeoutId = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          cleanup();
          if (player.isLoaded) {
            player.play();
            markAsPlayed(msgId).catch(() => {});
            resolve(true);
          } else {
            resolve(false);
          }
        }, 8000);
      } catch (err) {
        resolved = true;
        cleanup();
        console.error('Error auto-playing voice:', err);
        resolve(false);
      }
    });
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
        .eq('is_played', false)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(10);

      if (error) return;

      for (const msg of (data || [])) {
        if (!msg?.id) continue;
        if (playedIdsRef.current.has(msg.id)) continue;
        if (!msg.audio_url) continue;
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
