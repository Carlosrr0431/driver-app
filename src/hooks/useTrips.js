import { useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { TRIP_STATUS, PAGINATION_LIMIT } from '../utils/constants';
import Toast from 'react-native-toast-message';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

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
        if (data) setActiveTrip(data);
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

        return {
          totalTrips,
          totalKm: Math.round(totalKm * 10) / 10,
          totalEarnings,
          totalHours: Math.round((totalMinutes / 60) * 10) / 10,
        };
      },
      enabled: !!driver?.id,
      refetchInterval: 60000,
    });
  };

  const acceptTrip = useCallback(async (tripId) => {
    try {
      const { data, error } = await supabase
        .from('trips')
        .update({
          status: TRIP_STATUS.ACCEPTED,
          accepted_at: new Date().toISOString(),
        })
        .eq('id', tripId)
        .select()
        .single();

      if (error) throw error;

      setActiveTrip(data);
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
  }, []);

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

      if (status === TRIP_STATUS.GOING_TO_PICKUP) {
        updates.pickup_at = new Date().toISOString();
      } else if (status === TRIP_STATUS.IN_PROGRESS) {
        updates.started_at = new Date().toISOString();
      } else if (status === TRIP_STATUS.COMPLETED) {
        updates.completed_at = new Date().toISOString();
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
    acceptTrip,
    rejectTrip,
    updateTripStatus,
  };
};
