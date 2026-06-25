import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
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
import { MAX_ASSIGNED_DRIVERS } from '../utils/driverRoles';

const CreateLinkedDriverScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { createAssignedDriver, useLinkedDrivers } = useOwner();
  const { data: linkedDrivers = [] } = useLinkedDrivers();

  const assignedCount = linkedDrivers.filter((d) => d.is_assigned_driver).length;
  const slotsLeft = Math.max(0, MAX_ASSIGNED_DRIVERS - assignedCount);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  const validate = () => {
    if (!fullName.trim()) return 'El nombre es requerido.';
    if (!phone.trim()) return 'El teléfono es requerido.';
    const digits = phone.replace(/\D/g, '');
    if (digits.length < 8) return 'Ingresá un teléfono válido con código de área.';
    if (slotsLeft <= 0) return `Ya tenés ${MAX_ASSIGNED_DRIVERS} choferes asignados.`;
    return null;
  };

  const handleCreate = async () => {
    const error = validate();
    if (error) {
      Toast.show({ type: 'error', text1: 'Datos incompletos', text2: error });
      return;
    }

    try {
      const newDriver = await createAssignedDriver.mutateAsync({ fullName, phone });

      Toast.show({
        type: 'success',
        text1: 'Chofer asignado',
        text2: `${newDriver.full_name} puede ingresar con su teléfono.`,
        visibilityTime: 4000,
      });

      navigation.goBack();
    } catch (err) {
      Toast.show({ type: 'error', text1: 'Error al agregar chofer', text2: err.message });
    }
  };

  const isPending = createAssignedDriver.isPending;

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
        <LinearGradient
          colors={[`${colors.primary}18`, colors.background]}
          style={{ paddingTop: insets.top + 12, paddingBottom: 24, paddingHorizontal: 20 }}
        >
          <Animated.View entering={FadeIn.duration(400)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Pressable onPress={() => navigation.goBack()} style={{ marginRight: 12 }}>
              <Ionicons name="arrow-back" size={22} color={colors.text} />
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
                Nuevo chofer asignado
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                {assignedCount}/{MAX_ASSIGNED_DRIVERS} cupos usados
              </Text>
            </View>
          </Animated.View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 16 }}>
          <Animated.View entering={FadeInDown.delay(80).duration(400)}>
            <SectionCard title="Datos del chofer" icon="account-outline">
              <FormField
                label="Nombre completo *"
                value={fullName}
                onChangeText={setFullName}
                icon="account"
                placeholder="Nombre y apellido"
              />
              <FormField
                label="Teléfono *"
                value={phone}
                onChangeText={setPhone}
                icon="phone"
                keyboardType="phone-pad"
                placeholder="Ej: 387 8630173"
              />
              <View style={{
                backgroundColor: `${colors.info}12`, borderRadius: 10, padding: 12,
                flexDirection: 'row', alignItems: 'flex-start', marginTop: 4,
              }}>
                <Ionicons name="information-circle-outline" size={16} color={colors.info} style={{ marginTop: 1, marginRight: 8 }} />
                <Text style={{ flex: 1, color: colors.info, fontSize: 12, fontFamily: 'Inter_400Regular', lineHeight: 18 }}>
                  El chofer ingresará desde "Ingresar como chofer asignado" con este teléfono.
                  En su primera vez creará una contraseña. Usará tu mismo vehículo, pero no podrá gestionar la flota.
                </Text>
              </View>
            </SectionCard>
          </Animated.View>

          <Animated.View entering={FadeInDown.delay(160).duration(400)} style={{ marginTop: 4 }}>
            <Pressable onPress={handleCreate} disabled={isPending || slotsLeft <= 0} style={{ opacity: slotsLeft <= 0 ? 0.6 : 1 }}>
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
                      Agregar chofer
                    </Text>
                  </>
                )}
              </LinearGradient>
            </Pressable>

            <Pressable onPress={() => navigation.goBack()} disabled={isPending} style={{ marginTop: 12, alignItems: 'center', paddingVertical: 12 }}>
              <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                Cancelar
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

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

const FormField = ({ label, value, onChangeText, icon, ...props }) => (
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
    </View>
  </View>
);

export default CreateLinkedDriverScreen;
