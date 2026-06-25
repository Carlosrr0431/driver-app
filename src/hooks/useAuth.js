import { useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { clearInvalidAuthSession, isInvalidRefreshTokenError } from '../services/authSession';
import { fetchOwnerVehicleProfile } from '../services/assignedDriverService';
import { isAssignedDriver } from '../utils/driverRoles';
import { useAuthStore } from '../stores/authStore';
import { registerForPushNotifications, subscribeToTokenRefresh } from '../services/notifications';
import Toast from 'react-native-toast-message';

const globalScope = globalThis;

const getGlobalAuthRuntime = () => {
  if (!globalScope.__driverAppAuthRuntime) {
    globalScope.__driverAppAuthRuntime = {
      bootstrapRunning: false,
      tokenRefreshSub: null,
    };
  }
  return globalScope.__driverAppAuthRuntime;
};

const clearTokenRefreshSub = () => {
  const runtime = getGlobalAuthRuntime();
  if (!runtime.tokenRefreshSub) return;
  try {
    runtime.tokenRefreshSub.remove();
  } catch (_) {}
  runtime.tokenRefreshSub = null;
};

const syncTokenRefreshSub = (driverId) => {
  const runtime = getGlobalAuthRuntime();
  clearTokenRefreshSub();
  if (!driverId) return;
  runtime.tokenRefreshSub = subscribeToTokenRefresh(driverId);
};

const handleInvalidRefreshToken = async (logoutStore) => {
  await clearInvalidAuthSession();
  clearTokenRefreshSub();
  logoutStore();
};

export const useAuth = (options = {}) => {
  const { enableBootstrap = false } = options;

  const {
    user,
    driver,
    session,
    isLoading,
    isAuthenticated,
    setUser,
    setDriver,
    setSession,
    setLoading,
    login: loginStore,
    logout: logoutStore,
    updateDriver,
  } = useAuthStore();

  const fetchDriverProfile = useCallback(async (userId) => {
    try {
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error) throw error;

      let profile = { ...data };

      if (isAssignedDriver(profile) && profile.owner_id) {
        const ownerVehicle = await fetchOwnerVehicleProfile(profile.owner_id);
        if (ownerVehicle) {
          profile = {
            ...profile,
            owner_name: ownerVehicle.full_name,
            owner_phone: ownerVehicle.phone || profile.owner_phone,
            vehicle_brand: ownerVehicle.vehicle_brand || profile.vehicle_brand,
            vehicle_model: ownerVehicle.vehicle_model || profile.vehicle_model,
            vehicle_year: ownerVehicle.vehicle_year ?? profile.vehicle_year,
            vehicle_plate: ownerVehicle.vehicle_plate || profile.vehicle_plate,
            vehicle_color: ownerVehicle.vehicle_color || profile.vehicle_color,
            vehicle_photo_url: ownerVehicle.vehicle_photo_url || profile.vehicle_photo_url,
            vehicle_type: ownerVehicle.vehicle_type || profile.vehicle_type,
            driver_number: profile.driver_number ?? ownerVehicle.driver_number,
          };
        }
      }

      // If vehicle_type is not in the data (column doesn't exist yet), check settings fallback
      if (profile && !profile.vehicle_type) {
        try {
          const { data: setting } = await supabase
            .from('settings')
            .select('value')
            .eq('key', `vehicle_type_${profile.id}`)
            .single();
          if (setting?.value) {
            profile.vehicle_type = setting.value;
          }
        } catch (_) {}
      }

      setDriver(profile);
      registerForPushNotifications(profile.id).catch(console.warn);
      syncTokenRefreshSub(profile.id);
      return profile;
    } catch (error) {
      console.error('Error obteniendo perfil del chofer:', error);
      return null;
    }
  }, [setDriver]);

  useEffect(() => {
    if (!enableBootstrap) return undefined;

    const runtime = getGlobalAuthRuntime();
    if (runtime.bootstrapRunning) {
      return undefined;
    }
    runtime.bootstrapRunning = true;

    let initialized = false;

    const runDeferredAuthWork = (work) => {
      queueMicrotask(() => {
        work().catch(async (error) => {
          if (isInvalidRefreshTokenError(error)) {
            await handleInvalidRefreshToken(logoutStore);
            return;
          }
          console.error('Error procesando cambio de sesión:', error);
        });
      });
    };

    const finishBootstrap = () => {
      setLoading(false);
      initialized = true;
    };

    const clearAuthenticatedState = () => {
      clearTokenRefreshSub();
      logoutStore();
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession?.user) {
        setUser(nextSession.user);
        setSession(nextSession);
        finishBootstrap();
        runDeferredAuthWork(() => fetchDriverProfile(nextSession.user.id));
        return;
      }

      if (event === 'SIGNED_OUT') {
        clearAuthenticatedState();
        finishBootstrap();
        return;
      }

      if (event === 'TOKEN_REFRESHED') {
        if (nextSession) {
          setSession(nextSession);
          if (nextSession.user) {
            setUser(nextSession.user);
          }
        } else {
          clearAuthenticatedState();
          runDeferredAuthWork(() => clearInvalidAuthSession());
        }
        finishBootstrap();
        return;
      }

      if (event === 'INITIAL_SESSION') {
        if (!nextSession) {
          clearAuthenticatedState();
        }
        finishBootstrap();
        return;
      }

      if (!initialized && !nextSession) {
        clearAuthenticatedState();
        finishBootstrap();
      }
    });

    return () => {
      subscription?.unsubscribe();
      runtime.bootstrapRunning = false;
      clearTokenRefreshSub();
    };
  }, [enableBootstrap, fetchDriverProfile, logoutStore, setLoading, setSession, setUser]);

  const login = useCallback(async (email, password) => {
    try {
      setLoading(true);
      const { data, error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (error) throw error;

      const driverProfile = await fetchDriverProfile(data.user.id);
      if (!driverProfile) {
        await supabase.auth.signOut();
        throw new Error('No se encontró un perfil de chofer asociado a esta cuenta.');
      }

      loginStore(data.user, data.session, driverProfile);

      Toast.show({
        type: 'success',
        text1: '¡Bienvenido!',
        text2: `Hola, ${driverProfile.full_name}`,
      });

      return { success: true };
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await handleInvalidRefreshToken(logoutStore);
      }

      let message = 'Error al iniciar sesión';
      if (error.message?.includes('Invalid login credentials')) {
        message = 'Email o contraseña incorrectos';
      } else if (error.message?.includes('Email not confirmed')) {
        message = 'Debes confirmar tu email antes de iniciar sesión';
      } else if (error.message) {
        message = error.message;
      }

      Toast.show({
        type: 'error',
        text1: 'Error de autenticación',
        text2: message,
      });

      return { success: false, error: message };
    } finally {
      setLoading(false);
    }
  }, [fetchDriverProfile, loginStore, logoutStore, setLoading]);

  const logout = useCallback(async () => {
    try {
      const currentDriver = useAuthStore.getState().driver;
      if (currentDriver?.id && currentDriver?.is_available) {
        try {
          const { setDriverOnlineStatus } = await import('../services/assignedDriverService');
          await setDriverOnlineStatus(currentDriver.id, false);
        } catch (_) {}
      }
      clearTokenRefreshSub();
      await supabase.auth.signOut();
      logoutStore();
      Toast.show({
        type: 'info',
        text1: 'Sesión cerrada',
        text2: 'Hasta pronto',
      });
    } catch (error) {
      if (isInvalidRefreshTokenError(error)) {
        await handleInvalidRefreshToken(logoutStore);
        return;
      }
      console.error('Error cerrando sesión:', error);
    }
  }, [logoutStore]);

  const updateProfile = useCallback(async (updates) => {
    try {
      if (!driver?.id) return { success: false };

      const { data, error } = await supabase
        .from('drivers')
        .update(updates)
        .eq('id', driver.id)
        .select()
        .single();

      if (error) throw error;

      updateDriver(data);
      Toast.show({
        type: 'success',
        text1: 'Perfil actualizado',
      });

      return { success: true, data };
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo actualizar el perfil',
      });
      return { success: false, error };
    }
  }, [driver, updateDriver]);

  return {
    user,
    driver,
    session,
    isLoading,
    isAuthenticated,
    login,
    logout,
    updateProfile,
    fetchDriverProfile,
  };
};
