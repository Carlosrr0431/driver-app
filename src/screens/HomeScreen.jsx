import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  RefreshControl,
  StatusBar,
  StyleSheet,
  Image,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, SlideInRight } from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { colors } from '../theme/colors';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { useTrips } from '../hooks/useTrips';
import { useRealtime } from '../hooks/useRealtime';
import { useLocation } from '../hooks/useLocation';
import { supabase } from '../services/supabase';
import { NewTripModal } from '../components/trip/NewTripModal';
import { VoiceChatModal } from '../components/VoiceChatModal';
import { useVoiceAutoPlay } from '../hooks/useVoiceAutoPlay';
import { formatPrice, formatDistance } from '../utils/formatters';
import { DEFAULT_REGION } from '../utils/constants';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

const DriverLocationMarker = React.memo(({ location, vehicleType }) => {
  const [ready, setReady] = useState(true);
  return (
    <Marker
      coordinate={{ latitude: location.lat, longitude: location.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={ready}
    >
      <View
        style={{ alignItems: 'center', justifyContent: 'center' }}
        onLayout={() => { if (ready) setTimeout(() => setReady(false), 800); }}
      >
        <View style={{
          width: 34, height: 34, borderRadius: 17,
          backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
          borderWidth: 2, borderColor: '#fff',
          elevation: 4, shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.3, shadowRadius: 4,
        }}>
          <MaterialCommunityIcons name={vehicleType === 'moto' ? 'motorbike' : 'car'} size={18} color="#fff" />
        </View>
      </View>
    </Marker>
  );
});

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { driver, updateDriver } = useAuthStore();
  const { pendingTrip, showNewTripModal, activeTrip } = useTripStore();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const { useTodayStats, useActiveTrip, useCommissionBalance, acceptTrip, rejectTrip, useTripHistory } = useTrips();
  const { subscribeToNewTrips, subscribeToMessages } = useRealtime();
  const { requestPermissions, getCurrentPosition, startWatching, stopWatching } = useLocation();
  const mapRef = useRef(null);
  const bottomSheetRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const snapPoints = useMemo(() => ['25%', '70%'], []);

  useVoiceAutoPlay();

  const { data: stats, refetch: refetchStats } = useTodayStats();
  const { data: activeTripData } = useActiveTrip();
  const { data: commissionData } = useCommissionBalance();
  const { data: todayTrips, isLoading: tripsLoading, refetch: refetchTrips } = useTripHistory('today');

  const isOnline = driver?.is_available || false;
  const currentVehicleType = driver?.vehicle_type || 'auto';

  useEffect(() => {
    const init = async () => {
      await requestPermissions();
      await getCurrentPosition();
      if (isOnline) startWatching();
    };
    init();
    return () => { stopWatching(); };
  }, []);

  useEffect(() => {
    if (driver?.id) {
      subscribeToNewTrips();
      subscribeToMessages();
    }
  }, [driver?.id, subscribeToNewTrips, subscribeToMessages]);

  useEffect(() => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }, 800);
    }
  }, [currentLocation]);

  useEffect(() => {
    if (activeTripData) navigation.navigate('ActiveTrip');
  }, [activeTripData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStats(), refetchTrips(), getCurrentPosition()]);
    setRefreshing(false);
  }, []);

  const handleToggleStatus = async () => {
    if (!driver?.id) return;
    const newStatus = !isOnline;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (newStatus && commissionData?.isBlocked) {
      Toast.show({
        type: 'error',
        text1: 'Cuenta bloqueada',
        text2: 'Regularizá tus comisiones para poder conectarte',
        visibilityTime: 4000,
      });
      return;
    }

    try {
      const { error } = await supabase.from('drivers').update({ is_available: newStatus }).eq('id', driver.id);
      if (error) throw error;

      await supabase.from('driver_locations').upsert({
        driver_id: driver.id,
        is_online: newStatus,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' });

      updateDriver({ is_available: newStatus });
      if (newStatus) { startWatching(); } else { stopWatching(); }

      Toast.show({
        type: 'success',
        text1: newStatus ? 'Estás en línea' : 'Estás desconectado',
        text2: newStatus ? 'Vas a recibir viajes' : 'No recibirás viajes',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'No se pudo cambiar el estado' });
    }
  };

  const handleRejectTrip = async (tripId, reason) => {
    await rejectTrip(tripId, reason);
  };

  const handleChangeVehicleType = async (type) => {
    if (type === currentVehicleType || !driver?.id) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const { error } = await supabase.from('drivers').update({ vehicle_type: type }).eq('id', driver.id);
      if (error) {
        const { error: settingsError } = await supabase.from('settings').upsert(
          { key: `vehicle_type_${driver.id}`, value: type },
          { onConflict: 'key' }
        );
        if (settingsError) throw settingsError;
      }
      updateDriver({ vehicle_type: type });
      Toast.show({
        type: 'success',
        text1: type === 'moto' ? 'Modo moto activado' : 'Modo auto activado',
        text2: `Trabajando en ${type === 'moto' ? 'motocicleta' : 'automóvil'}`,
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'No se pudo cambiar el tipo de vehículo' });
    }
  };

  const recenter = () => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: currentLocation.lat,
        longitude: currentLocation.lng,
        latitudeDelta: 0.006,
        longitudeDelta: 0.006,
      }, 500);
    }
  };

  const allTrips = todayTrips?.pages?.flatMap((p) => p.data) || [];
  const firstName = driver?.full_name?.split(' ')[0] || 'Chofer';
  const initials = driver?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* MAPA */}
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFillObject}
        initialRegion={
          currentLocation
            ? { latitude: currentLocation.lat, longitude: currentLocation.lng, latitudeDelta: 0.006, longitudeDelta: 0.006 }
            : DEFAULT_REGION
        }
        showsUserLocation={false}
        showsMyLocationButton={false}
        showsCompass={false}
        showsTraffic={false}
        showsBuildings={false}
        customMapStyle={mapLightStyle}
      >
        {currentLocation && (
          <>
            <Circle
              center={{ latitude: currentLocation.lat, longitude: currentLocation.lng }}
              radius={250}
              fillColor="rgba(220,38,38,0.06)"
              strokeColor="rgba(220,38,38,0.15)"
              strokeWidth={1}
            />
            <DriverLocationMarker location={currentLocation} vehicleType={currentVehicleType} />
          </>
        )}
      </MapView>

      {/* Gradiente superior */}
      <LinearGradient
        colors={['rgba(245,246,250,0.95)', 'transparent']}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 56 }}
        pointerEvents="none"
      />

      {/* Header flotante */}
      <View style={{
        position: 'absolute', top: insets.top + 8, left: 16, right: 16,
        flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
      }}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <View style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: colors.surfaceLight, borderWidth: 2, borderColor: colors.primary,
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {driver?.photo_url ? (
              <Image source={{ uri: driver.photo_url }} style={{ width: 40, height: 40, borderRadius: 20 }} />
            ) : (
              <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_700Bold' }}>{initials}</Text>
            )}
          </View>
          <View style={{ marginLeft: 10 }}>
            <Text style={{ color: colors.textDark, fontSize: 12, fontFamily: 'Inter_400Regular' }}>
              Hola, {firstName} 👋
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 1 }}>
              <View style={{
                width: 6, height: 6, borderRadius: 3,
                backgroundColor: isOnline ? colors.success : colors.offline, marginRight: 5,
              }} />
              <Text style={{
                color: isOnline ? colors.success : colors.textMuted,
                fontSize: 11, fontFamily: 'Inter_600SemiBold',
              }}>
                {isOnline ? 'En línea' : 'Desconectado'}
              </Text>
            </View>
          </View>
        </View>

        <TouchableOpacity style={{
          width: 40, height: 40, borderRadius: 20,
          backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: colors.border,
          elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08, shadowRadius: 4,
        }}>
          <Ionicons name="notifications-outline" size={20} color={colors.secondary} />
        </TouchableOpacity>
      </View>

      {/* Botón recentrar */}
      <TouchableOpacity onPress={recenter} style={{
        position: 'absolute', right: 16, top: insets.top + 70,
        width: 42, height: 42, borderRadius: 21,
        backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
        borderWidth: 1, borderColor: colors.border,
        elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.08, shadowRadius: 4,
      }}>
        <Ionicons name="locate" size={20} color={colors.secondary} />
      </TouchableOpacity>

      {/* ========== BOTTOM SHEET ========== */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={{
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: -6 },
          shadowOpacity: 0.08,
          shadowRadius: 16,
          elevation: 12,
        }}
        handleIndicatorStyle={{
          backgroundColor: '#D1D5DB',
          width: 36,
          height: 4,
          borderRadius: 2,
        }}
        enablePanDownToClose={false}
      >
        {/* ── ZONA FIJA: siempre visible aunque el sheet esté en el snap mínimo ── */}
        <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>

          {/* Toggle estado */}
          <TouchableOpacity onPress={handleToggleStatus} activeOpacity={0.82}
            style={{
              flexDirection: 'row', alignItems: 'center',
              backgroundColor: isOnline ? '#F0FDF4' : '#F9FAFB',
              borderRadius: 18, paddingVertical: 11, paddingHorizontal: 14,
              borderWidth: 1.5, borderColor: isOnline ? '#86EFAC' : '#E5E7EB',
            }}>
            <View style={{
              width: 40, height: 40, borderRadius: 20,
              backgroundColor: isOnline ? '#DCFCE7' : '#F3F4F6',
              alignItems: 'center', justifyContent: 'center',
            }}>
              <MaterialCommunityIcons
                name={isOnline ? 'power' : 'power-off'}
                size={21} color={isOnline ? '#16A34A' : '#9CA3AF'}
              />
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={{
                fontSize: 15, fontFamily: 'Inter_700Bold',
                color: isOnline ? '#15803D' : '#4B5563',
              }}>
                {isOnline ? 'En línea · Recibiendo viajes' : 'Desconectado'}
              </Text>
              <Text style={{ fontSize: 11, fontFamily: 'Inter_400Regular', color: '#9CA3AF', marginTop: 1 }}>
                {isOnline ? 'Toca para desconectarte' : 'Toca para conectarte'}
              </Text>
            </View>
            <View style={{
              width: 46, height: 26, borderRadius: 13,
              backgroundColor: isOnline ? '#16A34A' : '#D1D5DB',
              justifyContent: 'center', paddingHorizontal: 3,
            }}>
              <View style={{
                width: 20, height: 20, borderRadius: 10, backgroundColor: '#fff',
                alignSelf: isOnline ? 'flex-end' : 'flex-start',
                elevation: 2, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 2,
              }} />
            </View>
          </TouchableOpacity>

          {/* Selector de vehículo */}
          <View style={{
            flexDirection: 'row', marginTop: 8,
            backgroundColor: '#F3F4F6', borderRadius: 14, padding: 4,
          }}>
            {[
              { key: 'auto', label: 'Auto', icon: 'car' },
              { key: 'moto', label: 'Moto', icon: 'motorbike' },
            ].map((opt) => {
              const isActive = currentVehicleType === opt.key;
              const activeColor = opt.key === 'moto' ? '#F59E0B' : colors.primary;
              return (
                <TouchableOpacity key={opt.key} onPress={() => handleChangeVehicleType(opt.key)}
                  activeOpacity={0.75} style={{
                    flex: 1, flexDirection: 'row', alignItems: 'center',
                    justifyContent: 'center', gap: 6, paddingVertical: 8, borderRadius: 11,
                    backgroundColor: isActive ? '#FFFFFF' : 'transparent',
                    elevation: isActive ? 2 : 0,
                    shadowColor: '#000', shadowOpacity: isActive ? 0.06 : 0, shadowRadius: 4,
                  }}>
                  <MaterialCommunityIcons name={opt.icon} size={17}
                    color={isActive ? activeColor : '#9CA3AF'} />
                  <Text style={{
                    fontSize: 13,
                    fontFamily: isActive ? 'Inter_600SemiBold' : 'Inter_400Regular',
                    color: isActive ? activeColor : '#9CA3AF',
                  }}>{opt.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Divisor */}
        <View style={{ height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 16, marginBottom: 2 }} />

        {/* ── ZONA SCROLL: stats + historial ── */}
        <BottomSheetScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              tintColor={colors.primary} colors={[colors.primary]} />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Alerta de comisiones */}
          {commissionData && commissionData.balance > 0 && (
            <Animated.View entering={FadeInUp.delay(60).duration(350)}>
              <View style={{
                backgroundColor: commissionData.isOverdue ? '#FEF2F2' : '#FFFBEB',
                borderRadius: 14, padding: 14, marginBottom: 12,
                borderWidth: 1, borderColor: commissionData.isOverdue ? '#FECACA' : '#FDE68A',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                  <MaterialCommunityIcons
                    name={commissionData.isOverdue ? 'alert-circle' : 'cash-clock'}
                    size={17} color={commissionData.isOverdue ? '#DC2626' : '#D97706'}
                  />
                  <Text style={{
                    color: commissionData.isOverdue ? '#DC2626' : '#D97706',
                    fontSize: 13, fontFamily: 'Inter_700Bold', marginLeft: 7,
                  }}>
                    {commissionData.isOverdue ? 'Cuenta suspendida' : 'Comisión pendiente'}
                  </Text>
                </View>
                <Text style={{ color: '#6B7280', fontSize: 11, fontFamily: 'Inter_400Regular', lineHeight: 16 }}>
                  {commissionData.isOverdue
                    ? 'Tu cuenta está bloqueada por comisiones vencidas. Regularizá tu deuda para recibir viajes.'
                    : 'Tenés comisiones pendientes. Regularizá dentro de los 3 días para evitar bloqueo.'
                  }
                </Text>
                <View style={{
                  flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                  marginTop: 8, paddingTop: 8,
                  borderTopWidth: 1, borderTopColor: commissionData.isOverdue ? '#FEE2E2' : '#FEF3C7',
                }}>
                  <Text style={{ color: '#9CA3AF', fontSize: 10, fontFamily: 'Inter_500Medium' }}>Deuda actual</Text>
                  <Text style={{
                    color: commissionData.isOverdue ? '#DC2626' : '#D97706',
                    fontSize: 16, fontFamily: 'Inter_700Bold',
                  }}>
                    {formatPrice(commissionData.balance)}
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Stats */}
          <Animated.View entering={FadeInUp.delay(80).duration(380)}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <MiniStat icon="car-side" label="Viajes" value={String(stats?.totalTrips || 0)} color={colors.primary} />
              <MiniStat icon="map-marker-distance" label="Distancia" value={formatDistance(stats?.totalKm)} color={colors.info} />
              <MiniStat icon="clock-outline" label="Horas" value={`${stats?.totalHours || 0}h`} color={colors.warning} />
              <MiniStat icon="cash" label="Ganancia" value={formatPrice(stats?.totalEarnings)} color={colors.secondary} />
            </View>
          </Animated.View>

          {/* Viaje activo */}
          {activeTrip && (
            <Animated.View entering={SlideInRight.delay(100).springify()} style={{ marginTop: 12 }}>
              <TouchableOpacity onPress={() => navigation.navigate('ActiveTrip')} activeOpacity={0.8}
                style={{
                  backgroundColor: '#EFF6FF', borderRadius: 16, padding: 14,
                  borderWidth: 1, borderColor: '#BFDBFE',
                  flexDirection: 'row', alignItems: 'center',
                }}>
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: '#DBEAFE', alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="navigation" size={20} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={{ color: '#1D4ED8', fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>Viaje en curso</Text>
                  <Text style={{ color: '#60A5FA', fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                    {activeTrip.destination_address}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.primary} />
              </TouchableOpacity>
            </Animated.View>
          )}

          {/* Actividad reciente */}
          <Animated.View entering={FadeInUp.delay(140).duration(380)} style={{ marginTop: 18 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: '#111827', fontSize: 15, fontFamily: 'Inter_700Bold' }}>
                Actividad reciente
              </Text>
              {allTrips.length > 0 && (
                <TouchableOpacity onPress={() => navigation.navigate('History')}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Ver todo →</Text>
                </TouchableOpacity>
              )}
            </View>

            {tripsLoading ? (
              <SkeletonTrips />
            ) : allTrips.length > 0 ? (
              allTrips.slice(0, 3).map((trip, idx) => (
                <Animated.View key={trip.id} entering={FadeInUp.delay(160 + idx * 50).duration(300)}>
                  <TripRow trip={trip} onPress={() => navigation.navigate('TripDetail', { tripId: trip.id })} />
                </Animated.View>
              ))
            ) : (
              <View style={{
                backgroundColor: '#F9FAFB', borderRadius: 16, padding: 28,
                alignItems: 'center', borderWidth: 1, borderColor: '#F3F4F6',
              }}>
                <MaterialCommunityIcons name="car-off" size={36} color="#D1D5DB" style={{ marginBottom: 8 }} />
                <Text style={{ color: '#6B7280', fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
                  Sin viajes hoy
                </Text>
                <Text style={{ color: '#9CA3AF', fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center' }}>
                  {isOnline ? 'Esperando asignaciones...' : 'Conectate para recibir viajes'}
                </Text>
              </View>
            )}
          </Animated.View>
        </BottomSheetScrollView>
      </BottomSheet>

      <NewTripModal
        visible={showNewTripModal}
        trip={pendingTrip}
        onAccept={async (id) => {
          const result = await acceptTrip(id);
          if (result?.success) {
            navigation.navigate('ActiveTrip');
          }
          return result;
        }}
        onReject={handleRejectTrip}
      />

      {/* Floating radio button */}
      <TouchableOpacity
        onPress={() => setShowVoice(true)}
        activeOpacity={0.8}
        style={{
          position: 'absolute',
          left: 16,
          top: insets.top + 70,
          width: 42,
          height: 42,
          borderRadius: 21,
          backgroundColor: '#FFFFFF',
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: 1,
          borderColor: colors.border,
          elevation: 3,
          shadowColor: '#000',
          shadowOffset: { width: 0, height: 2 },
          shadowOpacity: 0.08,
          shadowRadius: 4,
        }}
      >
        <MaterialCommunityIcons name="radio-tower" size={20} color={colors.primary} />
      </TouchableOpacity>

      <VoiceChatModal visible={showVoice} onClose={() => setShowVoice(false)} />
    </View>
  );
};

/* ========== COMPONENTES ========== */

const MiniStat = ({ icon, label, value, color }) => (
  <View style={{
    flex: 1, backgroundColor: '#F9FAFB', borderRadius: 14, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: '#F3F4F6',
  }}>
    <MaterialCommunityIcons name={icon} size={18} color={color} style={{ marginBottom: 4 }} />
    <Text style={{ color: '#111827', fontSize: 14, fontFamily: 'Inter_700Bold' }}>{value}</Text>
    <Text style={{ color: '#9CA3AF', fontSize: 9, fontFamily: 'Inter_500Medium', marginTop: 2 }}>{label}</Text>
  </View>
);

const TripRow = ({ trip, onPress }) => {
  const sc = {
    completed: colors.success, cancelled: colors.danger, in_progress: colors.primary,
    pending: colors.warning, accepted: colors.info, going_to_pickup: colors.primary,
  };
  const c = sc[trip.status] || colors.textMuted;
  const time = trip.created_at
    ? new Date(trip.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7} style={{
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: '#FFFFFF', borderRadius: 14, padding: 12, marginBottom: 8,
      borderWidth: 1, borderColor: '#F3F4F6',
      elevation: 1, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 4,
    }}>
      <View style={{
        width: 38, height: 38, borderRadius: 12,
        backgroundColor: `${c}15`, alignItems: 'center', justifyContent: 'center',
      }}>
        <MaterialCommunityIcons
          name={trip.status === 'completed' ? 'check-circle' : trip.status === 'cancelled' ? 'close-circle' : 'navigation'}
          size={18} color={c}
        />
      </View>
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ color: '#111827', fontSize: 13, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
          {trip.destination_address || 'Viaje'}
        </Text>
        <Text style={{ color: '#9CA3AF', fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
          {time} · {formatDistance(trip.distance_km)}
        </Text>
      </View>
      <Text style={{ color: c, fontSize: 14, fontFamily: 'Inter_700Bold' }}>
        {formatPrice(trip.price)}
      </Text>
    </TouchableOpacity>
  );
};

const SkeletonTrips = () => (
  <View>
    {[1, 2, 3].map(i => (
      <View key={i} style={{
        backgroundColor: '#F9FAFB', borderRadius: 14, height: 62, marginBottom: 8,
        borderWidth: 1, borderColor: '#F3F4F6', opacity: 0.6,
      }} />
    ))}
  </View>
);

export default HomeScreen;

const mapLightStyle = [
  { elementType: 'geometry', stylers: [{ color: '#F0F1F5' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#FFFFFF' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5A6478' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#FFFFFF' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#E2E8F0' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#E8EBF0' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#CBD5E1' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#C9DCF0' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#D5EDDA' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#CBD5E1' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#475569' }] },
];
