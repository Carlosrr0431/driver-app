import React from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Dimensions,
  StatusBar,
} from 'react-native';
import { Image } from 'expo-image';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeIn, SlideInUp, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';

const { width } = Dimensions.get('window');
const BRAND_BLUE = '#282e69';
const BRAND_BLUE_LIGHT = '#245f8d';

const LoginScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { fetchDriverProfile, isLoading } = useAuth();
  const loginStore = useAuthStore((s) => s.login);
  const setLoading = useAuthStore((s) => s.setLoading);

  const auth = usePhoneDriverAuth({
    fetchDriverProfile,
    loginStore,
    setLoading,
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

  const title = auth.step === 'phone'
    ? 'Bienvenido'
    : auth.step === 'driver_number'
      ? 'Tu número de móvil'
      : auth.step === 'setup_password'
        ? 'Creá tu contraseña'
        : 'Ingresá tu contraseña';

  const subtitle = auth.step === 'phone'
    ? 'Ingresá con el celular del titular del vehículo'
    : auth.step === 'driver_number'
      ? 'Seleccioná o escribí el móvil que te asignó la base'
      : auth.step === 'setup_password'
        ? `Primera vez — ${auth.lookupResult?.full_name || 'titular'}`
        : `Hola, ${auth.lookupResult?.full_name || 'conductor'}`;

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={[`${BRAND_BLUE}18`, `${BRAND_BLUE_LIGHT}0C`, 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 400 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1 }}
      >
        <ScrollView
          contentContainerStyle={{
            flexGrow: 1,
            justifyContent: 'center',
            paddingHorizontal: 24,
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 20,
          }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Animated.View entering={FadeIn.delay(200).duration(800)} style={{ alignItems: 'center', marginBottom: 24 }}>
            <Animated.View entering={SlideInUp.delay(300).springify()}>
              <Image
                source={require('../../assets/logo.png')}
                style={{ width: width * 0.52, height: undefined, aspectRatio: 550 / 295 }}
                resizeMode="contain"
              />
            </Animated.View>
            <Animated.View entering={FadeInDown.delay(500).springify()} style={{ alignItems: 'center', marginTop: 16 }}>
              <Text style={{ color: BRAND_BLUE, fontSize: 22, fontFamily: 'Inter_700Bold' }}>
                {title}
              </Text>
              <Text style={{
                color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular', marginTop: 8, textAlign: 'center',
              }}>
                {subtitle}
              </Text>
            </Animated.View>
          </Animated.View>

          <PhoneLoginForm
            {...auth}
            busy={busy}
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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default LoginScreen;
