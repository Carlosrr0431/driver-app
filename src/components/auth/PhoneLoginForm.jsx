import React from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors } from '../theme/colors';
import { formatPhoneForDisplay } from '../utils/driverRoles';

const BRAND_BLUE = '#282e69';

export function PhoneLoginForm({
  step,
  phone,
  driverNumber,
  password,
  confirmPassword,
  lookupResult,
  driverChoices = [],
  busy = false,
  setPhone,
  setDriverNumber,
  setPassword,
  setConfirmPassword,
  onPrimaryAction,
  primaryLabels = {},
}) {
  const labels = {
    phoneContinue: 'Continuar',
    driverNumberContinue: 'Continuar',
    setupSubmit: 'Crear contraseña e ingresar',
    loginSubmit: 'Ingresar',
    processing: 'Procesando...',
    ...primaryLabels,
  };

  const canSubmit = step === 'phone'
    ? phone.trim().length >= 8
    : step === 'driver_number'
      ? driverNumber.trim().length > 0
      : step === 'setup_password'
        ? password.length >= 8 && confirmPassword.length >= 8
        : password.length > 0;

  const primaryLabel = busy
    ? labels.processing
    : step === 'phone'
      ? labels.phoneContinue
      : step === 'driver_number'
        ? labels.driverNumberContinue
        : step === 'setup_password'
          ? labels.setupSubmit
          : labels.loginSubmit;

  return (
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

      {step === 'driver_number' ? (
        <>
          <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 20 }}>
            Hay varios móviles con este teléfono. Ingresá tu número de móvil (titular).
          </Text>
          <FieldLabel>NÚMERO DE MÓVIL</FieldLabel>
          <InputField
            value={driverNumber}
            onChangeText={setDriverNumber}
            placeholder="Ej: 17"
            keyboardType="number-pad"
            icon="keypad-outline"
          />
          {driverChoices.length > 0 ? (
            <View style={{ gap: 8, marginBottom: 8 }}>
              {driverChoices.map((choice) => (
                <Pressable
                  key={String(choice.driver_number)}
                  onPress={() => setDriverNumber(String(choice.driver_number))}
                  style={({ pressed }) => ({
                    padding: 12,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: String(driverNumber) === String(choice.driver_number) ? BRAND_BLUE : '#E8ECF4',
                    backgroundColor: pressed ? '#F8F9FC' : '#fff',
                  })}
                >
                  <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.text }}>
                    Móvil {choice.driver_number} — {choice.full_name}
                  </Text>
                  {choice.vehicle_plate ? (
                    <Text style={{ fontFamily: 'Inter_400Regular', color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
                      Patente {choice.vehicle_plate}
                    </Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
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
            Teléfono: {formatPhoneForDisplay(phone) || phone}
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

      {lookupResult?.vehicle_plate && step !== 'phone' ? (
        <View style={{
          marginBottom: 12,
          alignSelf: 'flex-start',
          backgroundColor: `${colors.info}12`,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}>
          <Text style={{ color: colors.info, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
            Vehículo {lookupResult.vehicle_plate}
            {lookupResult.driver_number != null ? ` · Móvil ${lookupResult.driver_number}` : ''}
          </Text>
        </View>
      ) : null}

      <Pressable
        onPress={onPrimaryAction}
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
            {primaryLabel}
          </Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
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
