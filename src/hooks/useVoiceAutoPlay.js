import { useEffect, useRef, useCallback } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
import { Platform } from 'react-native';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import Toast from 'react-native-toast-message';

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
  const soundRef = useRef(null);
  const playedIdsRef = useRef(new Set());

  const stopCurrentSound = useCallback(async () => {
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); } catch {}
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  }, []);

  const playAudio = useCallback(async (url, msgId) => {
    // Prevent duplicate plays
    if (playedIdsRef.current.has(msgId)) return;
    playedIdsRef.current.add(msgId);

    // Keep set small
    if (playedIdsRef.current.size > 100) {
      const arr = [...playedIdsRef.current];
      playedIdsRef.current = new Set(arr.slice(-50));
    }

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

      Toast.show({
        type: 'info',
        text1: '🎙️ Mensaje de la base',
        text2: 'Reproduciendo audio...',
        visibilityTime: 2000,
      });
    } catch (err) {
      console.error('Error auto-playing voice:', err);
      // Clean up on error
      if (soundRef.current) {
        try { await soundRef.current.unloadAsync(); } catch {}
        soundRef.current = null;
      }
    }
  }, [stopCurrentSound]);

  useEffect(() => {
    if (!driverId) return;

    channelRef.current = supabase
      .channel(`voice_autoplay_${driverId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'voice_messages',
        filter: `driver_id=eq.${driverId}`,
      }, (payload) => {
        const msg = payload.new;
        if (msg.sender_type === 'base' && msg.audio_url) {
          playAudio(msg.audio_url, msg.id);
        }
      })
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      stopCurrentSound();
    };
  }, [driverId, playAudio, stopCurrentSound]);
}
