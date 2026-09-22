import { useCallback, useEffect } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { TRIP_STATUS, PAGINATION_LIMIT, TRIP_ACCEPT_TIMEOUT } from '../utils/constants';
import { isLiveDriverTrip } from '../utils/activeTripNavigation';
import Toast from 'react-native-toast-message';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { notifyTripAcceptedTransition, notifyPassengerTripAccepted } from '../services/tripTransition';
import {
  rejectTripViaDashboard,
  rejectTripViaRpc,
  verifyTripAlreadyReleased,
} from '../services/tripReject';
import { fetchTariffForTrip, calculateTripPrice, calculateTripCommission } from '../utils/tripTariff';
import {
  isPassengerAppTrip,
  isApproachOnlyTrip,
  resolveTripPickupCoords,
} from '../../shared/trip-contract';
import {
  applyStreetHailStart,
  createStreetHailTrip as requestStreetHailTrip,
} from '../services/streetHailTrip';
import { prefetchDriverToPickupRoute } from '../services/navigationRoutePrefetch';
import { isAcceptedOfferStatus, isCancelledTripStatus } from '../utils/pendingTripRealtime';
import {
  isReservedNextTrip,
  shouldAcceptAsNextTrip,
  buildAcceptAsNextTripUpdate,
  buildActivateNextTripUpdate,
} from '../../shared/next-trip';
import { reverseGeocode } from '../services/nominatim';
import {
  resolveCommissionOverdue,
  isDriverDispatchBlocked,
  isWeeklyBillingMode,
  resolveDispatchBlockReason,
  normalizeBillingMode,
  shouldShowCommissionDebtUi,
  COMMISSION_BLOCK_AFTER_DAYS,
} from '../../shared/driver-billing';

const rejectInFlightTripIds = new Set();

/** Reusar el mismo nombre de canal ya suscripto tira "cannot add postgres_changes after subscribe()". */
function realtimeChannelName(prefix, entityId) {
  return `${prefix}:${entityId}:${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createTimeoutController(timeoutMs = 12000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timeoutId),
  };
}

function enrichApproachTrip(trip, fallback = null) {
  if (!trip) return trip;
  const merged = { ...fallback, ...trip };

  const isWhatsappApproach = isApproachOnlyTrip(merged) && !isPassengerAppTrip(merged);
  const isPassenger = isPassengerAppTrip(merged);
  if (!isWhatsappApproach && !isPassenger) {
    return merged;
  }

  const pickup = resolveTripPickupCoords(merged);
  if (pickup?.lat == null || pickup?.lng == null) {
    return { ...merged, is_approach_only: isApproachOnlyTrip(merged) };
  }

  return {
    ...merged,
    is_approach_only: isApproachOnlyTrip(merged),
    pickup_override_address: pickup.address || merged.origin_address || merged.destination_address,
    pickup_override_lat: pickup.lat,
    pickup_override_lng: pickup.lng,
  };
}

export const useTrips = () => {
  const { driver } = useAuthStore();
  const {
    setActiveTrip,
    clearActiveTrip,
    clearPendingTrip,
    updateActiveTrip,
    setDriverFlowStep,
    setReservedNextTrip,
    clearReservedNextTrip,
  } = useTripStore();
  const queryClient = useQueryClient();

  const useActiveTrip = () => {
    const query = useQuery({
      queryKey: ['activeTrip', driver?.id],
      queryFn: async () => {
        if (!driver?.id) return null;
        const { data, error } = await supabase
          .from('trips')
          .select('*')
          .eq('driver_id', driver.id)
          .in('status', [
            TRIP_STATUS.ACCEPTED,
            TRIP_STATUS.GOING_TO_PICKUP,
            TRIP_STATUS.IN_PROGRESS,
          ])
          .order('created_at', { ascending: false })
          .limit(5);

        if (error) throw error;
        const rows = Array.isArray(data) ? data : [];
        const live = rows.find((row) => isLiveDriverTrip(row));
        const reserved = rows.find((row) => isReservedNextTrip(row)) || null;
        setReservedNextTrip(reserved);

        if (live) {
          const currentActiveTrip = useTripStore.getState().activeTrip;
          const enriched = enrichApproachTrip(live, currentActiveTrip?.id === live.id ? currentActiveTrip : null);
          setActiveTrip(enriched);
          return live;
        }
        return null;
      },
      enabled: !!driver?.id,
    });

    useEffect(() => {
      if (!driver?.id) return;

      const channel = supabase
        .channel(realtimeChannelName('active-trip-realtime', driver.id))
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'trips', filter: `driver_id=eq.${driver.id}` },
          (payload) => {
            const trip = payload?.new;
            if (trip) {
              const currentActiveTrip = useTripStore.getState().activeTrip;

              if (isReservedNextTrip(trip)) {
                setReservedNextTrip(trip);
              } else if (
                trip.status === TRIP_STATUS.ACCEPTED
                || trip.status === TRIP_STATUS.GOING_TO_PICKUP
                || trip.status === TRIP_STATUS.IN_PROGRESS
              ) {
                if (isLiveDriverTrip(trip)) {
                  const enriched = enrichApproachTrip(
                    trip,
                    currentActiveTrip?.id === trip.id ? currentActiveTrip : null
                  );
                  setActiveTrip(enriched);
                  if (useTripStore.getState().reservedNextTrip?.id === trip.id) {
                    clearReservedNextTrip();
                  }
                }
              }

              if (
                (trip.status === TRIP_STATUS.COMPLETED || trip.status === TRIP_STATUS.CANCELLED)
                && currentActiveTrip?.id === trip.id
              ) {
                clearActiveTrip();
              }
            }

            queryClient.invalidateQueries({ queryKey: ['activeTrip', driver.id] });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [driver?.id, queryClient]);

    return query;
  };

  const useTripHistory = (filter = 'today') => {
    return useInfiniteQuery({
      queryKey: ['tripHistory', driver?.id, filter],
      staleTime: 3 * 60 * 1000,        // muestra cache 3 min antes de refetch silencioso
      gcTime: 10 * 60 * 1000,          // mantiene en memoria 10 min
      placeholderData: (prev) => prev, // nunca vuelve a "loading" si hay datos anteriores
      queryFn: async ({ pageParam = 0 }) => {
        if (!driver?.id) return { data: [], nextPage: null };

        let query = supabase
          .from('trips')
          .select('*')
          .eq('driver_id', driver.id)
          .in('status', [TRIP_STATUS.COMPLETED, TRIP_STATUS.CANCELLED])
          .order('created_at', { ascending: false })
          .range(pageParam, pageParam + PAGINATION_LIMIT - 1);

        const now = new Date();
        if (filter === 'today') {
          query = query
            .gte('created_at', startOfDay(now).toISOString())
            .lte('created_at', endOfDay(now).toISOString());
        } else if (filter === 'week') {
          query = query
            .gte('created_at', startOfWeek(now, { weekStartsOn: 1 }).toISOString())
            .lte('created_at', endOfWeek(now, { weekStartsOn: 1 }).toISOString());
        } else if (filter === 'month') {
          query = query
            .gte('created_at', startOfMonth(now).toISOString())
            .lte('created_at', endOfMonth(now).toISOString());
        }

        const { data, error } = await query;
        if (error) throw error;

        return {
          data: data || [],
          nextPage: data?.length === PAGINATION_LIMIT ? pageParam + PAGINATION_LIMIT : null,
        };
      },
      getNextPageParam: (lastPage) => lastPage.nextPage,
      enabled: !!driver?.id,
    });
  };

  const useTodayStats = () => {
    const query = useQuery({
      queryKey: ['todayStats', driver?.id],
      staleTime: 3 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      placeholderData: (prev) => prev,
      queryFn: async () => {
        if (!driver?.id) return null;

        const now = new Date();
        const { data, error } = await supabase
          .from('trips')
          .select('*')
          .eq('driver_id', driver.id)
          .eq('status', TRIP_STATUS.COMPLETED)
          .gte('completed_at', startOfDay(now).toISOString())
          .lte('completed_at', endOfDay(now).toISOString());

        if (error) throw error;

        const trips = data || [];
        const totalTrips = trips.length;
        const totalKm = trips.reduce((sum, t) => sum + (Number(t.distance_km) || 0), 0);
        const totalEarnings = trips.reduce((sum, t) => sum + (Number(t.price) || 0), 0);
        const totalMinutes = trips.reduce((sum, t) => sum + (Number(t.duration_minutes) || 0), 0);
        const totalCommission = trips.reduce((sum, t) => sum + (Number(t.commission_amount) || 0), 0);

        return {
          totalTrips,
          totalKm: Math.round(totalKm * 10) / 10,
          totalEarnings,
          totalHours: Math.round((totalMinutes / 60) * 10) / 10,
          totalCommission,
        };
      },
      enabled: !!driver?.id,
    });

    useEffect(() => {
      if (!driver?.id) return;

      const channel = supabase
        .channel(realtimeChannelName('today-stats-realtime', driver.id))
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'trips', filter: `driver_id=eq.${driver.id}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['todayStats', driver.id] });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [driver?.id, queryClient]);

    return query;
  };

  const useCommissionBalance = () => {
    const query = useQuery({
      queryKey: ['commissionBalance', driver?.id],
      queryFn: async () => {
        if (!driver?.id) return null;

        // Leer pending_commission directamente del driver — es la fuente de verdad.
        // El trigger lo incrementa al completar viajes y el webhook lo resetea a 0 al pagar.
        const { data: driverData, error: driverErr } = await supabase
          .from('drivers')
          .select('pending_commission, last_commission_payment_at, commission_debt_since_at, billing_mode, commission_blocked')
          .eq('id', driver.id)
          .single();

        if (driverErr) throw driverErr;

        const billingMode = normalizeBillingMode(
          driverData?.billing_mode ?? driver?.billing_mode,
        );
        const billingRow = { ...driverData, billing_mode: billingMode };
        const balance = Math.round((Number(driverData?.pending_commission) || 0) * 100) / 100;
        const isOverdue = resolveCommissionOverdue(billingRow);
        const isBlocked = isDriverDispatchBlocked(billingRow);
        const blockReason = resolveDispatchBlockReason(billingRow);
        const isWeekly = isWeeklyBillingMode(billingMode);

        if (driver?.billing_mode !== billingMode) {
          useAuthStore.getState().updateDriver({ billing_mode: billingMode });
        }

        return {
          balance,
          isOverdue,
          isBlocked,
          blockReason,
          billingMode,
          isWeekly,
          showDebtUi: shouldShowCommissionDebtUi({ billingMode, isWeekly }),
        };
      },
      enabled: !!driver?.id,
    });

    useEffect(() => {
      if (!driver?.id) return;

      const channel = supabase
        .channel(realtimeChannelName('commission-balance-realtime', driver.id))
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'drivers', filter: `id=eq.${driver.id}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['commissionBalance', driver.id] });
          }
        )
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'commission_payments', filter: `driver_id=eq.${driver.id}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['commissionBalance', driver.id] });
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [driver?.id, queryClient]);

    return query;
  };

  const acceptTrip = useCallback(async (tripId) => {
    try {
      if (!driver?.id) {
        Toast.show({
          type: 'error',
          text1: 'Error',
          text2: 'No se encontró sesión de chofer',
        });
        return { success: false, error: new Error('driver_not_ready') };
      }

      const pendingTripSnapshot = useTripStore.getState().pendingTrip;
      const liveTrip = useTripStore.getState().activeTrip;
      const acceptAsNext = shouldAcceptAsNextTrip({ liveTrip, offerTripId: tripId });

      // Accept first, verify commissions after — speed is critical with short timeouts.
      const timeout = createTimeoutController(10000);
      const { data, error } = await supabase
        .from('trips')
        .update(acceptAsNext
          ? buildAcceptAsNextTripUpdate()
          : {
            status: TRIP_STATUS.GOING_TO_PICKUP,
            accepted_at: new Date().toISOString(),
            dispatch_status: 'accepted',
            next_after_trip_id: null,
            next_trip_offered_at: null,
          })
        .eq('id', tripId)
        .eq('driver_id', driver.id)
        .eq('status', TRIP_STATUS.PENDING)
        .abortSignal(timeout.signal)
        .select()
        .maybeSingle();
      timeout.cleanup();

      if (error) throw error;

      if (!data || !isAcceptedOfferStatus(data.status) || isCancelledTripStatus(data.status)) {
        clearPendingTrip();
        let cancelled = isCancelledTripStatus(data?.status);
        if (!cancelled) {
          try {
            const { data: latest } = await supabase
              .from('trips')
              .select('status')
              .eq('id', tripId)
              .maybeSingle();
            cancelled = isCancelledTripStatus(latest?.status);
          } catch (_) {}
        }
        Toast.show({
          type: cancelled ? 'info' : 'error',
          text1: cancelled ? 'Viaje cancelado' : 'Viaje no disponible',
          text2: cancelled
            ? 'El viaje fue cancelado y ya no se puede aceptar.'
            : 'El viaje ya no está disponible para aceptar.',
        });
        return { success: false, unavailable: true, cancelled };
      }

      if (acceptAsNext) {
        setReservedNextTrip(data);
        clearPendingTrip();
        queryClient.invalidateQueries({ queryKey: ['activeTrip'] });
        Toast.show({
          type: 'success',
          text1: 'Siguiente viaje listo',
          text2: 'Lo arrancás automáticamente al terminar el actual',
        });
        return { success: true, data, queuedNext: true };
      }

      const enrichedActiveTrip = enrichApproachTrip(data, pendingTripSnapshot?.id === tripId ? pendingTripSnapshot : null);
      setActiveTrip(enrichedActiveTrip);
      prefetchDriverToPickupRoute(enrichedActiveTrip, useLocationStore.getState().currentLocation);
      clearPendingTrip();
      queryClient.invalidateQueries({ queryKey: ['activeTrip'] });

      Toast.show({
        type: 'success',
        text1: '¡Viaje aceptado!',
        text2: 'Dirígete al punto de origen',
      });

      // Push directo al pasajero (rápido, sin overhead de Agente_IA)
      notifyPassengerTripAccepted(data.id).then((pushResult) => {
        if (!pushResult.ok) {
          console.warn('[acceptTrip] Push pasajero falló:', pushResult.reason, '| tripId:', data.id);
        } else {
          console.log('[acceptTrip] Push pasajero enviado:', pushResult.pushStatus, '| tripId:', data.id);
        }
      });

      // Agente_IA como respaldo (WhatsApp + transiciones de ciclo de vida)
      notifyTripAcceptedTransition(data.id).catch((notifyError) => {
        console.warn(
          '[acceptTrip] Agente_IA transition falló (no crítico):',
          notifyError?.message || notifyError
        );
      });

      // Commission check async — don't block acceptance
      (async () => {
        try {
          const billingTimeout = createTimeoutController(5000);
          const { data: billingRow } = await supabase
            .from('drivers')
            .select('pending_commission, commission_debt_since_at, billing_mode, commission_blocked')
            .eq('id', driver.id)
            .abortSignal(billingTimeout.signal)
            .single();
          billingTimeout.cleanup();

          if (isWeeklyBillingMode(billingRow?.billing_mode)) return;
          if (!resolveCommissionOverdue(billingRow)) return;

          Toast.show({
            type: 'error',
            text1: 'Comisiones vencidas',
            text2: `Pasaron ${COMMISSION_BLOCK_AFTER_DAYS} días (semana + gracia). Regularizá para seguir recibiendo viajes.`,
            visibilityTime: 5000,
          });
        } catch (_) {}
      })();

      return { success: true, data };
    } catch (error) {
      const isTimeout = error?.name === 'AbortError';
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: isTimeout
          ? 'La confirmación tardó demasiado. Revisá conexión e intentá de nuevo.'
          : 'No se pudo aceptar el viaje',
      });
      return { success: false, error, isTimeout };
    }
  }, [driver?.id, clearPendingTrip, queryClient, setActiveTrip, setReservedNextTrip]);

  const rejectTrip = useCallback(async (tripId, reason) => {
    const normalizedTripId = String(tripId || '').trim();
    if (!normalizedTripId) {
      return { success: false, error: new Error('trip_id_invalid') };
    }

    if (rejectInFlightTripIds.has(normalizedTripId)) {
      return { success: true, deduped: true };
    }
    rejectInFlightTripIds.add(normalizedTripId);

    const isTimeout = reason === 'Tiempo agotado';

    // Cerrar el modal de inmediato; la API puede tardar o fallar.
    if (isTimeout) {
      clearPendingTrip();
    }

    const finishReject = () => {
      clearPendingTrip();
      Toast.show({
        type: 'info',
        text1: isTimeout ? 'Tiempo agotado' : 'Viaje rechazado',
        text2: 'Se buscará otro chofer disponible.',
      });
      return { success: true };
    };

    try {
      if (!driver?.id) {
        return { success: false, error: new Error('driver_not_ready') };
      }

      let lastRpcError = null;
      let lastApiError = null;

      try {
        const rpcResult = await rejectTripViaRpc(normalizedTripId, reason);
        if (rpcResult.success) {
          return finishReject();
        }
        if (rpcResult.needsVerify) {
          const released = await verifyTripAlreadyReleased(normalizedTripId, driver.id);
          if (released) {
            return finishReject();
          }
          if (rpcResult.unavailable) {
            clearPendingTrip();
            Toast.show({
              type: 'info',
              text1: 'Viaje no disponible',
              text2: 'El viaje ya no estaba pendiente.',
            });
            return { success: false, unavailable: true };
          }
        }
      } catch (rpcError) {
        lastRpcError = rpcError;
        if (rpcError?.unavailable) {
          clearPendingTrip();
          Toast.show({
            type: 'info',
            text1: 'Viaje no disponible',
            text2: 'El viaje ya no estaba pendiente.',
          });
          return { success: false, unavailable: true };
        }
        console.warn('rejectTrip RPC fallback:', rpcError?.message || rpcError);
      }

      try {
        const apiResult = await rejectTripViaDashboard(normalizedTripId, reason, { driverId: driver.id });
        if (apiResult.success) {
          return finishReject();
        }
      } catch (apiError) {
        lastApiError = apiError;
        if (apiError?.unavailable) {
          clearPendingTrip();
          Toast.show({
            type: 'info',
            text1: 'Viaje no disponible',
            text2: 'El viaje ya no estaba pendiente.',
          });
          return { success: false, unavailable: true };
        }
        console.warn('rejectTrip API fallback:', apiError?.message || apiError);
      }

      const released = await verifyTripAlreadyReleased(normalizedTripId, driver.id);
      if (released) {
        return finishReject();
      }

      const lastMessage = String(
        lastApiError?.message
        || lastRpcError?.message
        || 'No se pudo rechazar el viaje'
      ).trim();

      throw new Error(lastMessage);
    } catch (error) {
      if (isTimeout) {
        clearPendingTrip();
      }
      const details = String(error?.message || error?.details || '').trim();
      console.error('rejectTrip error:', error);
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: details.includes('row-level security')
          ? 'No se pudo rechazar el viaje. Contactá al operador si persiste.'
          : (details || 'No se pudo procesar el viaje'),
      });
      return { success: false, error };
    } finally {
      rejectInFlightTripIds.delete(normalizedTripId);
    }
  }, [driver?.id, clearPendingTrip]);

  const releaseAssignedTrip = useCallback(async (tripId) => {
    const normalizedTripId = String(tripId || '').trim();
    if (!normalizedTripId || !driver?.id) {
      return { success: false, error: new Error('trip_or_driver_invalid') };
    }

    const finishRelease = async () => {
      clearActiveTrip();
      queryClient.setQueryData(['activeTrip', driver.id], null);
      try {
        await supabase.from('drivers').update({ is_available: true }).eq('id', driver.id);
      } catch (availabilityError) {
        console.warn('Error setting driver available:', availabilityError);
      }
      Toast.show({
        type: 'info',
        text1: 'Viaje liberado',
        text2: 'Se buscará otro chofer disponible.',
      });
      queryClient.invalidateQueries({ queryKey: ['activeTrip'] });
      queryClient.invalidateQueries({ queryKey: ['todayStats'] });
      return { success: true };
    };

    try {
      const apiResult = await rejectTripViaDashboard(
        normalizedTripId,
        'Cancelado por el chofer',
        { driverId: driver.id, timeoutMs: 20000 },
      );
      if (apiResult.success) {
        return finishRelease();
      }
    } catch (apiError) {
      const released = await verifyTripAlreadyReleased(normalizedTripId, driver.id);
      if (released) {
        return finishRelease();
      }
      const details = String(apiError?.message || '').trim();
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: details.includes('row-level security')
          ? 'No se pudo liberar el viaje. Contactá al operador si persiste.'
          : (details || 'No se pudo buscar otro chofer. Intentá de nuevo.'),
      });
      return { success: false, error: apiError };
    }

    Toast.show({
      type: 'error',
      text1: 'Error',
      text2: 'No se pudo buscar otro chofer. Intentá de nuevo.',
    });
    return { success: false };
  }, [driver?.id, clearActiveTrip, queryClient]);

  const updateTripStatus = useCallback(async (tripId, status, extraFields = {}) => {
    try {
      const updates = { status, ...extraFields };

      if (status === TRIP_STATUS.IN_PROGRESS) {
        updates.started_at = new Date().toISOString();
      } else if (status === TRIP_STATUS.COMPLETED) {
        const DEFAULT_TARIFF_PER_KM = 600;
        updates.completed_at = new Date().toISOString();

        const { tripDistanceKm, tripTimer } = useTripStore.getState();
        const providedDistKm = Number(extraFields?.distance_km);
        const providedPrice = Number(extraFields?.price);
        const providedCommission = Number(extraFields?.commission_amount);
        const providedDuration = Number(extraFields?.duration_minutes);

        const hasPrecomputedFare =
          Number.isFinite(providedDistKm) && providedDistKm > 0
          && Number.isFinite(providedPrice) && providedPrice > 0
          && Number.isFinite(providedCommission) && providedCommission >= 0;

        if (hasPrecomputedFare) {
          updates.distance_km = providedDistKm;
          updates.price = Math.round(providedPrice);
          updates.commission_amount = Math.round(providedCommission);
          updates.duration_minutes = Number.isFinite(providedDuration) && providedDuration > 0
            ? Math.round(providedDuration)
            : Math.max(1, Math.round(tripTimer / 60));
        } else {
          const storeDistKm = Math.round(tripDistanceKm * 10) / 10;
          const distKm = Number.isFinite(providedDistKm) && providedDistKm > 0 ? providedDistKm : storeDistKm;
          updates.distance_km = distKm;

          updates.duration_minutes = Number.isFinite(providedDuration) && providedDuration > 0
            ? Math.round(providedDuration)
            : Math.max(1, Math.round(tripTimer / 60));

          try {
            const tripContext = useTripStore.getState().activeTrip;
            const tariffTrip = tripContext?.id === tripId
              ? tripContext
              : { notes: extraFields?.notes || null };
            const tariff = await fetchTariffForTrip(supabase, tariffTrip, { defaultPerKm: DEFAULT_TARIFF_PER_KM });

            const totalPrice = Number.isFinite(providedPrice) && providedPrice > 0
              ? Math.round(providedPrice)
              : calculateTripPrice({ base: tariff.base, perKm: tariff.perKm, distanceKm: distKm });

            updates.price = totalPrice;

            updates.commission_amount = Number.isFinite(providedCommission) && providedCommission >= 0
              ? Math.round(providedCommission)
              : calculateTripCommission({ price: totalPrice, commissionPercent: tariff.commission });
          } catch (e) {
            console.warn('Error fetching tariff settings:', e);
            if (Number.isFinite(providedPrice) && providedPrice > 0) {
              updates.price = Math.round(providedPrice);
            }
            if (Number.isFinite(providedCommission) && providedCommission >= 0) {
              updates.commission_amount = Math.round(providedCommission);
            }
          }
        }
      }

      const { data, error } = await supabase
        .from('trips')
        .update(updates)
        .eq('id', tripId)
        .select()
        .single();

      if (error) throw error;

      if (status === TRIP_STATUS.COMPLETED || status === TRIP_STATUS.CANCELLED) {
        const reservedId = useTripStore.getState().reservedNextTrip?.id || null;
        clearActiveTrip();
        if (driver?.id) {
          queryClient.setQueryData(['activeTrip', driver.id], null);
        }

        let nextTrip = null;
        if (reservedId && driver?.id) {
          try {
            const { data: reservedRow } = await supabase
              .from('trips')
              .select('*')
              .eq('id', reservedId)
              .eq('driver_id', driver.id)
              .maybeSingle();
            if (reservedRow && isLiveDriverTrip(reservedRow)) {
              nextTrip = reservedRow;
            } else if (reservedRow && isReservedNextTrip(reservedRow)) {
              const { data: activated } = await supabase
                .from('trips')
                .update(buildActivateNextTripUpdate())
                .eq('id', reservedId)
                .eq('driver_id', driver.id)
                .eq('status', TRIP_STATUS.ACCEPTED)
                .select()
                .maybeSingle();
              if (activated && isLiveDriverTrip(activated)) nextTrip = activated;
            }
          } catch (nextTripError) {
            console.warn('Error activating next trip:', nextTripError);
          }
        }
        clearReservedNextTrip();

        void (async () => {
          if (driver?.id && !nextTrip) {
            try {
              await supabase.from('drivers').update({ is_available: true }).eq('id', driver.id);
            } catch (availabilityError) {
              console.warn('Error setting driver available:', availabilityError);
            }
          }
          queryClient.invalidateQueries({ queryKey: ['tripHistory'] });
          queryClient.invalidateQueries({ queryKey: ['todayStats'] });
          queryClient.invalidateQueries({ queryKey: ['commissionBalance'] });
          queryClient.invalidateQueries({ queryKey: ['activeTrip'] });
        })();

        return { success: true, data, nextTrip };
      } else {
        updateActiveTrip(data);
        queryClient.invalidateQueries({ queryKey: ['activeTrip'] });
      }

      return { success: true, data };
    } catch (error) {
      const details = String(error?.message || error?.details || '').trim();
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: details ? `No se pudo actualizar el viaje: ${details}` : 'No se pudo actualizar el estado del viaje',
      });
      return { success: false, error };
    }
  }, [driver?.id]);

  const createStreetHailTrip = useCallback(async ({
    lat,
    lng,
    address,
    destination = null,
    startNow = false,
  } = {}) => {
    try {
      if (!driver?.id) {
        Toast.show({ type: 'error', text1: 'Error', text2: 'No se encontró sesión de chofer' });
        return { success: false, error: new Error('driver_not_ready') };
      }

      const store = useTripStore.getState();
      if (isLiveDriverTrip(store.activeTrip)) {
        Toast.show({ type: 'error', text1: 'Viaje activo', text2: 'Terminá el viaje actual para tomar uno en calle.' });
        return { success: false, error: new Error('driver_busy') };
      }
      if (store.pendingTrip?.id) {
        Toast.show({
          type: 'error',
          text1: 'Tenés un viaje asignado',
          text2: 'Aceptá o rechazá la solicitud antes de tomar un viaje en calle.',
        });
        return { success: false, error: new Error('pending_trip') };
      }

      const originLat = Number(lat);
      const originLng = Number(lng);
      if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
        Toast.show({ type: 'error', text1: 'Sin GPS', text2: 'Esperá a que se fije tu ubicación.' });
        return { success: false, error: new Error('origin_required') };
      }

      let originAddress = String(address || '').trim();
      if (!originAddress) {
        try {
          originAddress = await reverseGeocode(originLat, originLng);
        } catch {
          originAddress = `${originLat.toFixed(5)}, ${originLng.toFixed(5)}`;
        }
      }

      const result = await requestStreetHailTrip({
        originAddress,
        originLat,
        originLng,
      });
      let trip = result?.trip;
      if (!trip?.id) {
        throw new Error('create_failed');
      }

      if (startNow) {
        try {
          trip = await applyStreetHailStart({
            tripId: trip.id,
            destination,
            notes: trip.notes,
          });
          const hasDest = Boolean(String(destination?.address || '').trim())
            && Number.isFinite(Number(destination?.lat))
            && Number.isFinite(Number(destination?.lng));
          setDriverFlowStep('in_progress', trip.id, { freeRide: !hasDest });
        } catch (startError) {
          const hasDest = Boolean(String(destination?.address || '').trim());
          setDriverFlowStep(hasDest ? 'set_destination' : 'choose_dest_mode', trip.id);
          setActiveTrip(trip);
          queryClient.setQueryData(['activeTrip', driver.id], trip);
          Toast.show({
            type: 'error',
            text1: 'Atención',
            text2: 'El viaje quedó creado. Tocá Empezar viaje para continuar.',
          });
          return { success: true, data: trip };
        }
      } else {
        setDriverFlowStep('choose_dest_mode', trip.id);
      }
      setActiveTrip(trip);
      queryClient.setQueryData(['activeTrip', driver.id], trip);
      queryClient.invalidateQueries({ queryKey: ['activeTrip'] });

      return { success: true, data: trip };
    } catch (error) {
      const code = String(error?.code || error?.message || '');
      let text2 = 'No se pudo iniciar el viaje en calle.';
      if (code === 'driver_busy') text2 = 'Ya tenés un viaje activo.';
      else if (code === 'driver_blocked') text2 = 'Tu cuenta no puede tomar viajes ahora.';
      else if (code === 'origin_required') text2 = 'No hay ubicación GPS.';
      Toast.show({ type: 'error', text1: 'Error', text2 });
      return { success: false, error };
    }
  }, [driver?.id, queryClient, setActiveTrip, setDriverFlowStep]);

  return {
    useActiveTrip,
    useTripHistory,
    useTodayStats,
    useCommissionBalance,
    acceptTrip,
    rejectTrip,
    releaseAssignedTrip,
    updateTripStatus,
    createStreetHailTrip,
  };
};
