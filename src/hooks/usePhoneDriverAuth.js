import { useCallback, useState } from 'react';
import { supabase } from '../services/supabase';
import {
  lookupDriverEmailLogin,
  lookupDriverPhoneLogin,
  provisionDriverEmailAuth,
  provisionDriverPhoneAuth,
  resolveUnifiedDriverPhoneLogin,
} from '../services/assignedDriverService';
import {
  classifyLoginIdentifier,
  extractLocalArMobileDigits,
  isCompleteLoginEmail,
  isSyntheticAuthEmail,
  normalizeDriverPhone,
  normalizeLoginEmail,
} from '../utils/driverRoles';
import Toast from 'react-native-toast-message';

function applyFoundLookup(result, rawPhone, setters) {
  setters.setLookupResult(result);
  setters.setPhone(rawPhone);
  if (result.driver_number != null) {
    setters.setDriverNumber(String(result.driver_number));
  }
  const needsPasswordSetup = !result.password_initialized || !result.has_user;
  setters.setStep(needsPasswordSetup ? 'setup_password' : 'password');
}

function isEmailLoginResult(result) {
  return result?.login_channel === 'email'
    || Boolean(result?.login_email && !result?.auth_email?.endsWith?.('@profesional.test'));
}

/**
 * Login por teléfono o correo: dueños, titulares y choferes asignados.
 * Primera vez → configurar contraseña vía API del dashboard (sin email/SMS).
 * Teléfono y correo usan cuentas Auth distintas (claves distintas).
 */
export function usePhoneDriverAuth({
  fetchDriverProfile,
  loginStore,
  setLoading,
  lookupFn = null,
  loginKind = null,
  notFoundMessage = 'Este teléfono no está registrado en Profesional',
}) {
  const [step, setStep] = useState('phone');
  const [phone, setPhone] = useState('');
  const [driverNumber, setDriverNumber] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [lookupResult, setLookupResult] = useState(null);
  const [driverChoices, setDriverChoices] = useState([]);
  const [accountChoices, setAccountChoices] = useState(null);
  const [forcedLoginKind, setForcedLoginKind] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const resetFlow = useCallback(() => {
    setStep('phone');
    setPhone('');
    setDriverNumber('');
    setPassword('');
    setConfirmPassword('');
    setLookupResult(null);
    setDriverChoices([]);
    setAccountChoices(null);
    setForcedLoginKind(null);
    setIsSubmitting(false);
  }, []);

  const runEmailLookup = useCallback(async (rawEmail) => {
    const email = normalizeLoginEmail(rawEmail);
    if (!isCompleteLoginEmail(email) || isSyntheticAuthEmail(email)) {
      Toast.show({
        type: 'error',
        text1: 'Correo inválido',
        text2: 'Ingresá un correo personal, por ejemplo nombre@gmail.com',
      });
      return null;
    }

    try {
      setIsSubmitting(true);
      const result = await lookupDriverEmailLogin(email);
      if (!result?.found) {
        Toast.show({
          type: 'error',
          text1: 'No autorizado',
          text2: 'Este correo no está registrado en Profesional',
        });
        return null;
      }

      applyFoundLookup(result, email, {
        setLookupResult,
        setPhone,
        setDriverNumber,
        setStep,
      });
      return result;
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: error.message || 'No se pudo verificar el correo',
      });
      return null;
    } finally {
      setIsSubmitting(false);
    }
  }, []);

  const runLookup = useCallback(async (rawPhone, rawDriverNumber = null) => {
    const local = extractLocalArMobileDigits(rawPhone);
    const normalized = local
      ? normalizeDriverPhone(local)
      : normalizeDriverPhone(rawPhone);
    if (!local || !normalized || normalized.length < 12) {
      Toast.show({
        type: 'error',
        text1: 'Teléfono inválido',
        text2: 'Ingresá el código de área y el número (10 dígitos, sin 0 ni +54)',
      });
      return null;
    }

    const parsedDriverNumber = rawDriverNumber != null && String(rawDriverNumber).trim() !== ''
      ? Number.parseInt(String(rawDriverNumber).trim(), 10)
      : null;

    const resolvedKind = forcedLoginKind || loginKind;
    const resolvedLookup = lookupFn
      || (resolvedKind ? lookupDriverPhoneLogin : resolveUnifiedDriverPhoneLogin);

    try {
      setIsSubmitting(true);
      const result = resolvedKind
        ? await lookupDriverPhoneLogin(normalized, parsedDriverNumber, resolvedKind)
        : await resolvedLookup(normalized, parsedDriverNumber);

      if (result?.needs_account_choice) {
        setPhone(local);
        setAccountChoices({ assigned: result.assigned, owner: result.owner });
        setStep('account_choice');
        return result;
      }

      if (result?.needs_driver_number && Array.isArray(result.choices) && result.choices.length > 0) {
        setPhone(local);
        setDriverChoices(result.choices);
        setForcedLoginKind('owner');
        setStep('driver_number');
        return result;
      }

      if (!result?.found) {
        Toast.show({
          type: 'error',
          text1: 'No autorizado',
          text2: notFoundMessage,
        });
        return null;
      }

      applyFoundLookup(result, local, {
        setLookupResult,
        setPhone,
        setDriverNumber,
        setStep,
      });
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
  }, [forcedLoginKind, lookupFn, loginKind, notFoundMessage]);

  const lookupPhone = useCallback(async (rawIdentifier) => {
    const classified = classifyLoginIdentifier(rawIdentifier);
    if (classified.kind === 'email') {
      return runEmailLookup(classified.email);
    }
    return runLookup(rawIdentifier, null);
  }, [runEmailLookup, runLookup]);

  const confirmDriverNumber = useCallback(async () => {
    if (!driverNumber.trim()) {
      Toast.show({ type: 'error', text1: 'Ingresá tu número de móvil' });
      return null;
    }
    return runLookup(phone, driverNumber);
  }, [driverNumber, phone, runLookup]);

  const chooseAccount = useCallback((kind) => {
    const selected = kind === 'assigned'
      ? accountChoices?.assigned
      : accountChoices?.owner;
    if (!selected) return null;

    setForcedLoginKind(kind === 'assigned' ? 'assigned' : 'owner');

    if (selected.needs_driver_number && Array.isArray(selected.choices) && selected.choices.length > 0) {
      setDriverChoices(selected.choices);
      setStep('driver_number');
      return selected;
    }

    if (!selected.found) {
      Toast.show({
        type: 'error',
        text1: 'No autorizado',
        text2: notFoundMessage,
      });
      return null;
    }

    applyFoundLookup(selected, phone, {
      setLookupResult,
      setPhone,
      setDriverNumber,
      setStep,
    });
    return selected;
  }, [accountChoices, notFoundMessage, phone]);

  const completeLogin = useCallback(async (driverProfile) => {
    const session = (await supabase.auth.getSession()).data.session;
    const user = session?.user;
    if (!user || !driverProfile) {
      throw new Error('No se pudo iniciar la sesión');
    }
    loginStore(user, session, driverProfile);
    Toast.show({
      type: 'success',
      text1: '¡Bienvenido!',
      text2: `Hola, ${driverProfile.full_name}`,
    });
  }, [loginStore]);

  const submitPasswordSetup = useCallback(async () => {
    const emailLogin = isEmailLoginResult(lookupResult);
    const authEmail = emailLogin
      ? (lookupResult?.login_email || normalizeLoginEmail(phone))
      : lookupResult?.auth_email;
    if (!authEmail) return { success: false };
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

      const provisionResult = emailLogin
        ? await provisionDriverEmailAuth({
          driverId: lookupResult.driver_id,
          email: authEmail,
          password,
        })
        : await provisionDriverPhoneAuth({
          driverId: lookupResult.driver_id,
          phone,
          password,
        });

      const signInEmail = emailLogin
        ? (provisionResult?.login_email || authEmail)
        : (provisionResult?.auth_email || authEmail);
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: signInEmail,
        password,
      });
      if (signInError) throw signInError;

      const driverProfile = await fetchDriverProfile(
        (await supabase.auth.getUser()).data.user?.id,
      );
      if (!driverProfile) {
        throw new Error('No se encontró el perfil del chofer');
      }

      await completeLogin(driverProfile);
      return { success: true };
    } catch (error) {
      let message = error.message || 'No se pudo configurar la contraseña';
      if (message.includes('already registered') || message.includes('ya tiene contraseña')) {
        message = 'Ya tenés cuenta. Usá tu contraseña registrada.';
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
    phone,
    fetchDriverProfile,
    completeLogin,
    setLoading,
  ]);

  const submitPasswordLogin = useCallback(async () => {
    const emailLogin = isEmailLoginResult(lookupResult);
    const authEmail = emailLogin
      ? (lookupResult?.login_email || lookupResult?.auth_email || normalizeLoginEmail(phone))
      : lookupResult?.auth_email;
    if (!authEmail || !password) return { success: false };

    try {
      setIsSubmitting(true);
      setLoading?.(true);

      const { data, error } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      });
      if (error) throw error;

      const driverProfile = await fetchDriverProfile(data.user.id);
      if (!driverProfile) {
        await supabase.auth.signOut();
        throw new Error('No se encontró el perfil del chofer');
      }

      await completeLogin(driverProfile);
      return { success: true };
    } catch (error) {
      const message = error.message?.includes('Invalid login credentials')
        ? (emailLogin ? 'Correo o contraseña incorrectos' : 'Teléfono o contraseña incorrectos')
        : (error.message || 'No se pudo iniciar sesión');
      Toast.show({ type: 'error', text1: 'Error de autenticación', text2: message });
      return { success: false, error: message };
    } finally {
      setIsSubmitting(false);
      setLoading?.(false);
    }
  }, [lookupResult, password, phone, fetchDriverProfile, completeLogin, setLoading]);

  return {
    step,
    phone,
    driverNumber,
    password,
    confirmPassword,
    lookupResult,
    driverChoices,
    accountChoices,
    isSubmitting,
    setPhone,
    setDriverNumber,
    setPassword,
    setConfirmPassword,
    setStep,
    resetFlow,
    lookupPhone,
    confirmDriverNumber,
    chooseAccount,
    submitPasswordSetup,
    submitPasswordLogin,
  };
}
