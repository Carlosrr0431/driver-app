import React from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { lookupAssignedDriverLogin } from '../services/assignedDriverService';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';

const BRAND_BLUE = '#282e69';

export default function AssignedDriverLoginScreen() {
  const insets = useSafeAreaInsets();
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

  const title = auth.step === 'phone'
    ? 'Chofer asignado'
    : auth.step === 'setup_password'
      ? 'Creá tu contraseña'
      : 'Ingresá tu contraseña';

  const subtitle = auth.step === 'phone'
    ? 'Ingresá el teléfono que te dio el propietario del vehículo'
    : auth.step === 'setup_password'
      ? `Primera vez con ${auth.lookupResult?.owner_name || 'este vehículo'}`
      : `Bienvenido, ${auth.lookupResult?.full_name || 'chofer'}`;

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 24 }}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
            <Text style={{ marginLeft: 8, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
              Volver al login principal
            </Text>
          </Pressable>

          <Animated.View entering={FadeInDown.duration(400)}>
            <View style={{
              width: 56, height: 56, borderRadius: 16,
              backgroundColor: `${BRAND_BLUE}12`,
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Ionicons name="car-sport-outline" size={28} color={BRAND_BLUE} />
            </View>

            <Text style={{ color: BRAND_BLUE, fontSize: 24, fontFamily: 'Inter_700Bold' }}>
              {title}
            </Text>
            <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 8, lineHeight: 20 }}>
              {subtitle}
            </Text>
          </Animated.View>

          <PhoneLoginForm
            {...auth}
            busy={busy}
            onPrimaryAction={handlePrimaryAction}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
