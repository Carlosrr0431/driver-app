import React, { useEffect, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, Dimensions, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker, Circle } from 'react-native-maps';
import { colors } from '../theme/colors';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { useTrips } from '../hooks/useTrips';
import { useRealtime } from '../hooks/useRealtime';
import { useLocation } from '../hooks/useLocation';
import { Avatar } from '../components/ui/Avatar';
import { Card } from '../components/ui/Card';
import { Skeleton } from '../components/ui/Skeleton';
import { StatusToggle } from '../components/driver/StatusToggle';
import { StatsCard } from '../components/driver/StatsCard';
import { TripCard } from '../components/trip/TripCard';
import { NewTripModal } from '../components/trip/NewTripModal';
import { formatPrice, formatDistance } from '../utils/formatters';
import { DEFAULT_REGION } from '../utils/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const MAP_HEIGHT = 220;

const HomeScreen = () => {
  const navigation = useNavigation();
  const { driver } = useAuthStore();
  const { pendingTrip, showNewTripModal, activeTrip } = useTripStore();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const { useTodayStats, useActiveTrip, acceptTrip, rejectTrip, useTripHistory } = useTrips();
  const { subscribeToNewTrips, subscribeToMessages } = useRealtime();
  const { requestPermissions, getCurrentPosition } = useLocation();
  const mapRef = useRef(null);

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useTodayStats();
  const { data: activeTripData } = useActiveTrip();
  const { data: todayTrips, isLoading: tripsLoading, refetch: refetchTrips } = useTripHistory('today');

  const [refreshing, setRefreshing] = React.useState(false);

  useEffect(() => {
    const init = async () => {
      await requestPermissions();
      getCurrentPosition();
    };
    init();
    subscribeToNewTrips();
    subscribeToMessages();
  }, []);

  // Centrar mapa cuando cambia la ubicación
  useEffect(() => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion(
        {
          latitude: currentLocation.lat,
          longitude: currentLocation.lng,
          latitudeDelta: 0.008,
          longitudeDelta: 0.008,
        },
        800
      );
    }
  }, [currentLocation]);

  useEffect(() => {
    if (activeTripData) {
      navigation.navigate('ActiveTrip');
    }
  }, [activeTripData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStats(), refetchTrips()]);
    setRefreshing(false);
  }, []);

  const handleAcceptTrip = async (tripId) => {
    const result = await acceptTrip(tripId);
    if (result.success) {
      navigation.navigate('ActiveTrip');
    }
  };

  const handleRejectTrip = async (tripId, reason) => {
    await rejectTrip(tripId, reason);
  };

  const allTrips = todayTrips?.pages?.flatMap((page) => page.data) || [];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ padding: 20 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
            colors={[colors.primary]}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(600)}
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 24,
          }}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Avatar
              uri={driver?.photo_url}
              name={driver?.full_name}
              size={48}
              showOnline
              isOnline={driver?.is_available}
            />
            <View style={{ marginLeft: 12 }}>
              <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular' }}>
                Hola, 👋
              </Text>
              <Text style={{ color: colors.text, fontSize: 18, fontFamily: 'Inter_700Bold' }}>
                {driver?.full_name || 'Chofer'}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            style={{
              width: 44,
              height: 44,
              borderRadius: 22,
              backgroundColor: colors.surface,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1,
              borderColor: colors.border,
            }}
          >
            <Ionicons name="notifications-outline" size={22} color={colors.text} />
            {/* Badge */}
            <View
              style={{
                position: 'absolute',
                top: 8,
                right: 8,
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: colors.danger,
              }}
            />
          </TouchableOpacity>
        </Animated.View>

        {/* Status Toggle */}
        <Animated.View entering={FadeInDown.delay(200).springify()} style={{ marginBottom: 24 }}>
          <StatusToggle
            isOnline={driver?.is_available || false}
          />
        </Animated.View>

        {/* Mapa con ubicación del chofer */}
        <Animated.View entering={FadeInDown.delay(250).springify()} style={{ marginBottom: 24 }}>
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontFamily: 'Inter_600SemiBold',
              marginBottom: 12,
            }}
          >
            📍 Tu ubicación
          </Text>
          <View
            style={{
              borderRadius: 16,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: colors.border,
              height: MAP_HEIGHT,
            }}
          >
            <MapView
              ref={mapRef}
              style={{ width: '100%', height: '100%' }}
              initialRegion={
                currentLocation
                  ? {
                      latitude: currentLocation.lat,
                      longitude: currentLocation.lng,
                      latitudeDelta: 0.008,
                      longitudeDelta: 0.008,
                    }
                  : DEFAULT_REGION
              }
              showsUserLocation={false}
              showsMyLocationButton={false}
              showsCompass={false}
              customMapStyle={mapDarkStyle}
            >
              {currentLocation && (
                <>
                  {/* Círculo de área */}
                  <Circle
                    center={{
                      latitude: currentLocation.lat,
                      longitude: currentLocation.lng,
                    }}
                    radius={200}
                    fillColor="rgba(108, 99, 255, 0.08)"
                    strokeColor="rgba(108, 99, 255, 0.25)"
                    strokeWidth={1}
                  />
                  {/* Marcador del chofer */}
                  <Marker
                    coordinate={{
                      latitude: currentLocation.lat,
                      longitude: currentLocation.lng,
                    }}
                    anchor={{ x: 0.5, y: 0.5 }}
                  >
                    <View style={{ alignItems: 'center' }}>
                      <View
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: colors.primary,
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderWidth: 3,
                          borderColor: '#fff',
                          elevation: 6,
                          shadowColor: colors.primary,
                          shadowOffset: { width: 0, height: 2 },
                          shadowOpacity: 0.4,
                          shadowRadius: 4,
                        }}
                      >
                        <MaterialCommunityIcons name="car" size={22} color="#fff" />
                      </View>
                      {/* Pulso */}
                      <View
                        style={{
                          position: 'absolute',
                          width: 56,
                          height: 56,
                          borderRadius: 28,
                          backgroundColor: 'rgba(108, 99, 255, 0.15)',
                          top: -6,
                        }}
                      />
                    </View>
                  </Marker>
                </>
              )}
            </MapView>

            {/* Botón re-centrar */}
            <TouchableOpacity
              onPress={() => {
                if (currentLocation && mapRef.current) {
                  mapRef.current.animateToRegion(
                    {
                      latitude: currentLocation.lat,
                      longitude: currentLocation.lng,
                      latitudeDelta: 0.008,
                      longitudeDelta: 0.008,
                    },
                    600
                  );
                }
              }}
              style={{
                position: 'absolute',
                bottom: 12,
                right: 12,
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: colors.surface,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: colors.border,
                elevation: 4,
                shadowColor: '#000',
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 3,
              }}
            >
              <Ionicons name="locate" size={20} color={colors.primary} />
            </TouchableOpacity>

            {/* Overlay de estado */}
            <View
              style={{
                position: 'absolute',
                top: 12,
                left: 12,
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: driver?.is_available ? 'rgba(46, 204, 113, 0.9)' : 'rgba(99, 110, 114, 0.9)',
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 20,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: '#fff',
                  marginRight: 6,
                }}
              />
              <Text style={{ color: '#fff', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>
                {driver?.is_available ? 'En línea' : 'Desconectado'}
              </Text>
            </View>
          </View>
        </Animated.View>

        {/* Stats Grid */}
        <Animated.View entering={FadeInDown.delay(300).springify()}>
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontFamily: 'Inter_600SemiBold',
              marginBottom: 12,
            }}
          >
            📊 Estadísticas de hoy
          </Text>

          {statsLoading ? (
            <Skeleton type="stats" />
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <StatsCard
                icon="🚗"
                label="Viajes completados"
                value={stats?.totalTrips || 0}
                color={colors.primary}
                index={0}
              />
              <StatsCard
                icon="📍"
                label="Kilómetros recorridos"
                value={formatDistance(stats?.totalKm)}
                color={colors.info}
                index={1}
              />
              <StatsCard
                icon="⏱"
                label="Horas activo"
                value={`${stats?.totalHours || 0}h`}
                color={colors.warning}
                index={2}
              />
              <StatsCard
                icon="💰"
                label="Ganancia del día"
                value={formatPrice(stats?.totalEarnings)}
                color={colors.secondary}
                index={3}
              />
            </View>
          )}
        </Animated.View>

        {/* Active Trip Card */}
        {activeTrip && (
          <Animated.View entering={FadeInDown.delay(400).springify()} style={{ marginBottom: 16 }}>
            <Text
              style={{
                color: colors.text,
                fontSize: 17,
                fontFamily: 'Inter_600SemiBold',
                marginBottom: 12,
              }}
            >
              🚀 Viaje en curso
            </Text>
            <TouchableOpacity onPress={() => navigation.navigate('ActiveTrip')}>
              <Card style={{ borderColor: colors.primary, borderWidth: 2 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                  <MaterialCommunityIcons name="account" size={18} color={colors.primary} />
                  <Text
                    style={{
                      color: colors.text,
                      fontSize: 15,
                      fontFamily: 'Inter_600SemiBold',
                      marginLeft: 8,
                    }}
                  >
                    {activeTrip.passenger_name}
                  </Text>
                </View>
                <Text style={{ color: colors.textMuted, fontSize: 13 }}>
                  📍 {activeTrip.destination_address}
                </Text>
              </Card>
            </TouchableOpacity>
          </Animated.View>
        )}

        {/* Today's Trips */}
        <Animated.View entering={FadeInDown.delay(500).springify()}>
          <Text
            style={{
              color: colors.text,
              fontSize: 17,
              fontFamily: 'Inter_600SemiBold',
              marginBottom: 12,
            }}
          >
            📋 Viajes de hoy
          </Text>

          {tripsLoading ? (
            <Skeleton type="list" />
          ) : allTrips.length > 0 ? (
            allTrips.map((trip) => (
              <TripCard
                key={trip.id}
                trip={trip}
                onPress={() => navigation.navigate('TripDetail', { tripId: trip.id })}
              />
            ))
          ) : (
            <Card>
              <Text
                style={{
                  color: colors.textMuted,
                  fontSize: 14,
                  fontFamily: 'Inter_400Regular',
                  textAlign: 'center',
                  paddingVertical: 20,
                }}
              >
                Sin viajes completados hoy
              </Text>
            </Card>
          )}
        </Animated.View>
      </ScrollView>

      {/* New Trip Modal */}
      <NewTripModal
        visible={showNewTripModal}
        trip={pendingTrip}
        onAccept={handleAcceptTrip}
        onReject={handleRejectTrip}
      />
    </SafeAreaView>
  );
};

export default HomeScreen;

const mapDarkStyle = [
  { elementType: 'geometry', stylers: [{ color: '#1d1d35' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1d1d35' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#8a8ab5' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2a4a' }] },
  { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#333366' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3c3c6e' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0e0e2a' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#1a2a1a' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#333366' }] },
];
