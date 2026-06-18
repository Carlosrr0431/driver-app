import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  StatusBar,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import Animated, { FadeInDown, FadeIn } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { colors } from '../theme/colors';
import { useOwner } from '../hooks/useOwner';

const CreateLinkedDriverScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { createLinkedDriver } = useOwner();

  // Datos de cuenta
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Datos personales
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [driverNumber, setDriverNumber] = useState('');

  // Datos del vehículo
  const [vehicleBrand, setVehicleBrand] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehiclePlate, setVehiclePlate] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');

  const validate = () => {
    if (!fullName.trim()) return 'El nombre es requerido.';
    if (!email.trim()) return 'El correo es requerido.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'El correo no es válido.';
    if (!password) return 'La contraseña es requerida.';
    if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
    if (password !== confirmPassword) return 'Las contraseñas no coinciden.';
    return null;
  };

  const handleCreate = async () => {
    const error = validate();
    if (error) {
      Toast.show({ type: 'error', text1: 'Datos incompletos', text2: error });
      return;
    }

    try {
      const newDriver = await createLinkedDriver.mutateAsync({
        email,
        password,
        fullName,
        phone,
        driverNumber,
        vehicleBrand,
        vehicleModel,
        vehicleYear,
        vehiclePlate,
        vehicleColor,
      });

      Toast.show({
        type: 'success',
        text1: 'Conductor creado',
        text2: `${newDriver.full_name} fue vinculado a tu cuenta.`,
        visibilityTime: 4000,
      });

      navigation.goBack();
    } catch (err) {
      Toast.show({ type: 'error', text1: 'Error al crear conductor', text2: err.message });
    }
  };

  const isPending = createLinkedDriver.isPending;

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: colors.background }}
    >
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <LinearGradient
          colors={[`${colors.primary}18`, colors.background]}
          style={{ paddingTop: insets.top + 12, paddingBottom: 24, paddingHorizontal: 20 }}
        >
          <Animated.View entering={FadeIn.duration(400)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
                Nuevo conductor
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                Creá la cuenta y vinculala a tu flota
              </Text>
            </View>
          </Animated.View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 16 }}>
          {/* Credenciales de acceso */}
          <Animated.View entering={FadeInDown.delay(80).duration(400)}>
            <SectionCard title="Credenciales de acceso" icon="lock-outline">
              <FormField
                label="Correo electrónico"
                value={email}
                onChangeText={setEmail}
                icon="email-outline"
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="conductor@ejemplo.com"
              />
              <FormField
                label="Contraseña"
                value={password}
                onChangeText={setPassword}
                icon="lock-outline"
                secureTextEntry={!showPassword}
                placeholder="Mínimo 8 caracteres"
                rightAction={
                  <TouchableOpacity onPress={() => setShowPassword(v => !v)}>
                    <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                }
              />
              <FormField
                label="Confirmar contraseña"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                icon="lock-check-outline"
                secureTextEntry={!showConfirm}
                placeholder="Repetí la contraseña"
                rightAction={
                  <TouchableOpacity onPress={() => setShowConfirm(v => !v)}>
                    <Ionicons name={showConfirm ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                }
              />
              <View style={{
                backgroundColor: `${colors.info}12`, borderRadius: 10, padding: 12,
                flexDirection: 'row', alignItems: 'flex-start', marginTop: 4,
              }}>
                <Ionicons name="information-circle-outline" size={16} color={colors.info} style={{ marginTop: 1, marginRight: 8 }} />
                <Text style={{ flex: 1, color: colors.info, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
                  El conductor usará este correo y contraseña para iniciar sesión en la app.
                </Text>
              </View>
            </SectionCard>
          </Animated.View>

          {/* Datos personales */}
          <Animated.View entering={FadeInDown.delay(160).duration(400)}>
            <SectionCard title="Datos personales" icon="account-outline">
              <FormField
                label="Nombre completo *"
                value={fullName}
                onChangeText={setFullName}
                icon="account"
                placeholder="Nombre y apellido"
              />
              <FormField
                label="Teléfono"
                value={phone}
                onChangeText={setPhone}
                icon="phone"
                keyboardType="phone-pad"
                placeholder="Opcional"
              />
              <FormField
                label="Número de móvil"
                value={driverNumber}
                onChangeText={setDriverNumber}
                icon="numeric"
                keyboardType="numeric"
                placeholder="Ej: 1, 2, 3..."
              />
            </SectionCard>
          </Animated.View>

          {/* Vehículo */}
          <Animated.View entering={FadeInDown.delay(240).duration(400)}>
            <SectionCard title="Vehículo" icon="car-outline">
              <FormField label="Marca" value={vehicleBrand} onChangeText={setVehicleBrand} icon="car" placeholder="Ej: Toyota" />
              <FormField label="Modelo" value={vehicleModel} onChangeText={setVehicleModel} icon="car-side" placeholder="Ej: Corolla" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <FormField label="Año" value={vehicleYear} onChangeText={setVehicleYear} icon="calendar" keyboardType="numeric" placeholder="Ej: 2020" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormField label="Color" value={vehicleColor} onChangeText={setVehicleColor} icon="palette" placeholder="Ej: Blanco" />
                </View>
              </View>
              <FormField
                label="Patente"
                value={vehiclePlate}
                onChangeText={setVehiclePlate}
                icon="card-text"
                autoCapitalize="characters"
                placeholder="Ej: AB123CD"
              />
            </SectionCard>
          </Animated.View>

          {/* Submit */}
          <Animated.View entering={FadeInDown.delay(320).duration(400)} style={{ marginTop: 4 }}>
            <TouchableOpacity onPress={handleCreate} disabled={isPending} activeOpacity={0.85}>
              <LinearGradient
                colors={colors.gradient.primary}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{
                  height: 52, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center',
                  flexDirection: 'row', opacity: isPending ? 0.7 : 1,
                }}
              >
                {isPending ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <>
                    <MaterialCommunityIcons name="account-plus-outline" size={20} color="#fff" style={{ marginRight: 8 }} />
                    <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' }}>
                      Crear conductor
                    </Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.goBack()} disabled={isPending} activeOpacity={0.7} style={{ marginTop: 12, alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                Cancelar
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

/* Section Card */
const SectionCard = ({ title, icon, children }) => (
  <View style={{
    backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 14,
    borderWidth: 1, borderColor: colors.border,
  }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
      <View style={{
        width: 32, height: 32, borderRadius: 10,
        backgroundColor: `${colors.primary}12`, alignItems: 'center', justifyContent: 'center',
      }}>
        <MaterialCommunityIcons name={icon} size={16} color={colors.primary} />
      </View>
      <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold', marginLeft: 10 }}>
        {title}
      </Text>
    </View>
    {children}
  </View>
);

/* Form field */
const FormField = ({ label, value, onChangeText, icon, rightAction, ...props }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 5, marginLeft: 2 }}>
      {label}
    </Text>
    <View style={{
      backgroundColor: colors.surfaceLight, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    }}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholderTextColor={colors.textDark}
        style={{
          flex: 1, color: colors.text, fontSize: 14,
          fontFamily: 'Inter_400Regular', paddingVertical: 12, marginLeft: 10,
        }}
        {...props}
      />
      {rightAction && <View style={{ marginLeft: 8 }}>{rightAction}</View>}
    </View>
  </View>
);

export default CreateLinkedDriverScreen;
