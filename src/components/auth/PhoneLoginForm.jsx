import React, { useCallback, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  Pressable,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { colors } from '../../theme/colors';
import {
  classifyLoginIdentifier,
  formatLocalArMobileDisplay,
  formatLoginPhoneHint,
  getLoginIdentifierGuidance,
  isCompleteLoginIdentifier,
  sanitizeLoginPhoneInput,
} from '../../utils/driverRoles';
import { useResponsive } from '../../hooks/useResponsive';

const BRAND_BLUE = '#282e69';

const KIND_COPY = {
  owner: { label: 'Propietario', icon: 'person-outline' },
  assigned: { label: 'Chofer asignado', icon: 'car-sport-outline' },
};

export function PhoneLoginForm({
  step,
  phone,
  driverNumber,
  password,
  confirmPassword,
  lookupResult,
  driverChoices = [],
  accountChoices = null,
  busy = false,
  setPhone,
  setDriverNumber,
  setPassword,
  setConfirmPassword,
  onPrimaryAction,
  onChooseAccount,
  onChangeNumber,
  primaryLabels = {},
  onIdentifierFocus,
}) {
  const { s, fs, isCompactHeight } = useResponsive();
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [confirmPasswordVisible, setConfirmPasswordVisible] = useState(false);
  const [phoneAttempted, setPhoneAttempted] = useState(false);
  const [blockedCountryPaste, setBlockedCountryPaste] = useState(false);

  const labels = {
    phoneContinue: 'Continuar',
    driverNumberContinue: 'Continuar',
    setupSubmit: 'Crear contraseña e ingresar',
    loginSubmit: 'Ingresar',
    processing: 'Procesando...',
    ...primaryLabels,
  };

  const detectedKind = lookupResult?.login_kind === 'assigned'
    ? 'assigned'
    : lookupResult?.login_kind === 'owner'
      ? 'owner'
      : null;

  const phoneReady = isCompleteLoginIdentifier(phone);
  const identifierKind = classifyLoginIdentifier(phone).kind;
  const canSubmit = step === 'phone'
    ? !busy
    : step === 'driver_number'
      ? driverNumber.trim().length > 0
      : step === 'account_choice'
        ? false
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

  const showKindBadge = Boolean(detectedKind) && (step === 'setup_password' || step === 'password');
  const showPrimary = step !== 'account_choice';
  const phoneHint = identifierKind === 'email'
    ? String(phone || '').trim()
    : (formatLoginPhoneHint(phone) || phone);
  const guidance = getLoginIdentifierGuidance(phone, {
    submitted: phoneAttempted,
    blockedCountryPaste,
  });

  const handlePhoneChange = useCallback((text) => {
    if (classifyLoginIdentifier(text).kind === 'email') {
      setBlockedCountryPaste(false);
      setPhone(String(text || '').replace(/\s+/g, ''));
      return;
    }
    const next = sanitizeLoginPhoneInput(text);
    if (next == null) {
      setBlockedCountryPaste(true);
      setPhoneAttempted(true);
      return;
    }
    setBlockedCountryPaste(false);
    setPhone(next);
  }, [setPhone]);

  const handlePrimaryAction = useCallback(() => {
    if (step === 'phone' && !isCompleteLoginIdentifier(phone)) {
      setPhoneAttempted(true);
      return;
    }
    onPrimaryAction?.();
  }, [onPrimaryAction, phone, step]);

  return (
    <Animated.View
      entering={FadeInDown.delay(120).duration(400)}
      style={{
        backgroundColor: '#FFFFFF',
        borderRadius: s(24),
        borderCurve: 'continuous',
        padding: s(isCompactHeight ? 16 : 22),
        borderWidth: 1,
        borderColor: '#EEF1F8',
        boxShadow: '0 16px 40px rgba(40, 46, 105, 0.10)',
        gap: s(4),
      }}
    >
      {step === 'phone' ? (
        <>
          <Text style={{
            color: colors.text,
            fontSize: fs(isCompactHeight ? 18 : 22),
            fontFamily: 'Inter_700Bold',
            letterSpacing: -0.4,
            textAlign: 'center',
          }}
          >
            Ingresá
          </Text>
          <Text style={{
            color: colors.textMuted,
            fontSize: fs(13),
            fontFamily: 'Inter_400Regular',
            textAlign: 'center',
            marginTop: s(2),
          }}
          >
            Teléfono o correo
          </Text>
          <IdentifierField
            value={phone}
            onChangeText={handlePhoneChange}
            onSubmitEditing={handlePrimaryAction}
            onFocus={onIdentifierFocus}
            editable={!busy}
            guidance={guidance}
          />
        </>
      ) : null}

      {step === 'account_choice' ? (
        <>
          <Text style={{
            color: colors.text,
            fontSize: fs(18),
            fontFamily: 'Inter_700Bold',
            marginBottom: s(6),
          }}
          >
            Elegí tu cuenta
          </Text>
          <Text style={{
            color: colors.textMuted,
            fontSize: fs(13),
            fontFamily: 'Inter_400Regular',
            lineHeight: fs(19),
            marginBottom: s(14),
          }}
          >
            Este teléfono está en un propietario y en un chofer asignado.
          </Text>
          <AccountChoiceCard
            kind="owner"
            result={accountChoices?.owner}
            onPress={() => onChooseAccount?.('owner')}
            disabled={busy}
          />
          <AccountChoiceCard
            kind="assigned"
            result={accountChoices?.assigned}
            onPress={() => onChooseAccount?.('assigned')}
            disabled={busy}
          />
        </>
      ) : null}

      {step === 'driver_number' ? (
        <>
          <Text style={{ color: colors.textMuted, fontSize: fs(13), fontFamily: 'Inter_400Regular', marginBottom: 14, lineHeight: 20 }}>
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
                    borderRadius: 14,
                    borderCurve: 'continuous',
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

      {showKindBadge ? (
        <View style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: s(6),
          marginBottom: s(12),
          alignSelf: 'flex-start',
          backgroundColor: `${BRAND_BLUE}0C`,
          paddingHorizontal: s(10),
          paddingVertical: s(6),
          borderRadius: s(999),
        }}
        >
          <Ionicons
            name={KIND_COPY[detectedKind].icon}
            size={s(14)}
            color={BRAND_BLUE}
          />
          <Text style={{ fontSize: fs(12), fontFamily: 'Inter_600SemiBold', color: BRAND_BLUE }}>
            {KIND_COPY[detectedKind].label}
          </Text>
        </View>
      ) : null}

      {step === 'setup_password' ? (
        <>
          <FieldLabel>NUEVA CONTRASEÑA</FieldLabel>
          <InputField
            value={password}
            onChangeText={setPassword}
            placeholder="Mínimo 8 caracteres"
            secureTextEntry={!passwordVisible}
            icon="lock-closed-outline"
            onToggleSecure={() => setPasswordVisible((v) => !v)}
            secureVisible={passwordVisible}
          />
          <FieldLabel>CONFIRMAR CONTRASEÑA</FieldLabel>
          <InputField
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            placeholder="Repetí la contraseña"
            secureTextEntry={!confirmPasswordVisible}
            icon="lock-closed-outline"
            onToggleSecure={() => setConfirmPasswordVisible((v) => !v)}
            secureVisible={confirmPasswordVisible}
          />
          <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
            {identifierKind === 'email' ? `Correo: ${phoneHint}` : `Teléfono: ${phoneHint}`}
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
            secureTextEntry={!passwordVisible}
            icon="lock-closed-outline"
            onToggleSecure={() => setPasswordVisible((v) => !v)}
            secureVisible={passwordVisible}
          />
          <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
            {identifierKind === 'email' ? `Correo: ${phoneHint}` : `Teléfono: ${phoneHint}`}
          </Text>
        </>
      ) : null}

      {lookupResult?.vehicle_plate && step !== 'phone' && step !== 'account_choice' ? (
        <View style={{
          marginTop: s(8),
          marginBottom: s(4),
          alignSelf: 'flex-start',
          backgroundColor: `${colors.info}12`,
          borderRadius: 10,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
        >
          <Text style={{ color: colors.info, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>
            Vehículo {lookupResult.vehicle_plate}
            {lookupResult.driver_number != null ? ` · Móvil ${lookupResult.driver_number}` : ''}
          </Text>
        </View>
      ) : null}

      {showPrimary ? (
        <Pressable
          onPress={handlePrimaryAction}
          disabled={!canSubmit || busy}
          style={({ pressed }) => ({
            marginTop: s(14),
            borderRadius: s(16),
            borderCurve: 'continuous',
            overflow: 'hidden',
            opacity: !canSubmit || busy ? 0.5 : pressed ? 0.9 : 1,
          })}
        >
          <LinearGradient
            colors={['#3d4494', BRAND_BLUE]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={{
              height: s(54, { min: 48 }),
              alignItems: 'center',
              justifyContent: 'center',
              flexDirection: 'row',
              gap: s(8),
            }}
          >
            <Text style={{ color: '#fff', fontSize: fs(16), fontFamily: 'Inter_700Bold' }}>
              {primaryLabel}
            </Text>
            {busy || (step === 'phone' && !phoneReady) ? null : (
              <Ionicons name="arrow-forward" size={s(18)} color="#FFFFFF" />
            )}
          </LinearGradient>
        </Pressable>
      ) : null}

      {step !== 'phone' && onChangeNumber ? (
        <Pressable
          onPress={onChangeNumber}
          disabled={busy}
          style={({ pressed }) => ({
            alignSelf: 'center',
            paddingVertical: s(10),
            opacity: busy ? 0.5 : pressed ? 0.7 : 1,
          })}
        >
          <Text style={{ color: colors.textMuted, fontSize: fs(13), fontFamily: 'Inter_500Medium' }}>
            Cambiar teléfono o correo
          </Text>
        </Pressable>
      ) : null}
    </Animated.View>
  );
}

function IdentifierField({
  value,
  onChangeText,
  onSubmitEditing,
  onFocus,
  editable = true,
  guidance,
}) {
  const { s, fs } = useResponsive();
  const classified = classifyLoginIdentifier(value);
  const isEmail = classified.kind === 'email';
  const digits = String(value || '').replace(/\D/g, '');
  const complete = guidance?.status === 'ok';
  const hasError = guidance?.status === 'error';
  const displayValue = isEmail
    ? String(value || '')
    : formatLocalArMobileDisplay(digits);
  const borderColor = hasError
    ? colors.danger
    : complete
      ? colors.success
      : `${BRAND_BLUE}22`;

  return (
    <View style={{ gap: s(8), marginTop: s(10) }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          backgroundColor: '#F7F8FC',
          borderRadius: s(18),
          borderCurve: 'continuous',
          borderWidth: 1.5,
          borderColor,
          paddingHorizontal: s(10),
          minHeight: s(56, { min: 50 }),
          gap: s(10),
          opacity: editable ? 1 : 0.7,
        }}
      >
        {isEmail ? (
          <View style={{
            width: s(36),
            height: s(36),
            borderRadius: s(12),
            borderCurve: 'continuous',
            backgroundColor: complete ? colors.successBg : `${BRAND_BLUE}12`,
            alignItems: 'center',
            justifyContent: 'center',
          }}
          >
            <Ionicons
              name="mail-outline"
              size={s(18)}
              color={complete ? colors.successDark : BRAND_BLUE}
            />
          </View>
        ) : (
          <View style={{
            backgroundColor: BRAND_BLUE,
            borderRadius: s(12),
            borderCurve: 'continuous',
            paddingHorizontal: s(10),
            height: s(36, { min: 32 }),
            alignItems: 'center',
            justifyContent: 'center',
          }}
          >
            <Text
              style={{ fontSize: fs(15), fontFamily: 'Inter_700Bold', color: '#FFFFFF' }}
              accessibilityLabel="Prefijo de Argentina +54"
            >
              +54
            </Text>
          </View>
        )}
        <TextInput
          value={displayValue}
          onChangeText={onChangeText}
          onFocus={onFocus}
          placeholder={isEmail ? 'correo@ejemplo.com' : '3875 345465 o correo'}
          placeholderTextColor={colors.textLight}
          keyboardType={isEmail ? 'email-address' : (classified.kind === 'phone' ? 'phone-pad' : 'default')}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isEmail ? 'email' : 'username'}
          textContentType={isEmail ? 'emailAddress' : 'username'}
          editable={editable}
          style={{
            flex: 1,
            fontSize: fs(isEmail ? 16 : 18),
            fontFamily: 'Inter_600SemiBold',
            color: complete ? colors.successDark : colors.text,
            letterSpacing: isEmail ? 0 : 0.4,
            paddingVertical: s(12),
          }}
          returnKeyType="done"
          onSubmitEditing={onSubmitEditing}
          showSoftInputOnFocus
          maxLength={isEmail ? 80 : 12}
          accessibilityLabel="Teléfono o correo"
        />
        {String(value || '').length > 0 ? (
          <Pressable
            onPress={() => onChangeText('')}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Borrar"
          >
            <Ionicons
              name={complete ? 'checkmark-circle' : 'close-circle'}
              size={s(20)}
              color={hasError ? colors.danger : complete ? colors.success : colors.textLight}
            />
          </Pressable>
        ) : (
          <Ionicons name="person-outline" size={s(20)} color={colors.textMuted} />
        )}
      </View>
      {guidance?.message ? (
        <Text
          accessibilityLiveRegion="polite"
          style={{
            color: hasError ? colors.danger : complete ? colors.successDark : colors.textMuted,
            fontSize: fs(12),
            fontFamily: 'Inter_500Medium',
            textAlign: 'center',
            paddingHorizontal: s(4),
          }}
        >
          {guidance.message}
        </Text>
      ) : null}
    </View>
  );
}

function AccountChoiceCard({ kind, result, onPress, disabled }) {
  const { s, fs } = useResponsive();
  const copy = KIND_COPY[kind];
  const name = result?.full_name || (kind === 'owner' ? 'Propietario' : 'Chofer asignado');
  const plate = result?.vehicle_plate;
  const needsNumber = Boolean(result?.needs_driver_number);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderWidth: 1.5,
        borderColor: '#E8ECF4',
        borderRadius: s(16),
        borderCurve: 'continuous',
        padding: s(14),
        marginBottom: s(10),
        backgroundColor: pressed ? '#F8F9FC' : '#FFFFFF',
        opacity: disabled ? 0.6 : 1,
        gap: s(4),
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: s(8) }}>
        <Ionicons name={copy.icon} size={s(18)} color={BRAND_BLUE} />
        <Text style={{ fontFamily: 'Inter_700Bold', color: BRAND_BLUE, fontSize: fs(14) }}>
          {copy.label}
        </Text>
      </View>
      <Text style={{ fontFamily: 'Inter_600SemiBold', color: colors.text, fontSize: fs(15) }}>
        {name}
      </Text>
      {needsNumber ? (
        <Text style={{ fontFamily: 'Inter_400Regular', color: colors.textMuted, fontSize: fs(12) }}>
          Hay varios móviles. Vas a elegir el número.
        </Text>
      ) : plate ? (
        <Text style={{ fontFamily: 'Inter_400Regular', color: colors.textMuted, fontSize: fs(12) }}>
          Patente {plate}
        </Text>
      ) : null}
    </Pressable>
  );
}

function FieldLabel({ children }) {
  const { fs, s } = useResponsive();
  return (
    <Text style={{
      color: colors.textMuted,
      fontSize: fs(12),
      fontFamily: 'Inter_500Medium',
      marginBottom: s(8),
      letterSpacing: 0.3,
    }}
    >
      {children}
    </Text>
  );
}

function InputField({
  icon,
  secureTextEntry,
  onToggleSecure,
  secureVisible,
  marginBottom,
  ...props
}) {
  const { s, fs } = useResponsive();
  return (
    <View style={{
      backgroundColor: '#F8F9FC',
      borderRadius: s(14),
      borderCurve: 'continuous',
      borderWidth: 1.5,
      borderColor: '#E8ECF4',
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: s(14),
      marginBottom: marginBottom ?? s(16),
      minHeight: s(48, { min: 44 }),
    }}
    >
      <Ionicons name={icon} size={s(18)} color={colors.textMuted} />
      <TextInput
        placeholderTextColor="#A0A8BE"
        secureTextEntry={secureTextEntry}
        style={{
          flex: 1,
          color: colors.text,
          fontSize: fs(15),
          fontFamily: 'Inter_400Regular',
          paddingVertical: s(14),
          marginLeft: s(12),
        }}
        {...props}
      />
      {onToggleSecure ? (
        <Pressable
          onPress={onToggleSecure}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={secureVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        >
          <Ionicons
            name={secureVisible ? 'eye-off-outline' : 'eye-outline'}
            size={s(20)}
            color={colors.textMuted}
          />
        </Pressable>
      ) : null}
    </View>
  );
}
