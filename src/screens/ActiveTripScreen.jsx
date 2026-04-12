import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, Linking, Dimensions, TouchableOpacity, StatusBar, StyleSheet, Alert, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { useTripStore } from '../stores/tripStore';
import { useTrips } from '../hooks/useTrips';
import { useLocation } from '../hooks/useLocation';
import { useLocationStore } from '../stores/locationStore';
import { TripMap } from '../components/map/TripMap';
import { TRIP_STATUS, EMERGENCY_PHONE, DISPATCHER_PHONE } from '../utils/constants';
import { formatTimerMMSS, formatPrice, formatDistance, formatDuration } from '../utils/formatters';
import { getDirections } from '../services/googleMaps';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Max distance in meters to allow starting the trip
const PICKUP_PROXIMITY_METERS = 300;

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const ActiveTripScreen = () => {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef(null);
  const timerRef = useRef(null);
  const routeFetched = useRef(false);

  const { activeTrip, tripTimer, tripDistanceKm, setTripTimer, addTripDistance } = useTripStore();
  const { updateTripStatus } = useTrips();
  const { startTracking, stopTracking } = useLocation();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const heading = useLocationStore((s) => s.heading);
  const speed = useLocationStore((s) => s.speed);

  const [routePolyline, setRoutePolyline] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [showSummary, setShowSummary] = useState(false);
  const [completedTrip, setCompletedTrip] = useState(null);
  const [tariffInfo, setTariffInfo] = useState({ base: 0, perKm: 0, commission: 15 });

  const snapPoints = useMemo(() => ['32%', '60%'], []);

  // Fetch tariff for live price display
  useEffect(() => {
    const fetchTariff = async () => {
      try {
        const { supabase } = require('../services/supabase');
        const { data } = await supabase
          .from('settings')
          .select('key, value')
          .in('key', ['tariff_per_km', 'tariff_base', 'commission_percent']);
        const map = {};
        (data || []).forEach(r => { map[r.key] = parseFloat(r.value) || 0; });
        setTariffInfo({
          base: map.tariff_base || 0,
          perKm: map.tariff_per_km || 0,
          commission: map.commission_percent || 10,
        });
      } catch (e) {
        console.warn('Error fetching tariff:', e);
      }
    };
    fetchTariff();
  }, []);

  useEffect(() => {
    if (!activeTrip) {
      navigation.goBack();
      return;
    }
    startTracking(activeTrip.id);
    return () => {
      stopTracking();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeTrip?.id]);

  // Fetch route once
  useEffect(() => {
    if (!activeTrip || routeFetched.current) return;
    const fetchFullRoute = async () => {
      try {
        const origin = {
          lat: parseFloat(activeTrip.origin_lat),
          lng: parseFloat(activeTrip.origin_lng),
        };
        const destination = {
          lat: parseFloat(activeTrip.destination_lat),
          lng: parseFloat(activeTrip.destination_lng),
        };
        const result = await getDirections(origin, destination);
        setRoutePolyline(result.polyline);
        setRouteInfo({ distance: result.distance, duration: result.duration });
        routeFetched.current = true;
      } catch (error) {
        console.log('Error fetching route:', error);
      }
    };
    fetchFullRoute();
  }, [activeTrip?.id]);

  // Timer — only runs during IN_PROGRESS
  useEffect(() => {
    if (activeTrip?.status === TRIP_STATUS.IN_PROGRESS) {
      timerRef.current = setInterval(() => {
        const current = useTripStore.getState().tripTimer;
        setTripTimer(current + 1);
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [activeTrip?.status]);

  // Track distance from location updates
  useEffect(() => {
    if (currentLocation && activeTrip?.status === TRIP_STATUS.IN_PROGRESS) {
      addTripDistance(currentLocation);
    }
  }, [currentLocation]);

  // Live calculated price
  const livePrice = useMemo(() => {
    return Math.round(tariffInfo.base + tariffInfo.perKm * tripDistanceKm);
  }, [tripDistanceKm, tariffInfo]);

  const liveCommission = useMemo(() => {
    return Math.round(livePrice * tariffInfo.commission / 100);
  }, [livePrice, tariffInfo.commission]);

  // Distance to pickup point
  const distanceToPickup = useMemo(() => {
    if (!currentLocation || !activeTrip) return null;
    return haversineMeters(
      currentLocation.lat, currentLocation.lng,
      parseFloat(activeTrip.origin_lat), parseFloat(activeTrip.origin_lng)
    );
  }, [currentLocation, activeTrip?.origin_lat, activeTrip?.origin_lng]);

  const isNearPickup = distanceToPickup !== null && distanceToPickup <= PICKUP_PROXIMITY_METERS;

  const handleStartTrip = useCallback(async () => {
    if (!activeTrip) return;
    if (!isNearPickup) {
      const distText = distanceToPickup
        ? `Estás a ${Math.round(distanceToPickup)} metros del punto de recogida.`
        : 'No se pudo determinar tu ubicación.';
      Alert.alert(
        'Demasiado lejos',
        `${distText}\nDebes estar a menos de ${PICKUP_PROXIMITY_METERS}m del pasajero para iniciar el viaje.`,
      );
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return;
    }
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
  }, [activeTrip, isNearPickup, distanceToPickup]);

  const handleEndTrip = useCallback(async () => {
    if (!activeTrip) return;
    Alert.alert(
      'Finalizar viaje',
      `¿Confirmar fin del viaje?\n\nDistancia: ${formatDistance(tripDistanceKm)}\nTotal: ${formatPrice(livePrice)}`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Finalizar',
          style: 'destructive',
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            const result = await updateTripStatus(activeTrip.id, TRIP_STATUS.COMPLETED);
            if (result.success) {
              stopTracking();
              if (timerRef.current) clearInterval(timerRef.current);
              setCompletedTrip(result.data);
              setShowSummary(true);
            }
          },
        },
      ]
    );
  }, [activeTrip, tripDistanceKm, livePrice]);

  // ====== SUMMARY SCREEN ======
  if (showSummary && completedTrip) {
    const finalPrice = completedTrip.price || livePrice;
    const finalDistance = completedTrip.distance_km || tripDistanceKm;
    const finalDuration = completedTrip.duration_minutes || Math.round(tripTimer / 60);
    const commissionPct = tariffInfo.commission;
    const commissionAmount = Math.round(finalPrice * commissionPct / 100);
    const driverEarnings = finalPrice - commissionAmount;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar barStyle="light-content" />
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 30 }}>

          {/* Success Icon */}
          <View style={s.successIconWrap}>
            <View style={s.successIconCircle}>
              <MaterialCommunityIcons name="check-bold" size={40} color="#fff" />
            </View>
          </View>
          <Text style={s.summaryTitle}>¡Viaje completado!</Text>
          <Text style={s.summarySubtitle}>{completedTrip.passenger_name}</Text>

          {/* Route */}
          <View style={s.summaryCard}>
            <View style={s.summaryRoute}>
              <View style={s.routeIconCol}>
                <View style={[s.routeDot, { backgroundColor: colors.success }]} />
                <View style={s.routeLine} />
                <View style={[s.routeDot, { backgroundColor: colors.danger }]} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.summaryAddressLabel}>Origen</Text>
                <Text style={s.summaryRouteText} numberOfLines={2}>{completedTrip.origin_address}</Text>
                <View style={{ height: 14 }} />
                <Text style={s.summaryAddressLabel}>Destino</Text>
                <Text style={s.summaryRouteText} numberOfLines={2}>{completedTrip.destination_address}</Text>
              </View>
            </View>
          </View>

          {/* Stats Row */}
          <View style={s.summaryStatsRow}>
            <View style={s.summaryStat}>
              <MaterialCommunityIcons name="map-marker-distance" size={20} color={colors.info} />
              <Text style={s.summaryStatValue}>{formatDistance(finalDistance)}</Text>
              <Text style={s.summaryStatLabel}>Distancia</Text>
            </View>
            <View style={s.summaryStat}>
              <MaterialCommunityIcons name="clock-outline" size={20} color={colors.warning} />
              <Text style={s.summaryStatValue}>{formatDuration(finalDuration)}</Text>
              <Text style={s.summaryStatLabel}>Duración</Text>
            </View>
            <View style={s.summaryStat}>
              <MaterialCommunityIcons name="speedometer" size={20} color={colors.primary} />
              <Text style={s.summaryStatValue}>
                {finalDuration > 0 ? (finalDistance / (finalDuration / 60)).toFixed(0) : '0'} km/h
              </Text>
              <Text style={s.summaryStatLabel}>Promedio</Text>
            </View>
          </View>

          {/* ---- PRICE CARD (for passenger) ---- */}
          <View style={s.priceCard}>
            <View style={s.priceCardHeader}>
              <MaterialCommunityIcons name="receipt" size={18} color={colors.secondary} />
              <Text style={s.priceCardHeaderText}>Detalle del viaje</Text>
            </View>

            <View style={s.priceItemRow}>
              <Text style={s.priceItemLabel}>Tarifa base</Text>
              <Text style={s.priceItemValue}>{formatPrice(tariffInfo.base)}</Text>
            </View>
            <View style={s.priceItemRow}>
              <Text style={s.priceItemLabel}>{formatDistance(finalDistance)} × {formatPrice(tariffInfo.perKm)}/km</Text>
              <Text style={s.priceItemValue}>{formatPrice(Math.round(tariffInfo.perKm * finalDistance))}</Text>
            </View>

            <View style={s.priceTotalDivider} />

            <View style={s.priceTotalRow}>
              <Text style={s.priceTotalLabel}>Total a pagar</Text>
              <Text style={s.priceTotalValue}>{formatPrice(finalPrice)}</Text>
            </View>
          </View>

          {/* ---- DRIVER EARNINGS CARD ---- */}
          <View style={s.earningsCard}>
            <View style={s.earningsRow}>
              <View>
                <Text style={s.earningsLabel}>Tu ganancia</Text>
                <Text style={s.earningsSubLabel}>Comisión {commissionPct}%: -{formatPrice(commissionAmount)}</Text>
              </View>
              <Text style={s.earningsValue}>{formatPrice(driverEarnings)}</Text>
            </View>
          </View>

          <TouchableOpacity
            onPress={() => { setShowSummary(false); navigation.goBack(); }}
            style={s.summaryBtn}
          >
            <MaterialCommunityIcons name="home" size={20} color="#fff" />
            <Text style={s.summaryBtnText}>Volver al inicio</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    );
  }

  if (!activeTrip) return null;

  const isInProgress = activeTrip.status === TRIP_STATUS.IN_PROGRESS;
  const speedKmh = speed ? Math.round((speed < 0 ? 0 : speed) * 3.6) : 0;

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" translucent backgroundColor="transparent" />

      {/* Map */}
      <TripMap
        driverLocation={currentLocation}
        origin={{ lat: activeTrip.origin_lat, lng: activeTrip.origin_lng, address: activeTrip.origin_address }}
        destination={{ lat: activeTrip.destination_lat, lng: activeTrip.destination_lng, address: activeTrip.destination_address }}
        polyline={routePolyline}
        heading={heading}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Status pill */}
      <View style={[s.statusPill, { top: insets.top + 12 }]}>
        <View style={[s.statusDot, { backgroundColor: isInProgress ? colors.success : colors.primary }]} />
        <Text style={s.statusText}>
          {isInProgress ? 'Viaje en curso' : 'Dirígete al pasajero'}
        </Text>
      </View>

      {/* Speed + Timer + KM floating pills */}
      <View style={[s.chipRow, { top: insets.top + 52 }]}>
        {isInProgress ? (
          <>
            <View style={s.chip}>
              <Text style={s.chipValue}>{speedKmh}</Text>
              <Text style={s.chipLabel}>km/h</Text>
            </View>
            <View style={s.chip}>
              <MaterialCommunityIcons name="map-marker-distance" size={12} color={colors.info} />
              <Text style={[s.chipValue, { marginLeft: 4, fontSize: 16 }]}>
                {tripDistanceKm.toFixed(1)} km
              </Text>
            </View>
            <View style={s.chip}>
              <MaterialCommunityIcons name="timer-outline" size={12} color={colors.textMuted} />
              <Text style={[s.chipValue, { marginLeft: 4, fontSize: 16 }]}>{formatTimerMMSS(tripTimer)}</Text>
            </View>
          </>
        ) : (
          <View style={s.chip}>
            <Text style={s.chipValue}>{speedKmh}</Text>
            <Text style={s.chipLabel}>km/h</Text>
          </View>
        )}
      </View>

      {/* Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        snapPoints={snapPoints}
        backgroundStyle={s.sheetBg}
        handleIndicatorStyle={s.handle}
      >
        <BottomSheetScrollView contentContainerStyle={s.sheetContent} showsVerticalScrollIndicator={false}>

          {/* Passenger row */}
          <View style={s.passengerRow}>
            <View style={s.avatarCircle}>
              <Text style={s.avatarText}>
                {(activeTrip.passenger_name || '?').charAt(0).toUpperCase()}
              </Text>
            </View>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={s.nameText}>{activeTrip.passenger_name}</Text>
              {routeInfo && (
                <Text style={s.routeInfoText}>
                  {routeInfo.distance} · {routeInfo.duration}
                </Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {activeTrip.passenger_phone ? (
                <TouchableOpacity
                  style={s.iconBtn}
                  onPress={() => Linking.openURL(`tel:${activeTrip.passenger_phone}`)}
                >
                  <Ionicons name="call" size={18} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity
                style={s.iconBtn}
                onPress={() => Linking.openURL(`tel:${DISPATCHER_PHONE}`)}
              >
                <MaterialCommunityIcons name="headset" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Address cards */}
          <View style={s.addressCard}>
            <View style={s.addressRow}>
              <View style={[s.addressDot, { backgroundColor: colors.success }]} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.addressLabel}>Origen</Text>
                <Text style={s.addressText} numberOfLines={2}>{activeTrip.origin_address}</Text>
              </View>
            </View>
            <View style={s.addressDividerLine} />
            <View style={s.addressRow}>
              <View style={[s.addressDot, { backgroundColor: colors.danger }]} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={s.addressLabel}>Destino</Text>
                <Text style={s.addressText} numberOfLines={2}>{activeTrip.destination_address}</Text>
              </View>
            </View>
          </View>

          {/* Live price — only during trip */}
          {isInProgress && (
            <View style={s.livePriceCard}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                <View>
                  <Text style={s.livePriceLabel}>Estimado en vivo</Text>
                  <Text style={s.livePriceSubLabel}>{formatDistance(tripDistanceKm)} recorridos</Text>
                </View>
                <Text style={s.livePriceValue}>{formatPrice(livePrice)}</Text>
              </View>
            </View>
          )}

          {/* Distance to pickup hint */}
          {!isInProgress && distanceToPickup !== null && (
            <View style={[s.proximityHint, isNearPickup ? s.proximityNear : s.proximityFar]}>
              <MaterialCommunityIcons
                name={isNearPickup ? 'check-circle' : 'map-marker-radius'}
                size={16}
                color={isNearPickup ? colors.success : colors.warning}
              />
              <Text style={[s.proximityText, { color: isNearPickup ? colors.success : colors.warning }]}>
                {isNearPickup
                  ? 'Estás cerca del pasajero'
                  : `A ${Math.round(distanceToPickup)}m del punto de recogida`}
              </Text>
            </View>
          )}

          {/* Action Button */}
          {!isInProgress ? (
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: isNearPickup ? colors.success : colors.surfaceLight }]}
              onPress={handleStartTrip}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="account-check" size={22} color={isNearPickup ? '#fff' : colors.textMuted} />
              <Text style={[s.actionBtnText, !isNearPickup && { color: colors.textMuted }]}>Iniciar viaje</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[s.actionBtn, { backgroundColor: colors.danger }]}
              onPress={handleEndTrip}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="flag-checkered" size={22} color="#fff" />
              <Text style={s.actionBtnText}>Finalizar viaje</Text>
            </TouchableOpacity>
          )}

          {/* SOS */}
          <TouchableOpacity
            style={s.sosBtn}
            onPress={() => Linking.openURL(`tel:${EMERGENCY_PHONE}`)}
          >
            <Ionicons name="warning" size={14} color={colors.danger} />
            <Text style={s.sosBtnText}>Emergencia</Text>
          </TouchableOpacity>

        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
};

/* ── styles ── */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },

  // ── Summary Screen ──
  successIconWrap: { alignItems: 'center', marginBottom: 16 },
  successIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.success, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  summaryTitle: {
    color: colors.text, fontSize: 22, fontFamily: 'Inter_700Bold',
    textAlign: 'center', marginBottom: 4,
  },
  summarySubtitle: {
    color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium',
    textAlign: 'center', marginBottom: 20,
  },
  summaryCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 16,
    marginBottom: 12, borderWidth: 1, borderColor: colors.border,
  },
  summaryRoute: { flexDirection: 'row' },
  routeIconCol: { alignItems: 'center', width: 20, marginRight: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 3 },
  summaryAddressLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryRouteText: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  summaryStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryStat: {
    flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14,
    alignItems: 'center', borderWidth: 1, borderColor: colors.border,
  },
  summaryStatValue: { color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 4 },
  summaryStatLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 2 },

  // ── Price Card (passenger-facing) ──
  priceCard: {
    backgroundColor: colors.surface, borderRadius: 16, padding: 18,
    marginBottom: 10, borderWidth: 1, borderColor: colors.border,
  },
  priceCardHeader: {
    flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8,
  },
  priceCardHeaderText: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  priceItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  priceItemLabel: { color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular' },
  priceItemValue: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium' },
  priceTotalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  priceTotalRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  priceTotalLabel: { color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold' },
  priceTotalValue: { color: colors.secondary, fontSize: 28, fontFamily: 'Inter_700Bold' },

  // ── Earnings Card ──
  earningsCard: {
    backgroundColor: `${colors.success}10`, borderRadius: 16, padding: 16,
    marginBottom: 16, borderWidth: 1.5, borderColor: `${colors.success}30`,
  },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  earningsLabel: { color: colors.success, fontSize: 14, fontFamily: 'Inter_700Bold' },
  earningsSubLabel: { color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  earningsValue: { color: colors.success, fontSize: 24, fontFamily: 'Inter_700Bold' },

  summaryBtn: {
    backgroundColor: colors.primary, borderRadius: 14,
    paddingVertical: 16, alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row', gap: 8,
  },
  summaryBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_600SemiBold' },

  // ── Active Trip Screen ──
  statusPill: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(26,26,46,0.88)', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { color: '#fff', fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  chipRow: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(26,26,46,0.85)', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6,
  },
  chipValue: { color: '#fff', fontSize: 18, fontFamily: 'Inter_700Bold' },
  chipLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginLeft: 4 },
  sheetBg: {
    backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderColor: colors.border,
  },
  handle: { backgroundColor: colors.textMuted, width: 32, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 4 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarCircle: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center',
  },
  avatarText: { color: '#fff', fontSize: 18, fontFamily: 'Inter_700Bold' },
  nameText: { color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  routeInfoText: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  iconBtn: {
    width: 38, height: 38, borderRadius: 19,
    borderWidth: 1, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  addressCard: {
    backgroundColor: colors.background, borderRadius: 14, padding: 14, marginBottom: 14,
  },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start' },
  addressDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  addressLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  addressText: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  addressDividerLine: {
    width: 1, height: 16, backgroundColor: colors.border, marginLeft: 4.5, marginVertical: 4,
  },
  livePriceCard: {
    backgroundColor: `${colors.secondary}10`, borderRadius: 14, padding: 14,
    marginBottom: 14, borderWidth: 1, borderColor: `${colors.secondary}30`,
  },
  livePriceLabel: { color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  livePriceSubLabel: { color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  livePriceValue: { color: colors.secondary, fontSize: 24, fontFamily: 'Inter_700Bold' },
  proximityHint: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
  },
  proximityNear: { backgroundColor: `${colors.success}12`, borderWidth: 1, borderColor: `${colors.success}30` },
  proximityFar: { backgroundColor: `${colors.warning}10`, borderWidth: 1, borderColor: `${colors.warning}25` },
  proximityText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  actionBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16, borderRadius: 14, gap: 10, marginBottom: 12,
  },
  actionBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  sosBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10,
  },
  sosBtnText: { color: colors.danger, fontSize: 13, fontFamily: 'Inter_500Medium' },
});

export default ActiveTripScreen;
