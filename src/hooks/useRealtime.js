import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { TRIP_STATUS } from '../utils/constants';
import * as Haptics from 'expo-haptics';
import { sendLocalNotification } from '../services/notifications';

export const useRealtime = () => {
  const { driver } = useAuthStore();
  const { setPendingTrip, clearPendingTrip, updateActiveTrip } = useTripStore();
  const tripChannelRef = useRef(null);
  const messageChannelRef = useRef(null);
  const commissionChannelRef = useRef(null);

  const handlePendingTripAssigned = useCallback(async (trip, { source = 'unknown', onNewTrip } = {}) => {
    if (!trip || trip.status !== TRIP_STATUS.PENDING) return;

    const { pendingTrip: currentPendingTrip, showNewTripModal } = useTripStore.getState();
    setPendingTrip(trip);

    // Avoid re-triggering haptics/local notifications when receiving repeated updates for the same pending trip.
    const isDuplicatePendingSignal =
      source !== 'insert' && currentPendingTrip?.id === trip.id && showNewTripModal;
    if (isDuplicatePendingSignal) return;

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const notes = String(trip.notes || '');
    const isPassengerApp = notes.includes('[PASSENGER_APP]');
    const isApproachOnly = notes.includes('[APPROACH_ONLY]');
    let pickupAddress = isPassengerApp
      ? trip.origin_address
      : (isApproachOnly ? trip.destination_address : trip.origin_address);
    if (isPassengerApp && !pickupAddress) {
      const pickupMatch = String(trip.notes || '').match(/\[PICKUP_JSON:(\{[^}]+\})\]/);
      if (pickupMatch) {
        try {
          const parsed = JSON.parse(pickupMatch[1]);
          pickupAddress = parsed?.address || pickupAddress;
        } catch {
          // ignore
        }
      }
    }
    await sendLocalNotification(
      '🚖 Nuevo viaje asignado',
      `${trip.passenger_name} - ${pickupAddress}`,
      { tripId: trip.id }
    );

    if (onNewTrip) onNewTrip(trip);
  }, [setPendingTrip]);

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
          await handlePendingTripAssigned(trip, { source: 'insert', onNewTrip });
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trips',
        },
        async (payload) => {
          const trip = payload?.new || {};
          const previousTrip = payload?.old || {};
          const currentDriverId = String(driver.id);
          const ownsNow = String(trip?.driver_id || '') === currentDriverId;
          const ownedBefore = String(previousTrip?.driver_id || '') === currentDriverId;

          // El worker puede hacer queued -> pending seteando driver_id en el mismo UPDATE.
          // Si filtramos por driver_id en el servidor, ese cambio puede perderse según el payload.
          // Escuchamos UPDATE sin filtro y filtramos localmente para este chofer.
          if (!ownsNow && !ownedBefore) {
            return;
          }

          const statusNow = String(trip?.status || '').toLowerCase();
          const previousStatus = String(previousTrip?.status || '').toLowerCase();

          if (ownsNow && statusNow === TRIP_STATUS.PENDING && (previousStatus !== TRIP_STATUS.PENDING || !ownedBefore)) {
            await handlePendingTripAssigned(trip, { source: 'update', onNewTrip });
            return;
          }

          if (ownedBefore && previousStatus === TRIP_STATUS.PENDING && (!ownsNow || statusNow !== TRIP_STATUS.PENDING)) {
            const { pendingTrip: currentPendingTrip } = useTripStore.getState();
            if (currentPendingTrip?.id === trip.id) {
              clearPendingTrip();
            }
          }

          if (ownsNow && statusNow === TRIP_STATUS.CANCELLED) {
            // Update the Zustand store so ActiveTripScreen can react immediately
            updateActiveTrip({ status: TRIP_STATUS.CANCELLED, cancel_reason: trip.cancel_reason || '' });
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            sendLocalNotification(
              '⚠️ Viaje cancelado',
              trip.cancel_reason
                ? `El viaje fue cancelado: ${trip.cancel_reason}`
                : 'El pasajero canceló el viaje.',
              { type: 'trip_cancelled', tripId: trip.id }
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
  }, [driver?.id, handlePendingTripAssigned]);

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

  const subscribeToCommissionPayments = useCallback((onPayment) => {
    if (!driver?.id) return;

    if (commissionChannelRef.current) {
      supabase.removeChannel(commissionChannelRef.current);
    }

    const channel = supabase
      .channel(`commission_payments:driver:${driver.id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'commission_payments',
          filter: `driver_id=eq.${driver.id}`,
        },
        (payload) => {
          if (onPayment) onPayment(payload.new);
        }
      )
      .subscribe();

    commissionChannelRef.current = channel;
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
    if (commissionChannelRef.current) {
      supabase.removeChannel(commissionChannelRef.current);
      commissionChannelRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => unsubscribeAll();
  }, []);

  return {
    subscribeToNewTrips,
    subscribeToMessages,
    subscribeToCommissionPayments,
    unsubscribeAll,
  };
};
