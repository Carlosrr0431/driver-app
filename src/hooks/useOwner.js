import { useCallback, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { startOfDay, endOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth } from 'date-fns';
import {
  buildAssignedDriverAuthEmail,
  buildAssignedDriverInsertPayload,
  buildOwnerAuthEmail,
  isAssignedDriver,
  isFleetOwner,
  MAX_ASSIGNED_DRIVERS,
  normalizeDriverPhone,
} from '../utils/driverRoles';
import { fetchFleetOwnerProfile } from '../services/assignedDriverService';

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
    const query = useQuery({
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
    });

    useEffect(() => {
      if (!driver?.id || driver?.role !== 'owner') return;

      const channel = supabase
        .channel(`owner-today-stats-realtime:${driver.id}`)
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'drivers', filter: `owner_id=eq.${driver.id}` },
          () => {
            queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver.id] });
          }
        )
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'trips' },
          (payload) => {
            if (payload?.new?.status === 'completed') {
              queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver.id] });
            }
          }
        )
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'trips' },
          (payload) => {
            const nextStatus = payload?.new?.status;
            const prevStatus = payload?.old?.status;
            if (nextStatus === 'completed' || prevStatus === 'completed') {
              queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver.id] });
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
    }, [driver?.id, driver?.role, queryClient]);

    return query;
  };

  // ──────────────────────────────────────────────────────────
  // Mutación: invitar chofer asignado (solo nombre + teléfono)
  // ──────────────────────────────────────────────────────────
  const createAssignedDriver = useMutation({
    mutationFn: async ({ fullName, phone }) => {
      if (!driver?.id || driver?.role !== 'owner') {
        throw new Error('Solo el propietario puede agregar choferes asignados');
      }

      const normalizedPhone = normalizeDriverPhone(phone);
      if (!normalizedPhone || normalizedPhone.length < 8) {
        throw new Error('Ingresá un teléfono válido');
      }

      const { count, error: countError } = await supabase
        .from('drivers')
        .select('id', { count: 'exact', head: true })
        .eq('owner_id', driver.id)
        .eq('is_assigned_driver', true);

      if (countError) throw countError;
      if ((count || 0) >= MAX_ASSIGNED_DRIVERS) {
        throw new Error(`Máximo ${MAX_ASSIGNED_DRIVERS} choferes asignados por vehículo`);
      }

      const authEmail = buildAssignedDriverAuthEmail(normalizedPhone);

      const ownerRow = await fetchFleetOwnerProfile(driver.id);
      if (!ownerRow) {
        throw new Error('No se encontró el perfil del vehículo. Reintentá en unos segundos.');
      }

      const { data: newDriver, error: insertError } = await supabase
        .from('drivers')
        .insert(
          buildAssignedDriverInsertPayload(ownerRow, {
            fullName,
            phone,
            phoneNormalized: normalizedPhone,
            authEmail,
          }),
        )
        .select()
        .single();

      if (insertError) {
        if (insertError.message?.includes('idx_drivers_owner_phone_norm')) {
          throw new Error('Ya existe un chofer asignado con ese teléfono');
        }
        throw new Error(insertError.message || 'Error al crear el chofer asignado');
      }

      return newDriver;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedDrivers', driver?.id] });
      queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver?.id] });
    },
  });

  const removeAssignedDriver = useMutation({
    mutationFn: async (assignedDriverId) => {
      const { error } = await supabase
        .from('drivers')
        .delete()
        .eq('id', assignedDriverId)
        .eq('owner_id', driver.id)
        .eq('is_assigned_driver', true);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['linkedDrivers', driver?.id] });
      queryClient.invalidateQueries({ queryKey: ['ownerTodayStats', driver?.id] });
    },
  });

  // ──────────────────────────────────────────────────────────
  // Mutación legacy: crear cuenta con email (compatibilidad)
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

      const { createClient } = await import('@supabase/supabase-js');
      const tempClient = createClient(
        process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
        process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        },
      );

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

      const ownerRow = (await fetchFleetOwnerProfile(driver.id)) || driver;

      const { data: newDriver, error: insertError } = await supabase
        .from('drivers')
        .insert({
          user_id: newUserId,
          owner_id: driver.id,
          role: 'driver',
          is_assigned_driver: true,
          password_initialized: true,
          auth_email: email.trim().toLowerCase(),
          phone_normalized: phone ? normalizeDriverPhone(phone) : null,
          full_name: fullName.trim(),
          phone: phone?.trim() || null,
          driver_number: driverNumber ? parseInt(driverNumber, 10) : ownerRow.driver_number,
          vehicle_brand: vehicleBrand?.trim() || ownerRow.vehicle_brand,
          vehicle_model: vehicleModel?.trim() || ownerRow.vehicle_model,
          vehicle_year: vehicleYear ? parseInt(vehicleYear, 10) : ownerRow.vehicle_year,
          vehicle_plate: vehiclePlate?.trim() || ownerRow.vehicle_plate,
          vehicle_color: vehicleColor?.trim() || ownerRow.vehicle_color,
          vehicle_photo_url: ownerRow.vehicle_photo_url,
          vehicle_type: ownerRow.vehicle_type || 'auto',
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
      if (isAvailable) {
        const { error } = await supabase
          .from('drivers')
          .update({ is_available: true, updated_at: new Date().toISOString() })
          .eq('id', driverId)
          .eq('owner_id', driver.id);
        if (error) throw error;
        return;
      }

      const { error } = await supabase
        .from('drivers')
        .update({ is_available: false, updated_at: new Date().toISOString() })
        .eq('id', driverId)
        .eq('owner_id', driver.id);
      if (error) throw error;

      await supabase
        .from('drivers')
        .update({ vehicle_operator_id: null, updated_at: new Date().toISOString() })
        .eq('id', driver.id)
        .eq('vehicle_operator_id', driverId);
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
    if (driver?.owner_id || driver?.is_assigned_driver) {
      throw new Error('Los choferes asignados no pueden activar el modo propietario');
    }
    const normalizedPhone = normalizeDriverPhone(driver.phone);
    const patch = {
      role: 'owner',
      updated_at: new Date().toISOString(),
    };
    if (normalizedPhone) {
      patch.phone_normalized = normalizedPhone;
      if (!driver.auth_email) {
        patch.auth_email = buildOwnerAuthEmail(normalizedPhone, driver.driver_number);
      }
    }
    const { data, error } = await supabase
      .from('drivers')
      .update(patch)
      .eq('id', driver.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }, [driver?.id, driver?.auth_email, driver?.driver_number, driver?.is_assigned_driver, driver?.owner_id, driver?.phone]);

  return {
    useLinkedDrivers,
    useDriverStats,
    useDriverTripHistory,
    useOwnerTodayStats,
    createAssignedDriver,
    removeAssignedDriver,
    createLinkedDriver,
    toggleDriverStatus,
    updateLinkedDriver,
    becomeOwner,
  };
};
