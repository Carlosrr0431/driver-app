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
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { usePhoneDriverAuth } from '../hooks/usePhoneDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { lookupAssignedDriverLogin } from '../services/assignedDriverService';
import { PhoneLoginForm } from '../components/auth/PhoneLoginForm';
import { BRAND_BLUE, LoginBrandHeader } from '../components/auth/LoginBrandHeader';

const { height } = Dimensions.get('window');
const BRAND_BLUE_LIGHT = '#245f8d';

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
            paddingTop: insets.top + 8,
            paddingBottom: insets.bottom + 20,
          }}
        >
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              alignSelf: 'flex-start',
              marginBottom: 12,
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Ionicons name="arrow-back" size={22} color={colors.text} />
            <Text style={{ marginLeft: 8, color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>
              Volver al login principal
            </Text>
          </Pressable>

          <LoginBrandHeader style={{ marginBottom: 24 }} />

          <Animated.View entering={FadeInDown.delay(220).duration(400)}>
            <PhoneLoginForm
              {...auth}
              busy={busy}
              loginMode="assigned"
              onPrimaryAction={handlePrimaryAction}
            />
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
