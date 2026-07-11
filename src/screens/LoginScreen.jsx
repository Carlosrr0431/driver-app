import React from 'react';
import { Text, Pressable } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';
import { BRAND_BLUE } from '../components/auth/LoginBrandHeader';
import { LoginScreenLayout } from '../components/auth/LoginScreenLayout';

const LoginScreen = () => {
  const navigation = useNavigation();
  const { fetchDriverProfile, isLoading } = useAuth();
  const loginStore = useAuthStore((s) => s.login);
  const setLoading = useAuthStore((s) => s.setLoading);

  const auth = usePhoneDriverAuth({
    fetchDriverProfile,
    loginStore,
    setLoading,
    loginKind: 'owner',
    notFoundMessage: 'Este teléfono no está registrado como titular o chofer',
  });

  const busy = auth.isSubmitting || isLoading;

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
    await auth.submitPasswordLogin();
  };

  return (
    <LoginScreenLayout>
      <Animated.View entering={FadeInDown.delay(220).duration(400)}>
        <PhoneLoginForm
          {...auth}
          busy={busy}
          loginMode="owner"
          onPrimaryAction={handlePrimaryAction}
        />

        <Pressable
          onPress={() => navigation.navigate('AssignedDriverLogin')}
          disabled={busy}
          style={({ pressed }) => ({
            marginTop: 16,
            height: 48,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: `${BRAND_BLUE}30`,
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'row',
            gap: 8,
            opacity: busy ? 0.5 : pressed ? 0.85 : 1,
          })}
        >
          <Ionicons name="car-sport-outline" size={18} color={BRAND_BLUE} />
          <Text style={{ color: BRAND_BLUE, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
            Ingresar como chofer asignado
          </Text>
        </Pressable>
      </Animated.View>
    </LoginScreenLayout>
  );
};

export default LoginScreen;
