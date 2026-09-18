import { useCallback, useEffect, useRef, useState } from 'react';
import {
  useAudioPlayer,
  useAudioRecorder,
  AudioModule,
  setAudioModeAsync,
  RecordingPresets,
} from 'expo-audio';
import * as Speech from 'expo-speech';
import Toast from 'react-native-toast-message';
import { supabase } from '../services/supabase';
import { notifyPassengerTripChatMessage } from '../services/tripChatNotify';
import { useAuthStore } from '../stores/authStore';
import {
  isTripChatAvailable,
  TRIP_CHAT_MAX_AUDIO_SECONDS,
  TRIP_CHAT_MAX_TEXT_LENGTH,
  TRIP_CHAT_MESSAGE_FIELDS,
} from '../constants/tripChat';
import {
  prepareTripChatPlaybackMode,
  playWithAudioPlayer,
  resolveTripChatAudioUri,
} from '../utils/tripChatAudio';

function mergeMessage(list, message) {
  if (!message?.id && !message?.client_id) return list;
  const exists = list.some(
    (m) =>
      (message.id && m.id === message.id)
      || (message.client_id && m.client_id && m.client_id === message.client_id)
  );
  if (exists) {
    return list.map((m) => {
      if (message.id && m.id === message.id) return { ...m, ...message };
      if (message.client_id && m.client_id === message.client_id) return { ...m, ...message };
      return m;
    });
  }
  return [...list, message].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
}

function isRealMessageId(id) {
  const value = String(id || '');
  return Boolean(value)
    && !value.startsWith('d-')
    && !value.startsWith('p-')
    && /^[0-9a-f-]{36}$/i.test(value);
}

export function useTripChat({ tripId, tripStatus, enabled = true }) {
  const { driver } = useAuthStore();
  const driverId = driver?.id;
  const writable = isTripChatAvailable(tripStatus);

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chatOpen, setChatOpen] = useState(false);

  const timerRef = useRef(null);
  const channelRef = useRef(null);
  const chatOpenRef = useRef(false);
  const playGenRef = useRef(0);
  const markingSeenRef = useRef(false);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const player = useAudioPlayer(null);
  const [playingAudioUrl, setPlayingAudioUrl] = useState(null);

  chatOpenRef.current = chatOpen;

  useEffect(() => () => {
    playGenRef.current += 1;
    try { player.pause(); } catch { /* ignore */ }
    setPlayingAudioUrl(null);
  }, [player]);

  const applyLocalSeen = useCallback((predicate) => {
    const nowIso = new Date().toISOString();
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.seen_at || !predicate(m)) return m;
        changed = true;
        return { ...m, seen_at: nowIso };
      });
      return changed ? next : prev;
    });
  }, []);

  const markOpenTextsSeen = useCallback(async () => {
    if (!tripId || markingSeenRef.current) return;
    markingSeenRef.current = true;
    try {
      applyLocalSeen((m) => m.sender_role === 'passenger' && m.message_type === 'text');
      const { error } = await supabase
        .from('trip_chat_messages')
        .update({ seen_at: new Date().toISOString() })
        .eq('trip_id', tripId)
        .eq('sender_role', 'passenger')
        .eq('message_type', 'text')
        .is('seen_at', null);
      if (error) console.warn('[useTripChat] mark texts:', error.message || error);
    } catch (err) {
      console.warn('[useTripChat] mark texts:', err?.message || err);
    } finally {
      markingSeenRef.current = false;
    }
  }, [tripId, applyLocalSeen]);

  const markAudioSeen = useCallback(async (messageId) => {
    if (!tripId || !isRealMessageId(messageId)) return;
    applyLocalSeen((m) => m.id === messageId);
    try {
      const { error } = await supabase
        .from('trip_chat_messages')
        .update({ seen_at: new Date().toISOString() })
        .eq('trip_id', tripId)
        .eq('id', messageId)
        .eq('sender_role', 'passenger')
        .is('seen_at', null);
      if (error) console.warn('[useTripChat] mark audio:', error.message || error);
    } catch (err) {
      console.warn('[useTripChat] mark audio:', err?.message || err);
    }
  }, [tripId, applyLocalSeen]);

  const fetchMessages = useCallback(async () => {
    if (!tripId || !enabled) return;
    try {
      const { data, error } = await supabase
        .from('trip_chat_messages')
        .select(TRIP_CHAT_MESSAGE_FIELDS)
        .eq('trip_id', tripId)
        .order('created_at', { ascending: true })
        .limit(120);
      if (!error) setMessages(data || []);
    } catch (err) {
      console.warn('[useTripChat] fetch:', err?.message || err);
    } finally {
      setLoading(false);
    }
  }, [tripId, enabled]);

  useEffect(() => {
    if (!tripId || !enabled) {
      setMessages([]);
      setUnreadCount(0);
      setLoading(false);
      return undefined;
    }

    setLoading(true);
    fetchMessages();

    const channel = supabase
      .channel(`trip_chat_${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trip_chat_messages',
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          const msg = payload.new;
          setMessages((prev) => mergeMessage(prev, msg));
          if (msg?.sender_role === 'passenger' && !chatOpenRef.current) {
            setUnreadCount((n) => n + 1);
          }
          if (
            chatOpenRef.current
            && msg?.sender_role === 'passenger'
            && msg?.message_type === 'text'
            && !msg?.seen_at
          ) {
            markOpenTextsSeen();
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trip_chat_messages',
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          setMessages((prev) => mergeMessage(prev, payload.new));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [tripId, enabled, fetchMessages, markOpenTextsSeen]);

  const openChat = useCallback(() => {
    setChatOpen(true);
    setUnreadCount(0);
  }, []);

  const closeChat = useCallback(() => {
    setChatOpen(false);
    setUnreadCount(0);
  }, []);

  useEffect(() => {
    if (!chatOpen || !tripId) return;
    markOpenTextsSeen();
  }, [chatOpen, tripId, messages.length, markOpenTextsSeen]);

  const playAudio = useCallback(async (messageOrUrl) => {
    const message = typeof messageOrUrl === 'object' && messageOrUrl
      ? messageOrUrl
      : { audio_url: messageOrUrl };
    const remoteUrl = String(message?.audio_url || '').trim();
    if (!remoteUrl) {
      Toast.show({ type: 'info', text1: 'El audio se está subiendo…' });
      return;
    }

    if (playingAudioUrl === remoteUrl) {
      try { player.pause(); } catch { /* ignore */ }
      setPlayingAudioUrl(null);
      playGenRef.current += 1;
      return;
    }

    const gen = ++playGenRef.current;
    setPlayingAudioUrl(remoteUrl);

    try {
      await prepareTripChatPlaybackMode({ stopSpeech: () => Speech.stop() });

      let playUri = remoteUrl;
      try {
        playUri = await resolveTripChatAudioUri(remoteUrl);
      } catch (dlErr) {
        console.warn('[useTripChat] download:', dlErr?.message || dlErr);
        playUri = remoteUrl;
      }

      if (gen !== playGenRef.current) return;

      await playWithAudioPlayer(player, playUri);

      if (gen !== playGenRef.current) return;

      if (message?.sender_role === 'passenger' && isRealMessageId(message?.id) && !message?.seen_at) {
        markAudioSeen(message.id);
      }

      const onDone = (status) => {
        if (!status?.didJustFinish) return;
        try { player.removeListener('playbackStatusUpdate', onDone); } catch { /* ignore */ }
        if (gen === playGenRef.current) setPlayingAudioUrl(null);
      };
      player.addListener('playbackStatusUpdate', onDone);
    } catch (err) {
      if (gen !== playGenRef.current) return;
      console.warn('[useTripChat] play:', err?.message || err);
      setPlayingAudioUrl(null);
      Toast.show({
        type: 'error',
        text1: 'No se pudo reproducir el audio',
        text2: err?.message || 'Reintentá en un momento.',
      });
    }
  }, [player, playingAudioUrl, markAudioSeen]);

  const sendText = useCallback(async (rawText) => {
    if (!tripId || !driverId || !writable) return { ok: false };
    const text = String(rawText || '').replace(/\s+/g, ' ').trim().slice(0, TRIP_CHAT_MAX_TEXT_LENGTH);
    if (!text) return { ok: false };

    setSending(true);
    const clientId = `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const optimistic = {
      id: clientId,
      client_id: clientId,
      trip_id: tripId,
      sender_role: 'driver',
      message_type: 'text',
      body: text,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => mergeMessage(prev, optimistic));

    try {
      const { data, error } = await supabase
        .from('trip_chat_messages')
        .insert({
          trip_id: tripId,
          sender_role: 'driver',
          message_type: 'text',
          body: text,
          client_id: clientId,
        })
        .select(TRIP_CHAT_MESSAGE_FIELDS)
        .single();
      if (error) throw error;
      setMessages((prev) => mergeMessage(prev, data));
      notifyPassengerTripChatMessage({
        tripId,
        messageId: data.id,
        messageType: 'text',
        body: text,
      }).catch(() => {});
      return { ok: true, message: data };
    } catch (err) {
      console.warn('[useTripChat] sendText:', err?.message || err);
      setMessages((prev) => prev.filter((m) => m.client_id !== clientId));
      Toast.show({ type: 'error', text1: 'No se pudo enviar', text2: 'Reintentá en un momento.' });
      return { ok: false };
    } finally {
      setSending(false);
    }
  }, [tripId, driverId, writable]);

  const startRecording = useCallback(async () => {
    if (!writable) return;
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
      timerRef.current = setInterval(() => {
        setRecordingTime((t) => {
          if (t + 1 >= TRIP_CHAT_MAX_AUDIO_SECONDS) {
            clearInterval(timerRef.current);
          }
          return Math.min(TRIP_CHAT_MAX_AUDIO_SECONDS, t + 1);
        });
      }, 1000);
    } catch (err) {
      console.warn('[useTripChat] startRecording:', err?.message || err);
      Toast.show({ type: 'error', text1: 'No se pudo grabar' });
    }
  }, [writable, recorder]);

  const cancelRecording = useCallback(async () => {
    try { await recorder.stop(); } catch { /* ignore */ }
    try { await prepareTripChatPlaybackMode({ stopSpeech: () => Speech.stop() }); } catch { /* ignore */ }
    setRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    setRecordingTime(0);
  }, [recorder]);

  const sendRecording = useCallback(async () => {
    if (!tripId || !driverId || !writable) return { ok: false };
    if (timerRef.current) clearInterval(timerRef.current);
    const duration = Math.max(1, recordingTime);
    setRecording(false);
    setSending(true);

    const clientId = `d-a-${Date.now()}`;
    const optimistic = {
      id: clientId,
      client_id: clientId,
      trip_id: tripId,
      sender_role: 'driver',
      message_type: 'audio',
      audio_duration_seconds: duration,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => mergeMessage(prev, optimistic));

    try {
      await recorder.stop();
      try { await prepareTripChatPlaybackMode({ stopSpeech: () => Speech.stop() }); } catch { /* ignore */ }
      const uri = recorder.uri;
      if (!uri) throw new Error('Sin audio');

      // arrayBuffer es fiable en RN; blob suele fallar vacío en Android.
      const resp = await fetch(uri);
      const arrayBuffer = await resp.arrayBuffer();
      if (!arrayBuffer || arrayBuffer.byteLength < 32) {
        throw new Error('El audio quedó vacío. Grabá de nuevo.');
      }

      const fileName = `${driverId}/${tripId}/${Date.now()}.m4a`;
      const { error: uploadError } = await supabase.storage
        .from('trip-chat-audio')
        .upload(fileName, arrayBuffer, {
          contentType: 'audio/mp4',
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('trip-chat-audio').getPublicUrl(fileName);
      const { data, error } = await supabase
        .from('trip_chat_messages')
        .insert({
          trip_id: tripId,
          sender_role: 'driver',
          message_type: 'audio',
          audio_url: urlData.publicUrl,
          audio_duration_seconds: duration,
          client_id: clientId,
        })
        .select(TRIP_CHAT_MESSAGE_FIELDS)
        .single();
      if (error) throw error;
      setMessages((prev) => mergeMessage(prev, data));
      notifyPassengerTripChatMessage({
        tripId,
        messageId: data.id,
        messageType: 'audio',
        body: null,
      }).catch(() => {});
      return { ok: true, message: data };
    } catch (err) {
      console.warn('[useTripChat] sendRecording:', err?.message || err);
      setMessages((prev) => prev.filter((m) => m.client_id !== clientId));
      Toast.show({
        type: 'error',
        text1: 'No se pudo enviar el audio',
        text2: err?.message || 'Reintentá en un momento.',
      });
      return { ok: false };
    } finally {
      setSending(false);
      setRecordingTime(0);
    }
  }, [tripId, driverId, writable, recordingTime, recorder]);

  return {
    messages,
    loading,
    sending,
    recording,
    recordingTime,
    unreadCount,
    writable,
    chatOpen,
    openChat,
    closeChat,
    sendText,
    startRecording,
    cancelRecording,
    sendRecording,
    playAudio,
    playingAudioUrl,
    fetchMessages,
    myRole: 'driver',
  };
}
