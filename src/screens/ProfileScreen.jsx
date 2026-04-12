import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TextInput,
  TouchableOpacity,
  Alert,
  Image,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { colors } from '../theme/colors';
import { useAuth } from '../hooks/useAuth';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../services/supabase';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { formatDate } from '../utils/formatters';
import { differenceInDays, parseISO } from 'date-fns';
import Toast from 'react-native-toast-message';

const ProfileScreen = () => {
  const insets = useSafeAreaInsets();
  const { driver } = useAuthStore();
  const { logout, updateProfile } = useAuth();

  const [fullName, setFullName] = useState(driver?.full_name || '');
  const [phone, setPhone] = useState(driver?.phone || '');
  const [driverNumber, setDriverNumber] = useState(driver?.driver_number?.toString() || '');
  const [vehicleBrand, setVehicleBrand] = useState(driver?.vehicle_brand || '');
  const [vehicleModel, setVehicleModel] = useState(driver?.vehicle_model || '');
  const [vehicleYear, setVehicleYear] = useState(driver?.vehicle_year?.toString() || '');
  const [vehiclePlate, setVehiclePlate] = useState(driver?.vehicle_plate || '');
  const [vehicleColor, setVehicleColor] = useState(driver?.vehicle_color || '');
  const [vehicleType, setVehicleType] = useState(driver?.vehicle_type || 'auto');
  const [saving, setSaving] = useState(false);

  const licenseExpiry = driver?.license_expiry ? parseISO(driver.license_expiry) : null;
  const daysToExpiry = licenseExpiry ? differenceInDays(licenseExpiry, new Date()) : null;

  const getLicenseStatus = () => {
    if (daysToExpiry === null) return null;
    if (daysToExpiry < 0) return { label: 'VENCIDA', color: colors.danger };
    if (daysToExpiry <= 30) return { label: `Vence en ${daysToExpiry} días`, color: colors.warning };
    return { label: 'Vigente', color: colors.success };
  };
  const licenseStatus = getLicenseStatus();

  const pickImage = async (type) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Toast.show({ type: 'error', text1: 'Permiso denegado', text2: 'Necesitamos acceso a la galería' });
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: type === 'avatar' ? [1, 1] : [16, 9],
      quality: 0.8,
    });
    if (!result.canceled) await uploadImage(result.assets[0].uri, type);
  };

  const uploadImage = async (uri, type) => {
    try {
      const ext = uri.split('.').pop();
      const fileName = `${driver.id}/${type}-${Date.now()}.${ext}`;
      const bucket = type === 'avatar' ? 'avatars' : 'vehicles';
      const response = await fetch(uri);
      const blob = await response.blob();
      const { error: uploadError } = await supabase.storage
        .from(bucket)
        .upload(fileName, blob, { contentType: `image/${ext}`, upsert: true });
      if (uploadError) throw uploadError;
      const { data: urlData } = supabase.storage.from(bucket).getPublicUrl(fileName);
      const field = type === 'avatar' ? 'photo_url' : 'vehicle_photo_url';
      await updateProfile({ [field]: urlData.publicUrl });
      Toast.show({ type: 'success', text1: 'Imagen actualizada' });
    } catch (error) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'No se pudo subir la imagen' });
    }
  };

  const handleSave = async () => {
    setSaving(true);
    const profileData = {
      full_name: fullName, phone,
      driver_number: driverNumber ? parseInt(driverNumber) : null,
      vehicle_brand: vehicleBrand, vehicle_model: vehicleModel,
      vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
      vehicle_plate: vehiclePlate, vehicle_color: vehicleColor,
    };

    // Try saving vehicle_type to drivers table, fallback to settings
    const result = await updateProfile(profileData);

    // Save vehicle_type separately (handles missing column gracefully)
    if (driver?.id) {
      const { error } = await supabase.from('drivers').update({ vehicle_type: vehicleType }).eq('id', driver.id);
      if (error) {
        await supabase.from('settings').upsert(
          { key: `vehicle_type_${driver.id}`, value: vehicleType },
          { onConflict: 'key' }
        ).catch(() => {});
      }
    }

    setSaving(false);
  };

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro que querés cerrar sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: logout },
    ]);
  };

  const rating = Number(driver?.rating || 5).toFixed(1);
  const initials = driver?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <ScrollView
        contentContainerStyle={{ paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header with gradient */}
        <LinearGradient
          colors={[`${colors.primary}20`, colors.background]}
          style={{ paddingTop: insets.top + 16, paddingBottom: 24, paddingHorizontal: 20 }}
        >
          <Animated.View entering={FadeInDown.delay(80).duration(400)} style={{ alignItems: 'center' }}>
            <TouchableOpacity onPress={() => pickImage('avatar')} activeOpacity={0.8}>
              <View style={{
                width: 86, height: 86, borderRadius: 43,
                borderWidth: 3, borderColor: colors.primary,
                padding: 3,
              }}>
                <Avatar uri={driver?.photo_url} name={driver?.full_name} size={74} />
              </View>
              <View style={{
                position: 'absolute', bottom: 0, right: 0,
                width: 28, height: 28, borderRadius: 14,
                backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
                borderWidth: 2, borderColor: colors.background,
              }}>
                <MaterialCommunityIcons name="camera" size={14} color="#fff" />
              </View>
            </TouchableOpacity>

            <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold', marginTop: 12 }}>
              {driver?.full_name}
            </Text>

            {/* Rating & stats row */}
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 16 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons name="star" size={16} color={colors.warning} />
                <Text style={{ color: colors.warning, fontSize: 14, fontFamily: 'Inter_600SemiBold', marginLeft: 3 }}>
                  {rating}
                </Text>
              </View>
              <View style={{ width: 1, height: 14, backgroundColor: colors.border }} />
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                {driver?.total_trips || 0} viajes
              </Text>
              <View style={{ width: 1, height: 14, backgroundColor: colors.border }} />
              <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                {Number(driver?.total_km || 0).toFixed(0)} km
              </Text>
            </View>
          </Animated.View>
        </LinearGradient>

        <View style={{ paddingHorizontal: 16 }}>
          {/* Personal data */}
          <Animated.View entering={FadeInDown.delay(160).duration(400)}>
            <SectionCard title="Datos personales" icon="account-outline">
              <FormInput label="Nombre completo" value={fullName} onChangeText={setFullName} icon="account" />
              <FormInput label="Teléfono" value={phone} onChangeText={setPhone} icon="phone" keyboardType="phone-pad" />
              <FormInput label="Número de móvil" value={driverNumber} onChangeText={setDriverNumber} icon="numeric" keyboardType="numeric" placeholder="Ej: 1, 2, 3..." />
            </SectionCard>
          </Animated.View>

          {/* Vehicle data */}
          <Animated.View entering={FadeInDown.delay(240).duration(400)}>
            <SectionCard title="Mi vehículo" icon="car-sport">
              {/* Vehicle Type Selector */}
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 8, marginLeft: 2 }}>
                Tipo de vehículo
              </Text>
              <View style={{ flexDirection: 'row', gap: 10, marginBottom: 14 }}>
                {[
                  { key: 'auto', label: 'Auto', icon: 'car' },
                  { key: 'moto', label: 'Moto', icon: 'motorbike' },
                ].map((opt) => {
                  const isActive = vehicleType === opt.key;
                  return (
                    <TouchableOpacity
                      key={opt.key}
                      onPress={() => setVehicleType(opt.key)}
                      activeOpacity={0.7}
                      style={{
                        flex: 1,
                        flexDirection: 'row',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8,
                        paddingVertical: 12,
                        borderRadius: 12,
                        borderWidth: 1.5,
                        borderColor: isActive ? colors.primary : colors.border,
                        backgroundColor: isActive ? `${colors.primary}15` : colors.surfaceLight,
                      }}
                    >
                      <MaterialCommunityIcons
                        name={opt.icon}
                        size={22}
                        color={isActive ? colors.primary : colors.textMuted}
                      />
                      <Text style={{
                        fontSize: 14,
                        fontFamily: isActive ? 'Inter_600SemiBold' : 'Inter_500Medium',
                        color: isActive ? colors.primary : colors.textMuted,
                      }}>
                        {opt.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <FormInput label="Marca" value={vehicleBrand} onChangeText={setVehicleBrand} icon="car" />
              <FormInput label="Modelo" value={vehicleModel} onChangeText={setVehicleModel} icon="car-side" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ flex: 1 }}>
                  <FormInput label="Año" value={vehicleYear} onChangeText={setVehicleYear} icon="calendar" keyboardType="numeric" />
                </View>
                <View style={{ flex: 1 }}>
                  <FormInput label="Color" value={vehicleColor} onChangeText={setVehicleColor} icon="palette" />
                </View>
              </View>
              <FormInput label="Patente" value={vehiclePlate} onChangeText={setVehiclePlate} icon="card-text" autoCapitalize="characters" />
            </SectionCard>
          </Animated.View>

          {/* Documentation */}
          <Animated.View entering={FadeInDown.delay(320).duration(400)}>
            <SectionCard title="Documentación" icon="file-document-outline">
              <View style={{
                flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                backgroundColor: colors.surfaceLight, borderRadius: 12, padding: 14,
              }}>
                <View>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium' }}>
                    Vencimiento de licencia
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold', marginTop: 2 }}>
                    {licenseExpiry ? formatDate(driver.license_expiry) : 'No especificado'}
                  </Text>
                </View>
                {licenseStatus && (
                  <Badge label={licenseStatus.label} color={licenseStatus.color} size="md" />
                )}
              </View>
            </SectionCard>
          </Animated.View>

          {/* Actions */}
          <Animated.View entering={FadeInDown.delay(400).duration(400)} style={{ marginTop: 8, gap: 10 }}>
            <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.85}>
              <LinearGradient
                colors={colors.gradient.primary}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                style={{
                  height: 50, borderRadius: 14,
                  alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
                  opacity: saving ? 0.6 : 1,
                }}
              >
                <MaterialCommunityIcons name="content-save-outline" size={18} color="#fff" style={{ marginRight: 8 }} />
                <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                  {saving ? 'Guardando...' : 'Guardar cambios'}
                </Text>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity onPress={handleLogout} activeOpacity={0.7} style={{
              height: 50, borderRadius: 14, borderWidth: 1.5, borderColor: `${colors.danger}40`,
              alignItems: 'center', justifyContent: 'center', flexDirection: 'row',
              backgroundColor: `${colors.danger}08`,
            }}>
              <Ionicons name="log-out-outline" size={18} color={colors.danger} style={{ marginRight: 8 }} />
              <Text style={{ color: colors.danger, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
                Cerrar sesión
              </Text>
            </TouchableOpacity>
          </Animated.View>
        </View>
      </ScrollView>
    </View>
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

/* Form Input */
const FormInput = ({ label, value, onChangeText, icon, ...props }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 6, marginLeft: 2 }}>
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

export default ProfileScreen;
