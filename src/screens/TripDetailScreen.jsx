import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, Dimensions, Pressable, StatusBar } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRoute, useNavigation } from '@react-navigation/native';
import MapLibreGL from '../lib/maplibre';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { colors } from '../theme/colors';
import { Badge } from '../components/ui/Badge';
import { supabase } from '../services/supabase';
import { formatDateTime, formatPrice, formatDistance, formatDuration } from '../utils/formatters';
import { getRegionForCoordinates } from '../utils/mapHelpers';
import { MAPLIBRE_STYLE } from '../utils/mapProvider';
import { MapRouteLayers } from '../components/map/MapRouteLayers';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

const TripDetailScreen = () => {
  const insets = useSafeAreaInsets();
  const route = useRoute();
  const navigation = useNavigation();
  const { tripId } = route.params;
  const [trip, setTrip] = useState(null);
  const [trackingPoints, setTrackingPoints] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTripDetail();
  }, [tripId]);

  const fetchTripDetail = async () => {
    try {
      const { data: tripData, error: tripError } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single();
      if (tripError) throw tripError;
      setTrip(tripData);
      const { data: tracking } = await supabase
        .from('trip_tracking')
        .select('lat, lng')
        .eq('trip_id', tripId)
        .order('recorded_at', { ascending: true });
      if (tracking) {
        setTrackingPoints(
          tracking.map((p) => ({ latitude: Number(p.lat), longitude: Number(p.lng) }))
        );
      }
    } catch (error) {
      console.error('Error cargando detalle:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading || !trip) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' }}>
        <Text style={{ color: colors.textMuted, fontFamily: 'Inter_500Medium' }}>Cargando...</Text>
      </View>
    );
  }

  const mapPoints = [];
  if (trip.origin_lat != null && trip.origin_lng != null) {
    mapPoints.push({ latitude: Number(trip.origin_lat), longitude: Number(trip.origin_lng) });
  }
  if (trip.destination_lat != null && trip.destination_lng != null) {
    mapPoints.push({ latitude: Number(trip.destination_lat), longitude: Number(trip.destination_lng) });
  }
  const region = getRegionForCoordinates(mapPoints.length > 0 ? mapPoints : undefined);

  const sc = {
    completed: colors.success, cancelled: colors.danger, in_progress: colors.primary,
    pending: colors.warning, accepted: colors.info,
  };
  const statusColor = sc[trip.status] || colors.textMuted;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <ScrollView contentContainerStyle={{ paddingBottom: 30 }} showsVerticalScrollIndicator={false}>
        {/* Map */}
        <View style={{ height: 230 }}>
          <MapLibreGL.MapView
            style={{ flex: 1 }}
            mapStyle={MAPLIBRE_STYLE}
            scrollEnabled={false}
            zoomEnabled={false}
            rotateEnabled={false}
            pitchEnabled={false}
            compassEnabled={false}
            logoEnabled={false}
            attributionEnabled={false}
          >
            <MapLibreGL.Camera
              defaultSettings={{
                centerCoordinate: [region.longitude, region.latitude],
                zoomLevel: 13,
              }}
            />
            {trip.origin_lat ? (
              <MapLibreGL.PointAnnotation
                id="trip-origin"
                coordinate={[Number(trip.origin_lng), Number(trip.origin_lat)]}
              >
                <View style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#fff',
                }}>
                  <MaterialCommunityIcons name="map-marker" size={14} color="#fff" />
                </View>
              </MapLibreGL.PointAnnotation>
            ) : null}
            {trip.destination_lat ? (
              <MapLibreGL.PointAnnotation
                id="trip-dest"
                coordinate={[Number(trip.destination_lng), Number(trip.destination_lat)]}
              >
                <View style={{
                  width: 28, height: 28, borderRadius: 14,
                  backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center',
                  borderWidth: 2, borderColor: '#fff',
                }}>
                  <MaterialCommunityIcons name="flag-checkered" size={14} color="#fff" />
                </View>
              </MapLibreGL.PointAnnotation>
            ) : null}
            {trackingPoints.length > 1 && (
              <MapRouteLayers coords={trackingPoints} />
            )}
          </MapLibreGL.MapView>

          {/* Gradient overlays */}
          <LinearGradient
            colors={['rgba(15,15,26,0.7)', 'transparent']}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, height: insets.top + 50 }}
          />
          <LinearGradient
            colors={['transparent', colors.background]}
            style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 40 }}
          />

          {/* Back button */}
          <Pressable onPress={() => navigation.goBack()} style={{
            position: 'absolute', top: insets.top + 8, left: 16,
            width: 38, height: 38, borderRadius: 19,
            backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: '#E2E8F0',
            elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
            shadowOpacity: 0.08, shadowRadius: 4,
          }}>
            <Ionicons name="arrow-back" size={20} color={colors.secondary} />
          </Pressable>
        </View>

        <View style={{ paddingHorizontal: 16 }}>
          {/* Status & Date */}
          <Animated.View entering={FadeInDown.delay(80).duration(400)}
            style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <Badge status={trip.status} size="md" />
            <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
              {formatDateTime(trip.created_at)}
            </Text>
          </Animated.View>

          {/* Route card */}
          <Animated.View entering={FadeInDown.delay(140).duration(400)}>
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: colors.border, marginBottom: 12,
            }}>
              {/* Passenger */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <View style={{
                  width: 36, height: 36, borderRadius: 12,
                  backgroundColor: `${colors.primary}12`, alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="account" size={18} color={colors.primary} />
                </View>
                <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold', marginLeft: 10 }}>
                  {trip.passenger_name}
                </Text>
              </View>

              {/* Route */}
              <View style={{ flexDirection: 'row' }}>
                <View style={{ alignItems: 'center', width: 20, marginRight: 10, paddingTop: 2 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.success }} />
                  <View style={{ width: 1.5, flex: 1, backgroundColor: colors.border, marginVertical: 4 }} />
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger }} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ marginBottom: 14 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium' }}>ORIGEN</Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                      {trip.origin_address}
                    </Text>
                  </View>
                  <View>
                    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium' }}>DESTINO</Text>
                    <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                      {trip.destination_address}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          </Animated.View>

          {/* Stats row */}
          <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
            <StatBox icon="map-marker-distance" label="Distancia" value={formatDistance(trip.distance_km)} color={colors.info} />
            <StatBox icon="clock-outline" label="Duración" value={formatDuration(trip.duration_minutes)} color={colors.warning} />
            <StatBox icon="cash" label="Precio" value={formatPrice(trip.price)} color={colors.secondary} />
          </Animated.View>

          {/* Notes */}
          {trip.notes && (() => {
            const cleanNotes = trip.notes
              .replace(/\[APPROACH_ONLY\]/gi, '')
              .replace(/\[FINAL_DEST_JSON:[^\]]*\]/g, '')
              .replace(/\[CATASTRAL\]\s*/g, '📍 Catastral: ')
              .replace(/\[INDICACIONES_PASAJERO\]\s*/g, '💬 Pasajero: ')
              .replace(/ {2,}/g, ' ')
              .trim();
            if (!cleanNotes) return null;
            return (
              <Animated.View entering={FadeInDown.delay(260).duration(400)}>
                <View style={{
                  backgroundColor: colors.surface, borderRadius: 16, padding: 16,
                  borderWidth: 1, borderColor: colors.border, marginBottom: 12,
                }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium', marginBottom: 6 }}>INDICACIONES</Text>
                  <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_400Regular', lineHeight: 20 }}>{cleanNotes}</Text>
                </View>
              </Animated.View>
            );
          })()}

          {/* Timestamps */}
          <Animated.View entering={FadeInDown.delay(320).duration(400)}>
            <View style={{
              backgroundColor: colors.surface, borderRadius: 16, padding: 16,
              borderWidth: 1, borderColor: colors.border,
            }}>
              <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 12 }}>
                Tiempos
              </Text>
              {[
                { label: 'Asignado', time: trip.assigned_at, icon: 'bell-outline' },
                { label: 'Aceptado', time: trip.accepted_at, icon: 'check' },
                { label: 'Recogida', time: trip.pickup_at, icon: 'account-check' },
                { label: 'Iniciado', time: trip.started_at, icon: 'play' },
                { label: 'Completado', time: trip.completed_at, icon: 'flag-checkered' },
              ]
                .filter((t) => t.time)
                .map((t, i) => (
                  <View key={t.label} style={{
                    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
                    paddingVertical: 8,
                    borderTopWidth: i > 0 ? 1 : 0, borderTopColor: colors.border,
                  }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <MaterialCommunityIcons name={t.icon} size={14} color={colors.textMuted} style={{ marginRight: 8 }} />
                      <Text style={{ color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' }}>{t.label}</Text>
                    </View>
                    <Text style={{ color: colors.text, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                      {formatDateTime(t.time)}
                    </Text>
                  </View>
                ))}
            </View>
          </Animated.View>
        </View>
      </ScrollView>
    </View>
  );
};

const StatBox = ({ icon, label, value, color }) => (
  <View style={{
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  }}>
    <MaterialCommunityIcons name={icon} size={18} color={color} style={{ marginBottom: 4 }} />
    <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' }}>{value}</Text>
    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_400Regular', marginTop: 2 }}>{label}</Text>
  </View>
);

export default TripDetailScreen;
