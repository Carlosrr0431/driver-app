import React, { useCallback, useRef } from 'react';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';
import { LoginScreenLayout } from '../components/auth/LoginScreenLayout';

const LoginScreen = () => {
  const { fetchDriverProfile, isLoading } = useAuth();
  const loginStore = useAuthStore((s) => s.login);
  const setLoading = useAuthStore((s) => s.setLoading);
  const scrollRef = useRef(null);

  const auth = usePhoneDriverAuth({
    fetchDriverProfile,
    loginStore,
    setLoading,
    notFoundMessage: 'Este teléfono no está registrado en Profesional',
  });

  const busy = auth.isSubmitting || isLoading;

  const handleIdentifierFocus = useCallback(() => {
    const scroll = () => {
      scrollRef.current?.scrollToEnd?.({ animated: true });
    };
    requestAnimationFrame(scroll);
    setTimeout(scroll, 280);
  }, []);

  const handlePrimaryAction = async () => {
    if (auth.step === 'phone') {
      await auth.lookupPhone(auth.phone);
      return;
    }
    if (auth.step === 'driver_number') {
      await auth.confirmDriverNumber();
      return;
    }
    if (auth.step === 'setup_password') {
      await auth.submitPasswordSetup();
      return;
    }
    if (auth.step === 'password') {
      await auth.submitPasswordLogin();
    }
  };

  return (
    <LoginScreenLayout scrollRef={scrollRef}>
      <Animated.View entering={FadeInDown.delay(220).duration(400)}>
        <PhoneLoginForm
          {...auth}
          busy={busy}
          onPrimaryAction={handlePrimaryAction}
          onChooseAccount={auth.chooseAccount}
          onChangeNumber={auth.resetFlow}
          onIdentifierFocus={handleIdentifierFocus}
        />
      </Animated.View>
    </LoginScreenLayout>
  );
};

export default LoginScreen;
