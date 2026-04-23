import { useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';

const SUPABASE_URL = 'https://xzabzbrolmkezljsyycr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7NIfu3DWpS_73AyUfJIpmQ_O3yG38wq';

// Crea un cliente temporal sin sesión persistente para crear usuarios
// sin afectar la sesión actual del propietario.
function createTempClient() {
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function getDateRange(filter) {
  const now = new Date();
  switch (filter) {
    case 'today':
      return { from: startOfDay(now).toISOString(), to: endOfDay(now).toISOString() };
    case 'week':
      return { from: startOfWeek(now, { weekStartsOn: 1 }).toISOString(), to: endOfWeek(now, { weekStartsOn: 1 }).toISOString() };
    case 'month':
      return { from: startOfMonth(now).toISOString(), to: endOfMonth(now).toISOString() };
    default:
      return { from: new Date('2020-01-01').toISOString(), to: endOfDay(now).toISOString() };
  }
}

export const useOwner = () => {
  const { driver } = useAuthStore();
  const queryClient = useQueryClient();

  // ──────────────────────────────────────────────────────────
  // Hook: listar conductores vinculados al propietario
  // ──────────────────────────────────────────────────────────
  const useLinkedDrivers = () => {
    return useQuery({
      queryKey: ['linkedDrivers', driver?.id],
      queryFn: async () => {
        if (!driver?.id) return [];
        const { data, error } = await supabase
          .from('drivers')
          .select('*')
          .eq('owner_id', driver.id)
          .order('full_name', { ascending: true });
        if (error) throw error;
        return data || [];
      },
      enabled: !!driver?.id && driver?.role === 'owner',
      staleTime: 30_000,
    });
  };

  // ──────────────────────────────────────────────────────────
  // Hook: estadísticas de un conductor para el período dado
  // ──────────────────────────────────────────────────────────
  const useDriverStats = (driverId, filter = 'today') => {
    const { from, to } = getDateRange(filter);
    return useQuery({
      queryKey: ['driverStats', driverId, filter],
      queryFn: async () => {
        if (!driverId) return null;
        const { data, error } = await supabase
          .from('trips')
          .select('id, status, price, commission_amount, created_at')
          .eq('driver_id', driverId)
          .gte('created_at', from)
          .lte('created_at', to);
        if (error) throw error;
        const trips = data || [];
        const completed = trips.filter(t => t.status === 'completed');
        const cancelled = trips.filter(t => t.status === 'cancelled');
        return {
          totalTrips: trips.length,
          completedTrips: completed.length,
          cancelledTrips: cancelled.length,
          totalEarnings: completed.reduce((s, t) => s + (Number(t.price) || 0), 0),
          totalCommission: completed.reduce((s, t) => s + (Number(t.commission_amount) || 0), 0),
        };
      },
      enabled: !!driverId,
      staleTime: 30_000,
    });
  };

  // ──────────────────────────────────────────────────────────
  // Hook: historial de viajes de un conductor vinculado
  // ──────────────────────────────────────────────────────────
  const useDriverTripHistory = (driverId, filter = 'all') => {
    const PAGE_SIZE = 20;
    const { from, to } = getDateRange(filter);
    return useInfiniteQuery({
      queryKey: ['driverTripHistory', driverId, filter],
      queryFn: async ({ pageParam = 0 }) => {
        const { data, error } = await supabase
          .from('trips')
          .select('id, status, price, commission_amount, origin_address, destination_address, passenger_name, created_at, completed_at, distance_km')
          .eq('driver_id', driverId)
          .gte('created_at', from)
          .lte('created_at', to)
          .order('created_at', { ascending: false })
          .range(pageParam, pageParam + PAGE_SIZE - 1);
        if (error) throw error;
        return { data: data || [], nextOffset: data?.length === PAGE_SIZE ? pageParam + PAGE_SIZE : undefined };
      },
      getNextPageParam: (lastPage) => lastPage.nextOffset,
      enabled: !!driverId,
      staleTime: 30_000,
    });
  };

  // ──────────────────────────────────────────────────────────
  // Hook: totales rápidos de TODOS los conductores vinculados (hoy)
  // ──────────────────────────────────────────────────────────
  const useOwnerTodayStats = () => {
    const { from, to } = getDateRange('today');
    return useQuery({
      queryKey: ['ownerTodayStats', driver?.id],
      queryFn: async () => {
        if (!driver?.id) return { totalEarnings: 0, totalTrips: 0, activeDrivers: 0 };

        // IDs de conductores vinculados
        const { data: linkedDrivers, error: driversError } = await supabase
          .from('drivers')
          .select('id, is_available')
          .eq('owner_id', driver.id);
        if (driversError) throw driversError;
        if (!linkedDrivers?.length) return { totalEarnings: 0, totalTrips: 0, activeDrivers: 0 };

        const ids = linkedDrivers.map(d => d.id);
        const activeDrivers = linkedDrivers.filter(d => d.is_available).length;

        const { data: trips, error: tripsError } = await supabase
          .from('trips')
          .select('price, status')
          .in('driver_id', ids)
          .eq('status', 'completed')
          .gte('created_at', from)
          .lte('created_at', to);
        if (tripsError) throw tripsError;

        return {
          totalEarnings: (trips || []).reduce((s, t) => s + (Number(t.price) || 0), 0),
          totalTrips: (trips || []).length,
          activeDrivers,
          totalDrivers: linkedDrivers.length,
        };
      },
      enabled: !!driver?.id && driver?.role === 'owner',
      staleTime: 30_000,
      refetchInterval: 60_000,
    });
  };

  // ──────────────────────────────────────────────────────────
  // Mutación: crear cuenta de conductor vinculado
  // ──────────────────────────────────────────────────────────
  const createLinkedDriver = useMutation({
    mutationFn: async ({
      email,
      password,
      fullName,
      phone,
      driverNumber,
      vehicleBrand,
      vehicleModel,
      vehicleYear,
      vehiclePlate,
      vehicleColor,
    }) => {
      if (!driver?.id) throw new Error('No hay propietario autenticado');

      // 1. Crear el usuario de autenticación con un cliente temporal
      //    (sin afectar la sesión actual del propietario)
      const tempClient = createTempClient();
      const { data: signUpData, error: signUpError } = await tempClient.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
      });

      if (signUpError) {
        if (signUpError.message?.toLowerCase().includes('already registered')) {
          throw new Error('El correo ya está registrado en el sistema.');
        }
        throw new Error(signUpError.message || 'Error al crear la cuenta.');
      }

      const newUserId = signUpData.user?.id;
      if (!newUserId) throw new Error('No se pudo obtener el ID del nuevo usuario.');

      // 2. Insertar el perfil del conductor vinculado al propietario
      const { data: newDriver, error: insertError } = await supabase
        .from('drivers')
        .insert({
          user_id: newUserId,
          owner_id: driver.id,
          role: 'driver',
          full_name: fullName.trim(),
          phone: phone?.trim() || null,
          driver_number: driverNumber ? parseInt(driverNumber, 10) : null,
          vehicle_brand: vehicleBrand?.trim() || null,
          vehicle_model: vehicleModel?.trim() || null,
          vehicle_year: vehicleYear ? parseInt(vehicleYear, 10) : null,
          vehicle_plate: vehiclePlate?.trim() || null,
          vehicle_color: vehicleColor?.trim() || null,
          is_available: false,
          rating: 5.0,
          total_trips: 0,
          total_km: 0,
        })
        .select()
        .single();

      if (insertError) throw new Error(insertError.message || 'Error al crear el perfil del conductor.');

      return newDriver;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedDrivers', driver?.id] });
      queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver?.id] });
    },
  });

  // ──────────────────────────────────────────────────────────
  // Mutación: cambiar estado activo/inactivo de un conductor
  // ──────────────────────────────────────────────────────────
  const toggleDriverStatus = useMutation({
    mutationFn: async ({ driverId, isAvailable }) => {
      const { error } = await supabase
        .from('drivers')
        .update({ is_available: isAvailable, updated_at: new Date().toISOString() })
        .eq('id', driverId)
        .eq('owner_id', driver.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedDrivers', driver?.id] });
      queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver?.id] });
    },
  });

  // ──────────────────────────────────────────────────────────
  // Mutación: actualizar datos básicos de un conductor vinculado
  // ──────────────────────────────────────────────────────────
  const updateLinkedDriver = useMutation({
    mutationFn: async ({ driverId, updates }) => {
      const { data, error } = await supabase
        .from('drivers')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', driverId)
        .eq('owner_id', driver.id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, { driverId }) => {
      queryClient.invalidateQueries({ queryKey: ['linkedDrivers', driver?.id] });
      queryClient.invalidateQueries({ queryKey: ['driverStats', driverId] });
    },
  });

  // ──────────────────────────────────────────────────────────
  // Mutación: promover al propietario (cambiar role a 'owner')
  // ──────────────────────────────────────────────────────────
  const becomeOwner = useCallback(async () => {
    if (!driver?.id) throw new Error('No hay conductor autenticado');
    const { data, error } = await supabase
      .from('drivers')
      .update({ role: 'owner', updated_at: new Date().toISOString() })
      .eq('id', driver.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }, [driver?.id]);

  return {
    useLinkedDrivers,
    useDriverStats,
    useDriverTripHistory,
    useOwnerTodayStats,
    createLinkedDriver,
    toggleDriverStatus,
    updateLinkedDriver,
    becomeOwner,
  };
};
