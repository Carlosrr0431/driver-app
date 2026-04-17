import { useState, useEffect, useRef, useCallback } from 'react';
import { Audio, InterruptionModeAndroid, InterruptionModeIOS } from 'expo-av';
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
  const recordingRef = useRef(null);
  const timerRef = useRef(null);
  const channelRef = useRef(null);
  const soundRef = useRef(null);

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
      stopSound();
    };
  }, [driverId, fetchMessages]);

  const stopSound = async () => {
    if (soundRef.current) {
      try { await soundRef.current.unloadAsync(); } catch {}
      soundRef.current = null;
    }
  };

  const playAudio = async (url) => {
    try {
      await stopSound();
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
      await sound.playAsync();
    } catch (err) {
      console.error('Error playing audio:', err);
    }
  };

  const startRecording = async () => {
    try {
      const { granted } = await Audio.requestPermissionsAsync();
      if (!granted) {
        Toast.show({ type: 'error', text1: 'Permiso de micrófono requerido' });
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
        interruptionModeIOS: InterruptionModeIOS.DuckOthers,
        interruptionModeAndroid: InterruptionModeAndroid.DuckOthers,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });

      const recordingOptions = {
        isMeteringEnabled: true,
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MAX,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 128000,
        },
        web: {
          mimeType: 'audio/webm',
          bitsPerSecond: 128000,
        },
      };

      const { recording: rec } = await Audio.Recording.createAsync(
        recordingOptions
      );
      recordingRef.current = rec;
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch (err) {
      console.error('Error starting recording:', err);
      Toast.show({ type: 'error', text1: 'Error al grabar', text2: 'No se pudo iniciar la grabación' });
    }
  };

  const cancelRecording = async () => {
    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); } catch {}
      recordingRef.current = null;
    }
    setRecording(false);
    clearInterval(timerRef.current);
    setRecordingTime(0);
  };

  const sendRecording = async () => {
    if (!recordingRef.current || !driverId) return;

    clearInterval(timerRef.current);
    const duration = recordingTime;
    setRecording(false);
    setSending(true);

    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;

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
