import { useState, useEffect, useRef, useCallback } from 'react';
import {
  useAudioPlayer,
  useAudioRecorder,
  AudioModule,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { mergeVoiceMessage, mergeVoiceMessages } from '../lib/voiceMessages';
import { insertDriverVoiceMessage } from '../services/voiceMessageSend';
import Toast from 'react-native-toast-message';

export function useVoiceChat({ enabled = true } = {}) {
  const { driver } = useAuthStore();
  const [messages, setMessages] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const channelRef = useRef(null);
  const hasLoadedRef = useRef(false);
  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const driverId = driver?.id;

  const fetchMessages = useCallback(async () => {
    if (!driverId) return;
    // Solo spinner en la primera carga; reabrir el historial no titila.
    if (!hasLoadedRef.current) setLoading(true);
    try {
      const { data, error } = await supabase
        .from('voice_messages')
        .select('*')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: true })
        .limit(50);
      if (!error) {
        setMessages((prev) => mergeVoiceMessages(prev, data || []));
        hasLoadedRef.current = true;
      }
    } catch (err) {
      console.error('Error fetching voice messages:', err);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  useEffect(() => {
    if (!driverId || !enabled) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return undefined;
    }

    fetchMessages();
    const pollId = setInterval(() => {
      fetchMessages();
    }, 4000);

    const channel = supabase
      .channel(`voice_driver_${driverId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'voice_messages',
        filter: `driver_id=eq.${driverId}`,
      }, (payload) => {
        const msg = payload.new;
        setMessages((prev) => mergeVoiceMessage(prev, msg));
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      clearInterval(pollId);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [driverId, enabled, fetchMessages]);

  const playAudio = useCallback(async (url) => {
    if (!url) return;
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        interruptionModeAndroid: 'duckOthers',
        shouldDuckAndroid: true,
        playThroughEarpieceAndroid: false,
        allowsRecording: false,
      });

      await new Promise((resolve, reject) => {
        let settled = false;
        let timeoutId = null;
        const finish = (fn, arg) => {
          if (settled) return;
          settled = true;
          if (timeoutId) clearTimeout(timeoutId);
          try { player.removeListener('playbackStatusUpdate', onStatus); } catch { /* ignore */ }
          fn(arg);
        };
        const onStatus = (status) => {
          if (status?.isLoaded) finish(resolve);
        };
        player.addListener('playbackStatusUpdate', onStatus);
        player.replace({ uri: url });
        if (player.isLoaded) {
          finish(resolve);
          return;
        }
        timeoutId = setTimeout(() => {
          if (player.isLoaded) finish(resolve);
          else finish(reject, new Error('Timeout cargando audio'));
        }, 10000);
      });

      player.play();
    } catch (err) {
      console.error('Error playing audio:', err);
      Toast.show({ type: 'error', text1: 'No se pudo reproducir el audio' });
    }
  }, [player]);

  const startRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Toast.show({ type: 'error', text1: 'Permiso de micrófono requerido' });
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
      setRecordingTime(0);
      if (timerRef.current) clearInterval(timerRef.current);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
      Toast.show({ type: 'error', text1: 'Error al grabar', text2: 'No se pudo iniciar la grabación' });
    }
  }, [recorder]);

  const cancelRecording = useCallback(async () => {
    try { await recorder.stop(); } catch { /* ignore */ }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setRecordingTime(0);
  }, [recorder]);

  const sendRecording = useCallback(async () => {
    if (!driverId) return;

    if (timerRef.current) clearInterval(timerRef.current);
    const duration = recordingTime;
    setRecording(false);
    setSending(true);

    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) throw new Error('No recording URI');

      // arrayBuffer es más fiable en RN que blob vacío en Android.
      const resp = await fetch(uri);
      const arrayBuffer = await resp.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength < 32) {
        throw new Error('El audio quedó vacío. Grabá de nuevo.');
      }

      const fileName = `${driverId}/driver-${Date.now()}.m4a`;
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(fileName, arrayBuffer, { contentType: 'audio/mp4', upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('voice-messages').getPublicUrl(fileName);

      const inserted = await insertDriverVoiceMessage({
        driverId,
        audioUrl: urlData.publicUrl,
        durationSeconds: duration,
      });
      if (inserted) {
        setMessages((prev) => mergeVoiceMessage(prev, inserted));
      }

      Toast.show({ type: 'success', text1: 'Mensaje enviado', visibilityTime: 1500 });
    } catch (err) {
      console.error('Error sending voice:', err);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: err?.message || 'No se pudo enviar el audio',
      });
    } finally {
      setSending(false);
      setRecordingTime(0);
    }
  }, [driverId, recordingTime, recorder]);

  return {
    messages,
    recording,
    recordingTime,
    sending,
    loading,
    startRecording,
    cancelRecording,
    sendRecording,
    playAudio,
    fetchMessages,
  };
}
