import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  FlatList,
  TouchableOpacity,
  TextInput,
  RefreshControl,
  StatusBar,
  ActivityIndicator,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Toast from 'react-native-toast-message';
import { colors } from '../theme/colors';
import { useOwner } from '../hooks/useOwner';
import { Avatar } from '../components/ui/Avatar';
import { formatPrice, formatDate, formatDistance } from '../utils/formatters';
import { TRIP_STATUS_LABELS, TRIP_STATUS_COLORS } from '../utils/constants';
import { supabase } from '../services/supabase';
import { useAuthStore } from '../stores/authStore';

const FILTERS = [
  { key: 'today', label: 'Hoy' },
  { key: 'week', label: 'Semana' },
  { key: 'month', label: 'Mes' },
  { key: 'all', label: 'Todo' },
];

const OwnerDriverDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute();
  const { driverId, driverName } = route.params;
  const { driver: ownerDriver } = useAuthStore();

  const { useDriverStats, useDriverTripHistory, toggleDriverStatus, updateLinkedDriver } = useOwner();

  const [activeFilter, setActiveFilter] = useState('today');
  const [editModalVisible, setEditModalVisible] = useState(false);

  // Cargar perfil del conductor vinculado
  const [linkedDriver, setLinkedDriver] = useState(null);
  const [loadingDriver, setLoadingDriver] = useState(true);

  React.useEffect(() => {
    const fetchDriver = async () => {
      setLoadingDriver(true);
      const { data, error } = await supabase
        .from('drivers')
        .select('*')
        .eq('id', driverId)
        .eq('owner_id', ownerDriver?.id)
        .single();
      if (!error) setLinkedDriver(data);
      setLoadingDriver(false);
    };
    fetchDriver();
  }, [driverId, ownerDriver?.id]);

  const { data: stats, isLoading: statsLoading } = useDriverStats(driverId, activeFilter);
  const {
    data: tripPages,
    isLoading: tripsLoading,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch: refetchTrips,
    isRefetching,
  } = useDriverTripHistory(driverId, activeFilter);

  const allTrips = tripPages?.pages?.flatMap(p => p.data) || [];

  const handleToggleStatus = useCallback(() => {
    if (!linkedDriver) return;
    const newStatus = !linkedDriver.is_available;
    Alert.alert(
      newStatus ? 'Activar conductor' : 'Desactivar conductor',
      `¿Querés ${newStatus ? 'activar' : 'desactivar'} a ${linkedDriver.full_name}?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: newStatus ? 'Activar' : 'Desactivar',
          style: newStatus ? 'default' : 'destructive',
          onPress: async () => {
            try {
              await toggleDriverStatus.mutateAsync({ driverId, isAvailable: newStatus });
              setLinkedDriver(prev => prev ? { ...prev, is_available: newStatus } : prev);
              Toast.show({
                type: 'success',
                text1: `Conductor ${newStatus ? 'activado' : 'desactivado'}`,
              });
            } catch (err) {
              Toast.show({ type: 'error', text1: 'Error', text2: err.message });
            }
          },
        },
      ],
    );
  }, [linkedDriver, driverId, toggleDriverStatus]);

  const renderTrip = useCallback(({ item, index }) => {
    const statusColor = TRIP_STATUS_COLORS[item.status] || colors.textMuted;
    const statusLabel = TRIP_STATUS_LABELS[item.status] || item.status;
    return (
      <Animated.View entering={FadeInDown.delay(index * 40).duration(300)}>
        <View style={{
          backgroundColor: colors.surface,
          borderRadius: 14,
          padding: 13,
          marginBottom: 8,
          borderWidth: 1,
          borderColor: colors.border,
        }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
                {item.passenger_name || 'Sin nombre'}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
                {formatDate(item.created_at)}
              </Text>
            </View>
            <View style={{
              backgroundColor: `${statusColor}18`,
              borderRadius: 8,
              paddingHorizontal: 8,
              paddingVertical: 3,
            }}>
              <Text style={{ color: statusColor, fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                {statusLabel}
              </Text>
            </View>
          </View>

          {/* Addresses */}
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 4 }}>
            <MaterialCommunityIcons name="map-marker-circle" size={14} color={colors.success} style={{ marginTop: 1, marginRight: 6 }} />
            <Text style={{ color: colors.textDark, fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 }} numberOfLines={1}>
              {item.origin_address}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 }}>
            <MaterialCommunityIcons name="map-marker" size={14} color={colors.danger} style={{ marginTop: 1, marginRight: 6 }} />
            <Text style={{ color: colors.textDark, fontSize: 12, fontFamily: 'Inter_400Regular', flex: 1 }} numberOfLines={1}>
              {item.destination_address}
            </Text>
          </View>

          {/* Price & commission */}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <MaterialCommunityIcons name="cash" size={13} color={colors.success} style={{ marginRight: 4 }} />
              <Text style={{ color: colors.success, fontSize: 13, fontFamily: 'Inter_700Bold' }}>
                {formatPrice(item.price)}
              </Text>
            </View>
            {item.commission_amount > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <MaterialCommunityIcons name="percent" size={12} color={colors.warning} style={{ marginRight: 4 }} />
                <Text style={{ color: colors.warning, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                  Com. {formatPrice(item.commission_amount)}
                </Text>
              </View>
            )}
            {item.distance_km && (
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                {formatDistance(item.distance_km)}
              </Text>
            )}
          </View>
        </View>
      </Animated.View>
    );
  }, []);

  const driverInitials = linkedDriver?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <FlatList
        data={allTrips}
        keyExtractor={(item) => item.id}
        renderItem={renderTrip}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 30 }}
        showsVerticalScrollIndicator={false}
        onEndReached={() => { if (hasNextPage && !isFetchingNextPage) fetchNextPage(); }}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={isRefetching}
            onRefresh={refetchTrips}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        ListHeaderComponent={
          <>
            {/* Header */}
            <LinearGradient
              colors={[`${colors.primary}18`, colors.background]}
              style={{ marginHorizontal: -16, paddingTop: insets.top + 12, paddingBottom: 16, paddingHorizontal: 20, marginBottom: 12 }}
            >
              {/* Back + actions */}
              <Animated.View entering={FadeIn.duration(400)} style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 20 }}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginRight: 12 }}>
                  <Ionicons name="arrow-back" size={22} color={colors.text} />
                </TouchableOpacity>
                <Text style={{ flex: 1, color: colors.text, fontSize: 18, fontFamily: 'Inter_700Bold' }}>
                  {driverName}
                </Text>
                <TouchableOpacity
                  onPress={() => setEditModalVisible(true)}
                  style={{
                    width: 36, height: 36, borderRadius: 10,
                    backgroundColor: `${colors.primary}15`,
                    alignItems: 'center', justifyContent: 'center',
                    marginLeft: 8,
                  }}
                >
                  <MaterialCommunityIcons name="pencil-outline" size={17} color={colors.primary} />
                </TouchableOpacity>
              </Animated.View>

              {/* Driver card */}
              {loadingDriver ? (
                <ActivityIndicator color={colors.primary} />
              ) : linkedDriver && (
                <Animated.View entering={FadeInDown.delay(100).duration(400)}>
                  <View style={{
                    backgroundColor: colors.surface,
                    borderRadius: 16, borderWidth: 1, borderColor: colors.border,
                    padding: 16, flexDirection: 'row', alignItems: 'center',
                  }}>
                    <View style={{
                      borderRadius: 30,
                      borderWidth: 2,
                      borderColor: linkedDriver.is_available ? colors.success : colors.border,
                      padding: 2,
                    }}>
                      <Avatar uri={linkedDriver.photo_url} name={linkedDriver.full_name} size={56} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 14 }}>
                      <Text style={{ color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold' }}>
                        {linkedDriver.full_name}
                      </Text>
                      {linkedDriver.phone && (
                        <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                          {linkedDriver.phone}
                        </Text>
                      )}
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 8 }}>
                        {linkedDriver.vehicle_plate && (
                          <View style={{
                            backgroundColor: colors.surfaceLight, borderRadius: 6,
                            paddingHorizontal: 7, paddingVertical: 2,
                          }}>
                            <Text style={{ color: colors.textDark, fontSize: 11, fontFamily: 'Inter_700Bold', letterSpacing: 0.5 }}>
                              {linkedDriver.vehicle_plate}
                            </Text>
                          </View>
                        )}
                        {linkedDriver.driver_number && (
                          <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular' }}>
                            Móvil #{linkedDriver.driver_number}
                          </Text>
                        )}
                      </View>
                    </View>
                    {/* Status toggle */}
                    <TouchableOpacity
                      onPress={handleToggleStatus}
                      activeOpacity={0.7}
                      style={{
                        backgroundColor: linkedDriver.is_available ? `${colors.success}18` : `${colors.textMuted}18`,
                        borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
                        flexDirection: 'row', alignItems: 'center',
                      }}
                    >
                      <View style={{
                        width: 8, height: 8, borderRadius: 4,
                        backgroundColor: linkedDriver.is_available ? colors.success : colors.textMuted,
                        marginRight: 5,
                      }} />
                      <Text style={{
                        fontSize: 12, fontFamily: 'Inter_600SemiBold',
                        color: linkedDriver.is_available ? colors.success : colors.textMuted,
                      }}>
                        {linkedDriver.is_available ? 'Activo' : 'Inactivo'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </Animated.View>
              )}
            </LinearGradient>

            {/* Stats */}
            <Animated.View entering={FadeInDown.delay(150).duration(400)} style={{ marginBottom: 14 }}>
              <View style={{
                backgroundColor: colors.surface, borderRadius: 16,
                borderWidth: 1, borderColor: colors.border, overflow: 'hidden',
              }}>
                <View style={{ flexDirection: 'row' }}>
                  <MiniStat label="Viajes" value={stats?.totalTrips ?? '—'} icon="car" color={colors.info} />
                  <View style={{ width: 1, backgroundColor: colors.border }} />
                  <MiniStat label="Completados" value={stats?.completedTrips ?? '—'} icon="check-circle" color={colors.success} />
                  <View style={{ width: 1, backgroundColor: colors.border }} />
                  <MiniStat label="Cancelados" value={stats?.cancelledTrips ?? '—'} icon="close-circle" color={colors.danger} />
                </View>
                <View style={{ height: 1, backgroundColor: colors.border }} />
                <View style={{ flexDirection: 'row' }}>
                  <MiniStat label="Ganancias" value={formatPrice(stats?.totalEarnings || 0)} icon="cash" color={colors.success} />
                  <View style={{ width: 1, backgroundColor: colors.border }} />
                  <MiniStat label="Comisiones" value={formatPrice(stats?.totalCommission || 0)} icon="percent" color={colors.warning} />
                  <View style={{ width: 1, backgroundColor: colors.border }} />
                  <MiniStat
                    label="Rating"
                    value={`★ ${Number(linkedDriver?.rating || 5).toFixed(1)}`}
                    icon="star"
                    color={colors.warning}
                  />
                </View>
              </View>
            </Animated.View>

            {/* Period filters */}
            <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginBottom: 12 }}>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {FILTERS.map(f => {
                  const active = f.key === activeFilter;
                  return (
                    <TouchableOpacity
                      key={f.key}
                      onPress={() => setActiveFilter(f.key)}
                      style={{
                        flex: 1, paddingVertical: 8, borderRadius: 10,
                        backgroundColor: active ? colors.primary : colors.surface,
                        borderWidth: 1, borderColor: active ? colors.primary : colors.border,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{
                        fontSize: 12, fontFamily: active ? 'Inter_600SemiBold' : 'Inter_400Regular',
                        color: active ? '#fff' : colors.textMuted,
                      }}>
                        {f.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>

            <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium', marginBottom: 8, marginLeft: 2 }}>
              HISTORIAL DE VIAJES
            </Text>

            {tripsLoading && (
              <View style={{ paddingVertical: 40, alignItems: 'center' }}>
                <ActivityIndicator color={colors.primary} />
              </View>
            )}
          </>
        }
        ListEmptyComponent={
          !tripsLoading ? (
            <View style={{ alignItems: 'center', paddingTop: 40 }}>
              <MaterialCommunityIcons name="car-off" size={40} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_400Regular', marginTop: 12 }}>
                Sin viajes en este período
              </Text>
            </View>
          ) : null
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator color={colors.primary} style={{ marginVertical: 16 }} />
          ) : null
        }
      />

      {/* Edit modal */}
      {linkedDriver && (
        <EditDriverModal
          driver={linkedDriver}
          visible={editModalVisible}
          onClose={() => setEditModalVisible(false)}
          onSave={async (updates) => {
            try {
              const updated = await updateLinkedDriver.mutateAsync({ driverId, updates });
              setLinkedDriver(updated);
              setEditModalVisible(false);
              Toast.show({ type: 'success', text1: 'Conductor actualizado' });
            } catch (err) {
              Toast.show({ type: 'error', text1: 'Error', text2: err.message });
            }
          }}
          saving={updateLinkedDriver.isPending}
        />
      )}
    </View>
  );
};

/* Mini stat cell */
const MiniStat = ({ label, value, icon, color }) => (
  <View style={{ flex: 1, alignItems: 'center', paddingVertical: 12 }}>
    <MaterialCommunityIcons name={icon} size={16} color={color} style={{ marginBottom: 2 }} />
    <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_700Bold' }}>{value}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 1, textAlign: 'center' }}>
      {label}
    </Text>
  </View>
);

/* Edit driver modal */
const EditDriverModal = ({ driver, visible, onClose, onSave, saving }) => {
  const [fullName, setFullName] = useState(driver.full_name || '');
  const [phone, setPhone] = useState(driver.phone || '');
  const [driverNumber, setDriverNumber] = useState(driver.driver_number?.toString() || '');
  const [vehicleBrand, setVehicleBrand] = useState(driver.vehicle_brand || '');
  const [vehicleModel, setVehicleModel] = useState(driver.vehicle_model || '');
  const [vehicleYear, setVehicleYear] = useState(driver.vehicle_year?.toString() || '');
  const [vehiclePlate, setVehiclePlate] = useState(driver.vehicle_plate || '');
  const [vehicleColor, setVehicleColor] = useState(driver.vehicle_color || '');

  const handleSave = () => {
    if (!fullName.trim()) {
      Toast.show({ type: 'error', text1: 'Nombre requerido' });
      return;
    }
    onSave({
      full_name: fullName.trim(),
      phone: phone.trim() || null,
      driver_number: driverNumber ? parseInt(driverNumber, 10) : null,
      vehicle_brand: vehicleBrand.trim() || null,
      vehicle_model: vehicleModel.trim() || null,
      vehicle_year: vehicleYear ? parseInt(vehicleYear, 10) : null,
      vehicle_plate: vehiclePlate.trim() || null,
      vehicle_color: vehicleColor.trim() || null,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Modal header */}
          <View style={{
            flexDirection: 'row', alignItems: 'center',
            paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16,
            borderBottomWidth: 1, borderBottomColor: colors.border,
            backgroundColor: colors.surface,
          }}>
            <TouchableOpacity onPress={onClose} style={{ marginRight: 12 }}>
              <Ionicons name="close" size={22} color={colors.text} />
            </TouchableOpacity>
            <Text style={{ flex: 1, color: colors.text, fontSize: 17, fontFamily: 'Inter_700Bold' }}>
              Editar conductor
            </Text>
            <TouchableOpacity onPress={handleSave} disabled={saving} activeOpacity={0.8}>
              <Text style={{ color: saving ? colors.textMuted : colors.primary, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                {saving ? 'Guardando...' : 'Guardar'}
              </Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={{ padding: 20 }} keyboardShouldPersistTaps="handled">
            <ModalField label="Nombre completo" value={fullName} onChange={setFullName} icon="account" />
            <ModalField label="Teléfono" value={phone} onChange={setPhone} icon="phone" keyboardType="phone-pad" />
            <ModalField label="Número de móvil" value={driverNumber} onChange={setDriverNumber} icon="numeric" keyboardType="numeric" />
            <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 16 }} />
            <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5, marginBottom: 12 }}>
              VEHÍCULO
            </Text>
            <ModalField label="Marca" value={vehicleBrand} onChange={setVehicleBrand} icon="car" />
            <ModalField label="Modelo" value={vehicleModel} onChange={setVehicleModel} icon="car-side" />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <ModalField label="Año" value={vehicleYear} onChange={setVehicleYear} icon="calendar" keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <ModalField label="Color" value={vehicleColor} onChange={setVehicleColor} icon="palette" />
              </View>
            </View>
            <ModalField label="Patente" value={vehiclePlate} onChange={setVehiclePlate} icon="card-text" autoCapitalize="characters" />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
};

const ModalField = ({ label, value, onChange, icon, ...props }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 5, marginLeft: 2 }}>
      {label}
    </Text>
    <View style={{
      backgroundColor: colors.surface, borderRadius: 12,
      borderWidth: 1, borderColor: colors.border,
      flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12,
    }}>
      <MaterialCommunityIcons name={icon} size={16} color={colors.textMuted} />
      <TextInput
        value={value}
        onChangeText={onChange}
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

export default OwnerDriverDetailScreen;
