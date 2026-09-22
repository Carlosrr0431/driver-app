import { useEffect, useRef, useCallback } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { TRIP_STATUS } from '../utils/constants';
import * as Haptics from 'expo-haptics';
import { sendLocalNotification } from '../services/notifications';
import { resolveTripPickupCoords } from '../../shared/trip-contract';
import { prefetchDriverToPickupRoute } from '../services/navigationRoutePrefetch';
import { resolveDriverTripRealtimeActions } from '../utils/pendingTripRealtime';
import { isLiveDriverTrip } from '../utils/activeTripNavigation';

export const useRealtime = () => {
  const { driver } = useAuthStore();
  const { setPendingTrip, clearPendingTrip, updateActiveTrip, updatePendingTrip } = useTripStore();
  const tripChannelRef = useRef(null);
  const messageChannelRef = useRef(null);
  const commissionChannelRef = useRef(null);
  /** Evita múltiples locales por el mismo viaje cancelado (suscripciones/updates repetidos). */
  const notifiedCancelTripIdsRef = useRef(new Set());

  const handlePendingTripAssigned = useCallback(async (trip, { source = 'unknown', onNewTrip } = {}) => {
    if (!trip || trip.status !== TRIP_STATUS.PENDING) return;

    const { pendingTrip: currentPendingTrip, showNewTripModal } = useTripStore.getState();
    setPendingTrip(trip);
    prefetchDriverToPickupRoute(trip, useLocationStore.getState().currentLocation);

    // Avoid re-triggering haptics/local notifications when receiving repeated updates for the same pending trip.
    const isDuplicatePendingSignal =
      source !== 'insert' && currentPendingTrip?.id === trip.id && showNewTripModal;
    if (isDuplicatePendingSignal) return;

    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    const pickupResolved = resolveTripPickupCoords(trip);
    const pickupAddress =
      pickupResolved?.address
      || trip.origin_address
      || trip.destination_address
      || 'Retiro';
    const liveTrip = useTripStore.getState().activeTrip;
    const isParallel = isLiveDriverTrip(liveTrip) && liveTrip.id !== trip.id;
    await sendLocalNotification(
      isParallel ? 'Siguiente viaje' : 'Nuevo viaje asignado',
      `${trip.passenger_name} - ${pickupAddress}`,
      { type: 'new_trip', tripId: trip.id }
    );

    if (onNewTrip) onNewTrip(trip);
  }, [setPendingTrip]);

  const subscribeToNewTrips = useCallback((onNewTrip) => {
    if (!driver?.id) {
      if (__DEV__) console.log('subscribeToNewTrips: no driver.id, skipping');
      return;
    }

    if (__DEV__) console.log('subscribeToNewTrips: subscribing for driver_id =', driver.id);

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
          const storeState = useTripStore.getState();
          const actions = resolveDriverTripRealtimeActions({
            trip,
            previousTrip,
            driverId: driver.id,
            pendingTripId: storeState.pendingTrip?.id,
            activeTripId: storeState.activeTrip?.id,
          });

          // El worker puede hacer queued -> pending seteando driver_id en el mismo UPDATE.
          // Escuchamos UPDATE sin filtro y filtramos localmente para este chofer.
          // Incluye la oferta abierta (pendingTripId) aunque payload.old venga vacío
          // o cancelen liberando driver_id.
          if (!actions.relevant) {
            return;
          }

          if (actions.assignPending) {
            await handlePendingTripAssigned(trip, { source: 'update', onNewTrip });
            return;
          }

          if (actions.mergePending) {
            const currentPending = useTripStore.getState().pendingTrip;
            if (
              currentPending
              && Object.prototype.hasOwnProperty.call(trip, 'notes')
              && trip.notes !== currentPending.notes
            ) {
              updatePendingTrip(trip);
            }
          }

          if (actions.clearPending) {
            clearPendingTrip();
          }

          if (actions.notifyCancelled) {
            const cancelTripId = actions.tripId;
            if (cancelTripId && notifiedCancelTripIdsRef.current.has(cancelTripId)) {
              return;
            }
            if (cancelTripId) {
              notifiedCancelTripIdsRef.current.add(cancelTripId);
            }

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
        if (__DEV__ && status === 'SUBSCRIBED') {
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
          await sendLocalNotification(title, message.message, {
            type: 'dispatcher_message',
            messageId: message.id,
          });

          if (onMessage) onMessage(message);
        }
      )
      .subscribe((status) => {
        if (__DEV__ && status === 'SUBSCRIBED') {
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
