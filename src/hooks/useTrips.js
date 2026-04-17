import { useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { TRIP_STATUS, PAGINATION_LIMIT } from '../utils/constants';
import Toast from 'react-native-toast-message';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

function enrichApproachTrip(trip, fallback = null) {
  if (!trip) return trip;
  const notes = String(trip.notes || fallback?.notes || '');
  const isApproachOnly = notes.includes('[APPROACH_ONLY]');
  if (!isApproachOnly) return { ...fallback, ...trip };

  const destinationAddress = trip.destination_address || fallback?.destination_address || null;
  const destinationLat = trip.destination_lat ?? fallback?.destination_lat ?? null;
  const destinationLng = trip.destination_lng ?? fallback?.destination_lng ?? null;

  return {
    ...fallback,
    ...trip,
    is_approach_only: true,
    pickup_override_address: destinationAddress,
    pickup_override_lat: destinationLat,
    pickup_override_lng: destinationLng,
  };
}

export const useTrips = () => {
  const { driver } = useAuthStore();
  const {
    setActiveTrip,
    setPendingTrip,
    clearActiveTrip,
    clearPendingTrip,
    updateActiveTrip,
  } = useTripStore();
  const queryClient = useQueryClient();

  const useActiveTrip = () => {
    return useQuery({
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
      refetchInterval: 30000,
    });
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
    return useQuery({
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
      refetchInterval: 60000,
    });
  };

  const useCommissionBalance = () => {
    return useQuery({
      queryKey: ['commissionBalance', driver?.id],
      queryFn: async () => {
        if (!driver?.id) return null;

        // Fetch all completed trips' commission amounts
        const { data: trips, error: tripsErr } = await supabase
          .from('trips')
          .select('commission_amount, completed_at')
          .eq('driver_id', driver.id)
          .eq('status', TRIP_STATUS.COMPLETED)
          .gt('commission_amount', 0)
          .order('completed_at', { ascending: true });

        if (tripsErr) throw tripsErr;

        // Fetch all commission payments
        let payments = [];
        try {
          const { data: payData } = await supabase
            .from('commission_payments')
            .select('amount, created_at')
            .eq('driver_id', driver.id)
            .order('created_at', { ascending: false });
          payments = payData || [];
        } catch (_) {}

        const totalCommission = (trips || []).reduce((s, t) => s + (Number(t.commission_amount) || 0), 0);
        const totalPaid = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
        const balance = Math.round((totalCommission - totalPaid) * 100) / 100;

        // Check if overdue (3 days)
        const lastPaymentDate = payments.length > 0 ? new Date(payments[0].created_at) : null;
        const tripsAfterPayment = lastPaymentDate
          ? (trips || []).filter((t) => new Date(t.completed_at) > lastPaymentDate)
          : (trips || []);
        const oldestUnpaid = tripsAfterPayment.length > 0 ? tripsAfterPayment[0] : null;
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        const isOverdue = balance > 0 && oldestUnpaid && new Date(oldestUnpaid.completed_at) < threeDaysAgo;

        return {
          totalCommission,
          totalPaid,
          balance,
          isOverdue,
          isBlocked: isOverdue,
        };
      },
      enabled: !!driver?.id,
      refetchInterval: 60000,
    });
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

      // Check commission balance before accepting
      const { data: commTrips } = await supabase
        .from('trips')
        .select('commission_amount, completed_at')
        .eq('driver_id', driver.id)
        .eq('status', TRIP_STATUS.COMPLETED)
        .gt('commission_amount', 0)
        .order('completed_at', { ascending: true });

      let payments = [];
      try {
        const { data: payData } = await supabase
          .from('commission_payments')
          .select('amount, created_at')
          .eq('driver_id', driver.id)
          .order('created_at', { ascending: false });
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
            text1: 'Cuenta bloqueada',
            text2: 'Regularizá tus comisiones pendientes para aceptar viajes',
            visibilityTime: 5000,
          });
          clearPendingTrip();
          return { success: false, blocked: true };
        }
      }

      const { data, error } = await supabase
        .from('trips')
        .update({
          status: TRIP_STATUS.GOING_TO_PICKUP,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', tripId)
        .select()
        .single();

      if (error) throw error;

      const enrichedActiveTrip = enrichApproachTrip(data, pendingTripSnapshot?.id === tripId ? pendingTripSnapshot : null);
      setActiveTrip(enrichedActiveTrip);
      clearPendingTrip();
      queryClient.invalidateQueries({ queryKey: ['activeTrip'] });

      Toast.show({
        type: 'success',
        text1: '¡Viaje aceptado!',
        text2: 'Dirígete al punto de recogida',
      });

      return { success: true, data };
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo aceptar el viaje',
      });
      return { success: false, error };
    }
  }, [driver?.id, clearPendingTrip, queryClient, setActiveTrip]);

  const rejectTrip = useCallback(async (tripId, reason) => {
    try {
      const { error } = await supabase
        .from('trips')
        .update({
          status: TRIP_STATUS.CANCELLED,
          cancel_reason: reason,
          driver_id: null,
        })
        .eq('id', tripId);

      if (error) throw error;

      clearPendingTrip();

      Toast.show({
        type: 'info',
        text1: 'Viaje rechazado',
        text2: 'Se notificará al despachador',
      });

      return { success: true };
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo rechazar el viaje',
      });
      return { success: false, error };
    }
  }, []);

  const updateTripStatus = useCallback(async (tripId, status, extraFields = {}) => {
    try {
      const updates = { status, ...extraFields };

      if (status === TRIP_STATUS.IN_PROGRESS) {
        updates.started_at = new Date().toISOString();
      } else if (status === TRIP_STATUS.COMPLETED) {
        updates.completed_at = new Date().toISOString();

        // Calculate actual distance and price from tariff
        const { tripDistanceKm, tripTimer } = useTripStore.getState();
        const distKm = Math.round(tripDistanceKm * 10) / 10;
        updates.distance_km = distKm;
        updates.duration_minutes = Math.round(tripTimer / 60);

        // Fetch tariff settings for price calculation
        try {
          const { data: settingsData } = await supabase
            .from('settings')
            .select('key, value')
            .in('key', ['tariff_per_km', 'tariff_base', 'commission_percent']);
          const settingsMap = {};
          (settingsData || []).forEach(r => { settingsMap[r.key] = parseFloat(r.value) || 0; });
          const tariffBase = settingsMap.tariff_base || 0;
          const tariffPerKm = settingsMap.tariff_per_km || 0;
          const commissionPercent = settingsMap.commission_percent || 10;
          const totalPrice = Math.round(tariffBase + tariffPerKm * distKm);
          updates.price = totalPrice;
          updates.commission_amount = Math.round(totalPrice * commissionPercent / 100);
        } catch (e) {
          console.warn('Error fetching tariff settings:', e);
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
        queryClient.invalidateQueries({ queryKey: ['tripHistory'] });
        queryClient.invalidateQueries({ queryKey: ['todayStats'] });
      } else {
        updateActiveTrip(data);
      }

      queryClient.invalidateQueries({ queryKey: ['activeTrip'] });

      return { success: true, data };
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo actualizar el estado del viaje',
      });
      return { success: false, error };
    }
  }, []);

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
