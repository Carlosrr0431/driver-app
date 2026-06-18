import { useState, useEffect, useRef, useCallback } from 'react';
import { useAudioPlayer, useAudioRecorder, AudioModule, setAudioModeAsync, RecordingPresets } from 'expo-audio';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import Toast from 'react-native-toast-message';

export function useVoiceChat() {
  const { driver } = useAuthStore();
  const [messages, setMessages] = useState([]);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const timerRef = useRef(null);
  const channelRef = useRef(null);
  const player = useAudioPlayer(null);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const driverId = driver?.id;

  // Fetch existing messages
  const fetchMessages = useCallback(async () => {
    if (!driverId) return;
    try {
      const { data, error } = await supabase
        .from('voice_messages')
        .select('*')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: true })
        .limit(50);
      if (!error) setMessages(data || []);
    } catch (err) {
      console.error('Error fetching voice messages:', err);
    } finally {
      setLoading(false);
    }
  }, [driverId]);

  // Subscribe to new voice messages
  useEffect(() => {
    if (!driverId) return;
    fetchMessages();

    channelRef.current = supabase
      .channel(`voice_driver_${driverId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'voice_messages',
        filter: `driver_id=eq.${driverId}`,
      }, async (payload) => {
        const msg = payload.new;
        setMessages((prev) => [...prev, msg]);
      })
      .subscribe();

    return () => {
      if (channelRef.current) supabase.removeChannel(channelRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [driverId, fetchMessages]);

  const playAudio = async (url) => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        interruptionMode: 'duckOthers',
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
        allowsRecording: false,
      });
      player.replace({ uri: url });
      player.play();
    } catch (err) {
      console.error('Error playing audio:', err);
    }
  };

  const startRecording = async () => {
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
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
      Toast.show({ type: 'error', text1: 'Error al grabar', text2: 'No se pudo iniciar la grabación' });
    }
  };

  const cancelRecording = async () => {
    try { await recorder.stop(); } catch {}
    setRecording(false);
    clearInterval(timerRef.current);
    setRecordingTime(0);
  };

  const sendRecording = async () => {
    if (!driverId) return;

    clearInterval(timerRef.current);
    const duration = recordingTime;
    setRecording(false);
    setSending(true);

    try {
      await recorder.stop();
      const uri = recorder.uri;

      if (!uri) throw new Error('No recording URI');

      // Read local file as blob
      const resp = await fetch(uri);
      const blob = await resp.blob();

      const fileName = `${driverId}/driver-${Date.now()}.m4a`;
      const { error: uploadError } = await supabase.storage
        .from('voice-messages')
        .upload(fileName, blob, { contentType: 'audio/m4a', upsert: true });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('voice-messages').getPublicUrl(fileName);

      const { error: insertError } = await supabase
        .from('voice_messages')
        .insert({
          driver_id: driverId,
          sender_type: 'driver',
          audio_url: urlData.publicUrl,
          duration_seconds: duration,
        });
      if (insertError) throw insertError;

      Toast.show({ type: 'success', text1: 'Mensaje enviado', visibilityTime: 1500 });
    } catch (err) {
      console.error('Error sending voice:', err);
      Toast.show({ type: 'error', text1: 'Error', text2: 'No se pudo enviar el audio' });
    } finally {
      setSending(false);
      setRecordingTime(0);
    }
  };

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
