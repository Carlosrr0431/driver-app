import { useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
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

const isInvalidRefreshTokenError = (error) => {
  const message = error?.message || '';
  return /Invalid Refresh Token|Already Used|Refresh Token Not Found/i.test(message);
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

      // If vehicle_type is not in the data (column doesn't exist yet), check settings fallback
      if (data && !data.vehicle_type) {
        try {
          const { data: setting } = await supabase
            .from('settings')
            .select('value')
            .eq('key', `vehicle_type_${data.id}`)
            .single();
          if (setting?.value) {
            data.vehicle_type = setting.value;
          }
        } catch (_) {}
      }

      setDriver(data);
      // Register push notifications after we have the driver profile
      registerForPushNotifications(data.id).catch(console.warn);
      // Keep only one onTokenRefresh listener alive globally
      syncTokenRefreshSub(data.id);
      return data;
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

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, nextSession) => {
        try {
          if (nextSession?.user) {
            setUser(nextSession.user);
            setSession(nextSession);
            await fetchDriverProfile(nextSession.user.id);
          } else if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !nextSession)) {
            clearTokenRefreshSub();
            logoutStore();
          } else if (!initialized && !nextSession) {
            clearTokenRefreshSub();
            logoutStore();
          }
        } catch (error) {
          if (isInvalidRefreshTokenError(error)) {
            try {
              await supabase.auth.signOut({ scope: 'local' });
            } catch (_) {}
            clearTokenRefreshSub();
            logoutStore();
          } else {
            console.error('Error procesando cambio de sesión:', error);
          }
        } finally {
          setLoading(false);
          initialized = true;
        }
      }
    );

    supabase.auth
      .getSession()
      .then(({ data: { session: cachedSession } }) => {
        if (!initialized && !cachedSession) {
          setLoading(false);
        }
      })
      .catch(async (error) => {
        if (isInvalidRefreshTokenError(error)) {
          try {
            await supabase.auth.signOut({ scope: 'local' });
          } catch (_) {}
          clearTokenRefreshSub();
          logoutStore();
          setLoading(false);
          return;
        }
        if (!initialized) setLoading(false);
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
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch (_) {}
        clearTokenRefreshSub();
        logoutStore();
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
        try {
          await supabase.auth.signOut({ scope: 'local' });
        } catch (_) {}
        clearTokenRefreshSub();
        logoutStore();
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
