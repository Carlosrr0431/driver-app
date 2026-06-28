import React from 'react';
import {
  View,
  Text,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';
import { BRAND_BLUE, LoginBrandHeader } from '../components/auth/LoginBrandHeader';

const { height } = Dimensions.get('window');
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

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={[`${BRAND_BLUE}18`, `${BRAND_BLUE_LIGHT}0C`, 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: height * 0.42 }}
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{
            flexGrow: 1,
            paddingHorizontal: 24,
            paddingTop: insets.top + 16,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <LoginBrandHeader />

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
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default LoginScreen;
