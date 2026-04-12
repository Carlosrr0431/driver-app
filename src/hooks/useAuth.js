import { useCallback, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';
import { registerForPushNotifications } from '../services/notifications';
import Toast from 'react-native-toast-message';

export const useAuth = () => {
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          setUser(session.user);
          setSession(session);
          await fetchDriverProfile(session.user.id);
        } else {
          logoutStore();
        }
        setLoading(false);
      }
    );

    checkSession();

    return () => {
      subscription?.unsubscribe();
    };
  }, []);

  const checkSession = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUser(session.user);
        setSession(session);
        await fetchDriverProfile(session.user.id);
      }
    } catch (error) {
      console.error('Error verificando sesión:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchDriverProfile = async (userId) => {
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
      return data;
    } catch (error) {
      console.error('Error obteniendo perfil del chofer:', error);
      return null;
    }
  };

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
  }, []);

  const logout = useCallback(async () => {
    try {
      await supabase.auth.signOut();
      logoutStore();
      Toast.show({
        type: 'info',
        text1: 'Sesión cerrada',
        text2: 'Hasta pronto',
      });
    } catch (error) {
      console.error('Error cerrando sesión:', error);
    }
  }, []);

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
  }, [driver]);

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
