import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../services/supabase';
import { isWhatsAppTrip } from '../../shared/trip-contract';
import {
  WHATSAPP_THREAD_FIELDS,
  WHATSAPP_THREAD_MAX_MESSAGES,
  WHATSAPP_THREAD_TABLE,
  filterWhatsAppThreadMessagesForTrip,
  isMissingWhatsAppThreadRelationError,
  isWhatsAppThreadVisibleStatus,
  mergeWhatsAppThreadMessages,
} from '../../shared/whatsapp-trip-thread';

export function useWhatsAppTripThread({ trip, enabled = true }) {
  const tripId = trip?.id;
  const visible = Boolean(
    enabled
    && tripId
    && isWhatsAppTrip(trip)
    && isWhatsAppThreadVisibleStatus(trip?.status)
  );

  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(visible);
  const [unavailable, setUnavailable] = useState(false);
  const channelRef = useRef(null);
  const tripIdRef = useRef(tripId);
  const fetchGenRef = useRef(0);

  tripIdRef.current = tripId;

  const fetchMessages = useCallback(async (forTripId, generation) => {
    if (!forTripId) return;
    try {
      const { data, error } = await supabase
        .from(WHATSAPP_THREAD_TABLE)
        .select(WHATSAPP_THREAD_FIELDS)
        .eq('trip_id', forTripId)
        .order('created_at', { ascending: true })
        .limit(WHATSAPP_THREAD_MAX_MESSAGES);

      if (generation !== fetchGenRef.current || tripIdRef.current !== forTripId) return;

      if (error) {
        if (isMissingWhatsAppThreadRelationError(error)) {
          setUnavailable(true);
          setMessages([]);
          return;
        }
        console.warn('[useWhatsAppTripThread] fetch:', error.message || error);
        setMessages([]);
        return;
      }
      setUnavailable(false);
      setMessages(filterWhatsAppThreadMessagesForTrip(data || [], forTripId));
    } catch (err) {
      if (generation !== fetchGenRef.current || tripIdRef.current !== forTripId) return;
      if (isMissingWhatsAppThreadRelationError(err)) {
        setUnavailable(true);
        setMessages([]);
        return;
      }
      console.warn('[useWhatsAppTripThread] fetch:', err?.message || err);
      setMessages([]);
    } finally {
      if (generation === fetchGenRef.current && tripIdRef.current === forTripId) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const generation = ++fetchGenRef.current;
    tripIdRef.current = tripId;

    if (!visible || !tripId) {
      setMessages([]);
      setLoading(false);
      setUnavailable(false);
      return undefined;
    }

    setMessages([]);
    setUnavailable(false);
    setLoading(true);
    fetchMessages(tripId, generation);

    const channel = supabase
      .channel(`trip_whatsapp_${tripId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: WHATSAPP_THREAD_TABLE,
          filter: `trip_id=eq.${tripId}`,
        },
        (payload) => {
          const next = payload?.new;
          if (!next) return;
          if (String(next.trip_id || '') !== String(tripIdRef.current || '')) return;
          setMessages((prev) => mergeWhatsAppThreadMessages(prev, next));
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      fetchGenRef.current += 1;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [tripId, visible, fetchMessages]);

  return {
    visible: visible && !unavailable,
    messages: filterWhatsAppThreadMessagesForTrip(messages, tripId),
    loading: visible && loading,
  };
}
