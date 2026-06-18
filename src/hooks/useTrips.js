import { useCallback, useEffect } from 'react';
import { useQuery, useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { TRIP_STATUS, PAGINATION_LIMIT, TRIP_ACCEPT_TIMEOUT } from '../utils/constants';
import Toast from 'react-native-toast-message';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import { notifyTripAcceptedTransition } from '../services/tripTransition';
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

const rejectInFlightTripIds = new Set();

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
          .limit(1)
          .maybeSingle();

        if (error) throw error;
        if (data) {
          const currentActiveTrip = useTripStore.getState().activeTrip;
          const enriched = enrichApproachTrip(data, currentActiveTrip?.id === data.id ? currentActiveTrip : null);
          setActiveTrip(enriched);
        }
        return data;
      },
      enabled: !!driver?.id,
    });

    useEffect(() => {
      if (!driver?.id) return;

      const channel = supabase
        .channel(`active-trip-realtime:${driver.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'trips', filter: `driver_id=eq.${driver.id}` },
          (payload) => {
            const trip = payload?.new;
            if (trip) {
              const currentActiveTrip = useTripStore.getState().activeTrip;

              if (
                trip.status === TRIP_STATUS.ACCEPTED
                || trip.status === TRIP_STATUS.GOING_TO_PICKUP
                || trip.status === TRIP_STATUS.IN_PROGRESS
              ) {
                const enriched = enrichApproachTrip(
                  trip,
                  currentActiveTrip?.id === trip.id ? currentActiveTrip : null
                );
                setActiveTrip(enriched);
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
        .channel(`today-stats-realtime:${driver.id}`)
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
          .select('pending_commission, last_commission_payment_at')
          .eq('id', driver.id)
          .single();

        if (driverErr) throw driverErr;

        const balance = Math.round((Number(driverData?.pending_commission) || 0) * 100) / 100;
        const lastPaymentDate = driverData?.last_commission_payment_at
          ? new Date(driverData.last_commission_payment_at)
          : null;

        // isOverdue: tiene saldo y el último pago fue hace más de 3 días (o nunca pagó)
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const isOverdue = balance > 0 && (!lastPaymentDate || lastPaymentDate < threeDaysAgo);

        return {
          balance,
          isOverdue,
          isBlocked: isOverdue,
        };
      },
      enabled: !!driver?.id,
    });

    useEffect(() => {
      if (!driver?.id) return;

      const channel = supabase
        .channel(`commission-balance-realtime:${driver.id}`)
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

      // Accept first, verify commissions after — speed is critical with short timeouts.
      const timeout = createTimeoutController(10000);
      const { data, error } = await supabase
        .from('trips')
        .update({
          status: TRIP_STATUS.GOING_TO_PICKUP,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', tripId)
        .eq('driver_id', driver.id)
        .eq('status', TRIP_STATUS.PENDING)
        .abortSignal(timeout.signal)
        .select()
        .maybeSingle();
      timeout.cleanup();

      if (error) throw error;

      if (!data) {
        clearPendingTrip();
        Toast.show({
          type: 'error',
          text1: 'Tiempo agotado',
          text2: 'El viaje ya no está disponible para aceptar.',
        });
        return { success: false, isTimeout: true };
      }

      const enrichedActiveTrip = enrichApproachTrip(data, pendingTripSnapshot?.id === tripId ? pendingTripSnapshot : null);
      setActiveTrip(enrichedActiveTrip);
      clearPendingTrip();
      queryClient.invalidateQueries({ queryKey: ['activeTrip'] });

      Toast.show({
        type: 'success',
        text1: '¡Viaje aceptado!',
        text2: 'Dirígete al punto de recogida',
      });

      notifyTripAcceptedTransition(data.id).catch((notifyError) => {
        console.warn(
          'No se pudo disparar la confirmacion inmediata por WhatsApp:',
          notifyError?.message || notifyError
        );
      });

      // Commission check async — don't block acceptance
      (async () => {
        try {
          const commTimeout = createTimeoutController(5000);
          const { data: commTrips } = await supabase
            .from('trips')
            .select('commission_amount, completed_at')
            .eq('driver_id', driver.id)
            .eq('status', TRIP_STATUS.COMPLETED)
            .gt('commission_amount', 0)
            .order('completed_at', { ascending: true })
            .abortSignal(commTimeout.signal);
          commTimeout.cleanup();

          let payments = [];
          try {
            const payTimeout = createTimeoutController(5000);
            const { data: payData } = await supabase
              .from('commission_payments')
              .select('amount, created_at')
              .eq('driver_id', driver.id)
              .order('created_at', { ascending: false })
              .abortSignal(payTimeout.signal);
            payTimeout.cleanup();
            payments = payData || [];
          } catch (_) {}

          const totalComm = (commTrips || []).reduce((s, t) => s + (Number(t.commission_amount) || 0), 0);
          const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const balance = totalComm - totalPaid;

          if (balance > 0) {
            const lastPayDate = payments.length > 0 ? new Date(payments[0].created_at) : null;
            const unpaidTrips = lastPayDate
              ? (commTrips || []).filter((t) => new Date(t.completed_at) > lastPayDate)
              : (commTrips || []);
            const oldest = unpaidTrips.length > 0 ? unpaidTrips[0] : null;
            const threeDaysAgo = new Date();
            threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
            if (oldest && new Date(oldest.completed_at) < threeDaysAgo) {
              Toast.show({
                type: 'error',
                text1: 'Comisiones pendientes',
                text2: 'Regularizá tus comisiones. El próximo viaje será bloqueado.',
                visibilityTime: 5000,
              });
            }
          }
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
  }, [driver?.id, clearPendingTrip, queryClient, setActiveTrip]);

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

      if (status === TRIP_STATUS.COMPLETED) {
        clearActiveTrip();
        // Limpieza en segundo plano: no bloquear la UI del chofer al finalizar.
        void (async () => {
          if (driver?.id) {
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

  return {
    useActiveTrip,
    useTripHistory,
    useTodayStats,
    useCommissionBalance,
    acceptTrip,
    rejectTrip,
    updateTripStatus,
  };
};
