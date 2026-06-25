import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { useAssignedDriverAuth } from '../hooks/useAssignedDriverAuth';
import { useAuthStore } from '../stores/authStore';
import { formatPhoneForDisplay } from '../utils/driverRoles';

const BRAND_BLUE = '#282e69';

export default function AssignedDriverLoginScreen() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { fetchDriverProfile, isLoading } = useAuth();
  const loginStore = useAuthStore((s) => s.login);
  const setLoading = useAuthStore((s) => s.setLoading);

  const {
    step,
    phone,
    password,
    confirmPassword,
    lookupResult,
    isSubmitting,
    setPhone,
    setPassword,
    setConfirmPassword,
    lookupPhone,
    submitPasswordSetup,
    submitPasswordLogin,
  } = useAssignedDriverAuth({
    fetchDriverProfile,
    loginStore,
    setLoading,
  });

  const busy = isSubmitting || isLoading;

  const handlePrimaryAction = async () => {
    if (step === 'phone') {
      await lookupPhone(phone);
      return;
    }
    if (step === 'setup_password') {
      await submitPasswordSetup();
      return;
    }
    await submitPasswordLogin();
  };

  const canSubmit = step === 'phone'
    ? phone.trim().length >= 8
    : step === 'setup_password'
      ? password.length >= 8 && confirmPassword.length >= 8
      : password.length > 0;

  const title = step === 'phone'
    ? 'Chofer asignado'
    : step === 'setup_password'
      ? 'Creá tu contraseña'
      : 'Ingresá tu contraseña';

  const subtitle = step === 'phone'
    ? 'Ingresá el teléfono que te dio el propietario del vehículo'
    : step === 'setup_password'
      ? `Primera vez con ${lookupResult?.owner_name || 'este vehículo'}`
      : `Bienvenido, ${lookupResult?.full_name || 'chofer'}`;

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

            {lookupResult?.vehicle_plate ? (
              <View style={{
                marginTop: 14, alignSelf: 'flex-start',
                backgroundColor: `${colors.info}12`, borderRadius: 10,
                paddingHorizontal: 12, paddingVertical: 8,
              }}>
                <Text style={{ color: colors.info, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
                  Vehículo {lookupResult.vehicle_plate}
                </Text>
              </View>
            ) : null}
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(120).duration(400)} style={{
            marginTop: 28,
            backgroundColor: '#FFFFFF',
            borderRadius: 20,
            padding: 22,
            borderWidth: 1,
            borderColor: '#F0F2F8',
          }}>
            {step === 'phone' ? (
              <>
                <FieldLabel>TELÉFONO</FieldLabel>
                <InputField
                  value={phone}
                  onChangeText={setPhone}
                  placeholder="Ej: 387 8630173"
                  keyboardType="phone-pad"
                  icon="call-outline"
                />
              </>
            ) : null}

            {step === 'setup_password' ? (
              <>
                <FieldLabel>NUEVA CONTRASEÑA</FieldLabel>
                <InputField
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Mínimo 8 caracteres"
                  secureTextEntry
                  icon="lock-closed-outline"
                />
                <FieldLabel>CONFIRMAR CONTRASEÑA</FieldLabel>
                <InputField
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Repetí la contraseña"
                  secureTextEntry
                  icon="lock-closed-outline"
                />
                <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
                  Teléfono registrado: {formatPhoneForDisplay(phone) || phone}
                </Text>
              </>
            ) : null}

            {step === 'password' ? (
              <>
                <FieldLabel>CONTRASEÑA</FieldLabel>
                <InputField
                  value={password}
                  onChangeText={setPassword}
                  placeholder="Tu contraseña"
                  secureTextEntry
                  icon="lock-closed-outline"
                />
                <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
                  Teléfono: {formatPhoneForDisplay(phone) || phone}
                </Text>
              </>
            ) : null}

            <Pressable
              onPress={handlePrimaryAction}
              disabled={!canSubmit || busy}
              style={({ pressed }) => ({
                marginTop: 22,
                borderRadius: 14,
                overflow: 'hidden',
                opacity: !canSubmit || busy ? 0.5 : pressed ? 0.9 : 1,
              })}
            >
              <LinearGradient
                colors={['#3d4494', BRAND_BLUE]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={{
                  height: 52,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  gap: 8,
                }}
              >
                <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' }}>
                  {busy
                    ? 'Procesando...'
                    : step === 'phone'
                      ? 'Continuar'
                      : step === 'setup_password'
                        ? 'Crear contraseña e ingresar'
                        : 'Ingresar'}
                </Text>
              </LinearGradient>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function FieldLabel({ children }) {
  return (
    <Text style={{
      color: colors.textMuted,
      fontSize: 12,
      fontFamily: 'Inter_500Medium',
      marginBottom: 8,
      letterSpacing: 0.3,
    }}>
      {children}
    </Text>
  );
}

function InputField({ icon, ...props }) {
  return (
    <View style={{
      backgroundColor: '#F8F9FC',
      borderRadius: 12,
      borderWidth: 1.5,
      borderColor: '#E8ECF4',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 14,
      marginBottom: 16,
    }}>
      <Ionicons name={icon} size={18} color={colors.textMuted} />
      <TextInput
        placeholderTextColor="#A0A8BE"
        style={{
          flex: 1,
          color: colors.text,
          fontSize: 15,
          fontFamily: 'Inter_400Regular',
          paddingVertical: 14,
          marginLeft: 12,
        }}
        {...props}
      />
    </View>
  );
}
