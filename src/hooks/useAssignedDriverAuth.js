import { useCallback, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  lookupAssignedDriverLogin,
  provisionAssignedDriverAuth,
} from '../services/assignedDriverService';
import { normalizeDriverPhone } from '../utils/driverRoles';
import Toast from 'react-native-toast-message';

export function useAssignedDriverAuth({ fetchDriverProfile, loginStore, setLoading }) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetFlow = useCallback(() => {
    setStep('phone');
    setPhone('');
    setPassword('');
    setConfirmPassword('');
    setLookupResult(null);
    setIsSubmitting(false);
  }, []);

  const lookupPhone = useCallback(async (rawPhone) => {
    const normalized = normalizeDriverPhone(rawPhone);
    if (!normalized || normalized.length < 8) {
      Toast.show({
        type: 'error',
        text1: 'Teléfono inválido',
        text2: 'Ingresá un número válido con código de área',
      });
      return null;
    }

    try {
      setIsSubmitting(true);
      const result = await lookupAssignedDriverLogin(normalized);
      if (!result?.found) {
        Toast.show({
          type: 'error',
          text1: 'No autorizado',
          text2: 'Este teléfono no está registrado como chofer asignado',
        });
        return null;
      }

      setLookupResult(result);
      setPhone(rawPhone);
      const needsPasswordSetup = !result.password_initialized || !result.has_user;
      setStep(needsPasswordSetup ? 'setup_password' : 'password');
      return result;
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: error.message || 'No se pudo verificar el teléfono',
      });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const completeAssignedLogin = useCallback(async (driverProfile) => {
    const session = (await supabase.auth.getSession()).data.session;
    const user = session?.user;
    if (!user || !driverProfile) {
      throw new Error('No se pudo iniciar la sesión del chofer asignado');
    }
    loginStore(user, session, driverProfile);
    Toast.show({
      type: 'success',
      text1: '¡Bienvenido!',
      text2: `Hola, ${driverProfile.full_name}`,
    });
  }, [loginStore]);

  const submitPasswordSetup = useCallback(async () => {
    if (!lookupResult?.auth_email) return { success: false };
    if (!password || password.length < 8) {
      Toast.show({ type: 'error', text1: 'Contraseña corta', text2: 'Mínimo 8 caracteres' });
      return { success: false };
    }
    if (password !== confirmPassword) {
      Toast.show({ type: 'error', text1: 'Las contraseñas no coinciden' });
      return { success: false };
    }

    try {
      setIsSubmitting(true);
      setLoading?.(true);

      const provisionResult = await provisionAssignedDriverAuth({
        driverId: lookupResult.driver_id,
        phone,
        password,
      });

      const authEmail = provisionResult?.auth_email || lookupResult.auth_email;
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });
      if (signInError) throw signInError;

      const driverProfile = await fetchDriverProfile(
        (await supabase.auth.getUser()).data.user?.id,
      );
      if (!driverProfile) {
        throw new Error('No se encontró el perfil del chofer asignado');
      }

      await completeAssignedLogin(driverProfile);
      return { success: true };
    } catch (error) {
      let message = error.message || 'No se pudo configurar la contraseña';
      if (message.includes('already registered') || message.includes('ya tiene contraseña')) {
        message = 'Este chofer ya tiene cuenta. Usá tu contraseña registrada.';
        setStep('password');
      } else if (message.toLowerCase().includes('rate limit')) {
        message = 'Demasiados intentos. Esperá unos minutos e intentá de nuevo.';
      }
      Toast.show({ type: 'error', text1: 'Error', text2: message });
      return { success: false, error: message };
    } finally {
      setIsSubmitting(false);
      setLoading?.(false);
    }
  }, [
    lookupResult,
    password,
    confirmPassword,
    fetchDriverProfile,
    completeAssignedLogin,
    setLoading,
  ]);

  const submitPasswordLogin = useCallback(async () => {
    if (!lookupResult?.auth_email || !password) return { success: false };

    try {
      setIsSubmitting(true);
      setLoading?.(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: lookupResult.auth_email,
        password,
      });
      if (error) throw error;

      const driverProfile = await fetchDriverProfile(data.user.id);
      if (!driverProfile) {
        await supabase.auth.signOut();
        throw new Error('No se encontró el perfil del chofer asignado');
      }

      await completeAssignedLogin(driverProfile);
      return { success: true };
    } catch (error) {
      const message = error.message?.includes('Invalid login credentials')
        ? 'Teléfono o contraseña incorrectos'
        : (error.message || 'No se pudo iniciar sesión');
      Toast.show({ type: 'error', text1: 'Error de autenticación', text2: message });
      return { success: false, error: message };
    } finally {
      setIsSubmitting(false);
      setLoading?.(false);
    }
  }, [lookupResult, password, fetchDriverProfile, completeAssignedLogin, setLoading]);

  return {
    step,
    phone,
    password,
    confirmPassword,
    lookupResult,
    isSubmitting,
    setPhone,
    setPassword,
    setConfirmPassword,
    setStep,
    resetFlow,
    lookupPhone,
    submitPasswordSetup,
    submitPasswordLogin,
  };
}
