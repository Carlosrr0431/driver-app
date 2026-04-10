import React, { useEffect, useCallback, useRef, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Dimensions,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, SlideInRight } from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker, Circle } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { useTrips } from '../hooks/useTrips';
import { useRealtime } from '../hooks/useRealtime';
import { useLocation } from '../hooks/useLocation';
import { supabase } from '../services/supabase';
import { NewTripModal } from '../components/trip/NewTripModal';
import { formatPrice, formatDistance } from '../utils/formatters';
import { DEFAULT_REGION } from '../utils/constants';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { driver, updateDriver } = useAuthStore();
  const { pendingTrip, showNewTripModal, activeTrip } = useTripStore();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const { useTodayStats, useActiveTrip, acceptTrip, rejectTrip, useTripHistory } = useTrips();
  const { subscribeToNewTrips, subscribeToMessages } = useRealtime();
  const { requestPermissions, getCurrentPosition } = useLocation();
  const mapRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);

  const { data: stats, refetch: refetchStats } = useTodayStats();
  const { data: activeTripData } = useActiveTrip();
  const { data: todayTrips, isLoading: tripsLoading, refetch: refetchTrips } = useTripHistory('today');

  const isOnline = driver?.is_available || false;

  useEffect(() => {
    const init = async () => {
      await requestPermissions();
      getCurrentPosition();
    };
    init();
    subscribeToNewTrips();
    subscribeToMessages();
  }, []);

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
    try {
      const { error } = await supabase.from('drivers').update({ is_available: newStatus }).eq('id', driver.id);
      if (error) throw error;
      updateDriver({ is_available: newStatus });
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
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* ========== MAPA ========== */}
      <View style={{ height: SCREEN_HEIGHT * 0.40 }}>
        <MapView
          ref={mapRef}
          style={{ flex: 1 }}
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
          customMapStyle={mapDarkStyle}
        >
          {currentLocation && (
            <>
              <Circle
                center={{ latitude: currentLocation.lat, longitude: currentLocation.lng }}
                radius={250}
                fillColor="rgba(108,99,255,0.06)"
                strokeColor="rgba(108,99,255,0.15)"
                strokeWidth={1}
              />
              <Marker
                coordinate={{ latitude: currentLocation.lat, longitude: currentLocation.lng }}
                anchor={{ x: 0.5, y: 0.5 }}
              >
                <View style={{ alignItems: 'center', justifyContent: 'center' }}>
                  <View style={{
                    position: 'absolute', width: 60, height: 60, borderRadius: 30,
                    backgroundColor: 'rgba(108,99,255,0.12)',
                  }} />
                  <View style={{
                    width: 46, height: 46, borderRadius: 23,
                    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
                    borderWidth: 3, borderColor: '#fff',
                    elevation: 8, shadowColor: colors.primary,
                    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 8,
                  }}>
                    <MaterialCommunityIcons name="car-sport" size={24} color="#fff" />
                  </View>
                </View>
              </Marker>
            </>
          )}
        </MapView>

        {/* Gradiente superior */}
        <LinearGradient
          colors={['rgba(15,15,26,0.85)', 'transparent']}
          style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 56 }}
        />
        {/* Gradiente inferior */}
        <LinearGradient
          colors={['transparent', colors.background]}
          style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40 }}
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
              alignItems: 'center', justifyContent: 'center',
            }}>
              <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_700Bold' }}>{initials}</Text>
            </View>
            <View style={{ marginLeft: 10 }}>
              <Text style={{ color: '#ffffffcc', fontSize: 12, fontFamily: 'Inter_400Regular' }}>
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
            backgroundColor: 'rgba(26,26,46,0.85)', alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
          }}>
            <Ionicons name="notifications-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Botón recentrar */}
        <TouchableOpacity onPress={recenter} style={{
          position: 'absolute', bottom: 52, right: 16,
          width: 42, height: 42, borderRadius: 21,
          backgroundColor: 'rgba(26,26,46,0.9)', alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
          elevation: 6,
        }}>
          <Ionicons name="locate" size={20} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* ========== PANEL INFERIOR ========== */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 20 }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
            tintColor={colors.primary} colors={[colors.primary]} />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Toggle estado */}
        <Animated.View entering={FadeInUp.delay(80).duration(400)}>
          <TouchableOpacity onPress={handleToggleStatus} activeOpacity={0.85}
            style={{
              flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              backgroundColor: isOnline ? `${colors.success}10` : colors.surface,
              borderRadius: 16, padding: 16,
              borderWidth: 1.5, borderColor: isOnline ? `${colors.success}35` : colors.border,
            }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
              <View style={{
                width: 46, height: 46, borderRadius: 23,
                backgroundColor: isOnline ? `${colors.success}18` : `${colors.offline}12`,
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons
                  name={isOnline ? 'power' : 'power-off'}
                  size={24} color={isOnline ? colors.success : colors.offline}
                />
              </View>
              <View style={{ marginLeft: 14, flex: 1 }}>
                <Text style={{
                  color: isOnline ? colors.success : colors.textMuted,
                  fontSize: 15, fontFamily: 'Inter_700Bold',
                }}>
                  {isOnline ? 'Estás en línea' : 'Estás desconectado'}
                </Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
                  {isOnline ? 'Recibiendo viajes' : 'Toca para conectarte'}
                </Text>
              </View>
            </View>
            <View style={{
              width: 50, height: 28, borderRadius: 14,
              backgroundColor: isOnline ? colors.success : colors.surfaceLight,
              justifyContent: 'center', paddingHorizontal: 3,
            }}>
              <View style={{
                width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff',
                alignSelf: isOnline ? 'flex-end' : 'flex-start',
                elevation: 2,
              }} />
            </View>
          </TouchableOpacity>
        </Animated.View>

        {/* Stats */}
        <Animated.View entering={FadeInUp.delay(160).duration(400)} style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <MiniStat icon="car-side" label="Viajes" value={String(stats?.totalTrips || 0)} color={colors.primary} />
            <MiniStat icon="map-marker-distance" label="Distancia" value={formatDistance(stats?.totalKm)} color={colors.info} />
            <MiniStat icon="clock-outline" label="Horas" value={`${stats?.totalHours || 0}h`} color={colors.warning} />
            <MiniStat icon="cash" label="Ganancia" value={formatPrice(stats?.totalEarnings)} color={colors.secondary} />
          </View>
        </Animated.View>

        {/* Viaje activo */}
        {activeTrip && (
          <Animated.View entering={SlideInRight.delay(200).springify()} style={{ marginTop: 14 }}>
            <TouchableOpacity onPress={() => navigation.navigate('ActiveTrip')} activeOpacity={0.8}
              style={{
                backgroundColor: `${colors.primary}12`, borderRadius: 16, padding: 16,
                borderWidth: 1.5, borderColor: colors.primary,
                flexDirection: 'row', alignItems: 'center',
              }}>
              <View style={{
                width: 42, height: 42, borderRadius: 21,
                backgroundColor: `${colors.primary}20`, alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name="navigation" size={20} color={colors.primary} />
              </View>
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>Viaje en curso</Text>
                <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>
                  {activeTrip.destination_address}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.primary} />
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Actividad reciente */}
        <Animated.View entering={FadeInUp.delay(280).duration(400)} style={{ marginTop: 18 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
              Actividad reciente
            </Text>
            {allTrips.length > 0 && (
              <TouchableOpacity onPress={() => navigation.navigate('History')}>
                <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_500Medium' }}>Ver todo</Text>
              </TouchableOpacity>
            )}
          </View>

          {tripsLoading ? (
            <SkeletonTrips />
          ) : allTrips.length > 0 ? (
            allTrips.slice(0, 3).map((trip, idx) => (
              <Animated.View key={trip.id} entering={FadeInUp.delay(320 + idx * 60).duration(350)}>
                <TripRow trip={trip} onPress={() => navigation.navigate('TripDetail', { tripId: trip.id })} />
              </Animated.View>
            ))
          ) : (
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 28,
              alignItems: 'center', borderWidth: 1, borderColor: colors.border,
            }}>
              <MaterialCommunityIcons name="car-off" size={36} color={colors.textMuted} style={{ marginBottom: 8 }} />
              <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                Sin viajes hoy
              </Text>
              <Text style={{ color: colors.textDark, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 4, textAlign: 'center' }}>
                {isOnline ? 'Esperando asignaciones...' : 'Conectate para recibir viajes'}
              </Text>
            </View>
          )}
        </Animated.View>
      </ScrollView>

      <NewTripModal
        visible={showNewTripModal}
        trip={pendingTrip}
        onAccept={(id) => acceptTrip(id).then(r => r.success && navigation.navigate('ActiveTrip'))}
        onReject={handleRejectTrip}
      />
    </View>
  );
};

/* ========== COMPONENTES ========== */

const MiniStat = ({ icon, label, value, color }) => (
  <View style={{
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 12,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  }}>
    <MaterialCommunityIcons name={icon} size={18} color={color} style={{ marginBottom: 4 }} />
    <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_700Bold' }}>{value}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 9, fontFamily: 'Inter_500Medium', marginTop: 2 }}>{label}</Text>
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
      backgroundColor: colors.surface, borderRadius: 14, padding: 12, marginBottom: 8,
      borderWidth: 1, borderColor: colors.border,
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
        <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
          {trip.destination_address || 'Viaje'}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 1 }}>
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
        backgroundColor: colors.surface, borderRadius: 14, height: 62, marginBottom: 8,
        borderWidth: 1, borderColor: colors.border, opacity: 0.5,
      }} />
    ))}
  </View>
);

export default HomeScreen;

const mapDarkStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1a2e' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6a6a9a' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#252540' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#2d2d50' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#2f2f55' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#3a3a60' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0d0d22' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#162016' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#2d2d50' }] },
  { featureType: 'administrative.locality', elementType: 'labels.text.fill', stylers: [{ color: '#8888bb' }] },
];
