import React from 'react';
import { Text, Pressable } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { lookupAssignedDriverLogin } from '../services/assignedDriverService';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';
import { LoginScreenLayout } from '../components/auth/LoginScreenLayout';

export default function AssignedDriverLoginScreen() {
  const navigation = useNavigation();
  const { fetchDriverProfile, isLoading } = useAuth();
  const loginStore = useAuthStore((s) => s.login);
  const setLoading = useAuthStore((s) => s.setLoading);

  const auth = usePhoneDriverAuth({
    fetchDriverProfile,
    loginStore,
    setLoading,
    lookupFn: lookupAssignedDriverLogin,
    notFoundMessage: 'Este teléfono no está registrado como chofer asignado',
  });

  const busy = auth.isSubmitting || isLoading;

  const handlePrimaryAction = async () => {
    if (auth.step === 'phone') {
      await auth.lookupPhone(auth.phone);
      return;
    }
    if (auth.step === 'setup_password') {
      await auth.submitPasswordSetup();
      return;
    }
    await auth.submitPasswordLogin();
  };

  return (
    <LoginScreenLayout
      brandHeaderStyle={{ marginBottom: 8 }}
      topSlot={(
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            alignSelf: 'flex-start',
            marginBottom: 8,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Ionicons name="arrow-back" size={22} color={colors.text} />
          <Text style={{ marginLeft: 8, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
            Volver al login principal
          </Text>
        </Pressable>
      )}
    >
      <Animated.View entering={FadeInDown.delay(220).duration(400)}>
        <PhoneLoginForm
          {...auth}
          busy={busy}
          loginMode="assigned"
          onPrimaryAction={handlePrimaryAction}
        />
      </Animated.View>
    </LoginScreenLayout>
  );
}
