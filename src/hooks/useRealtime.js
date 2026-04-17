import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { TRIP_STATUS } from '../utils/constants';
import * as Haptics from 'expo-haptics';
import { sendLocalNotification } from '../services/notifications';

export const useRealtime = () => {
  const { driver } = useAuthStore();
  const { setPendingTrip } = useTripStore();
  const tripChannelRef = useRef(null);
  const messageChannelRef = useRef(null);

  const subscribeToNewTrips = useCallback((onNewTrip) => {
    if (!driver?.id) {
      console.log('subscribeToNewTrips: no driver.id, skipping');
      return;
    }

    console.log('subscribeToNewTrips: subscribing for driver_id =', driver.id);

    if (tripChannelRef.current) {
      supabase.removeChannel(tripChannelRef.current);
    }

    const channel = supabase
      .channel(`trips:driver:${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'trips',
          filter: `driver_id=eq.${driver.id}`,
        },
        async (payload) => {
          const trip = payload.new;
          if (trip.status === TRIP_STATUS.PENDING) {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

            setPendingTrip(trip);

            const isApproachOnly = String(trip.notes || '').includes('[APPROACH_ONLY]');
            const pickupAddress = isApproachOnly ? trip.destination_address : trip.origin_address;
            await sendLocalNotification(
              '🚖 Nuevo viaje asignado',
              `${trip.passenger_name} - ${pickupAddress}`,
              { tripId: trip.id }
            );

            if (onNewTrip) onNewTrip(trip);
          }
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
          filter: `driver_id=eq.${driver.id}`,
        },
        (payload) => {
          const trip = payload.new;
          if (trip.status === TRIP_STATUS.CANCELLED && trip.cancel_reason) {
            sendLocalNotification(
              'Viaje cancelado',
              `El viaje fue cancelado: ${trip.cancel_reason}`
            );
          }
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Suscrito a nuevos viajes');
        }
      });

    tripChannelRef.current = channel;
  }, [driver?.id]);

  const subscribeToMessages = useCallback((onMessage) => {
    if (!driver?.id) return;

    if (messageChannelRef.current) {
      supabase.removeChannel(messageChannelRef.current);
    }

    const channel = supabase
      .channel(`messages:driver:${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'dispatcher_messages',
          filter: `driver_id=eq.${driver.id}`,
        },
        async (payload) => {
          const message = payload.new;

          await Haptics.notificationAsync(
            message.type === 'emergency'
              ? Haptics.NotificationFeedbackType.Error
              : Haptics.NotificationFeedbackType.Success
          );

          const title = message.type === 'emergency' ? '🚨 EMERGENCIA' : '📩 Mensaje del despachador';
          await sendLocalNotification(title, message.message, { messageId: message.id });

          if (onMessage) onMessage(message);
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          console.log('Suscrito a mensajes del despachador');
        }
      });

    messageChannelRef.current = channel;
  }, [driver?.id]);

  const unsubscribeAll = useCallback(() => {
    if (tripChannelRef.current) {
      supabase.removeChannel(tripChannelRef.current);
      tripChannelRef.current = null;
    }
    if (messageChannelRef.current) {
      supabase.removeChannel(messageChannelRef.current);
      messageChannelRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => unsubscribeAll();
  }, []);

  return {
    subscribeToNewTrips,
    subscribeToMessages,
    unsubscribeAll,
  };
};
