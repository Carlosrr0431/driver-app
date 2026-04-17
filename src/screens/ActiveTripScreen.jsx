import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, Linking, Dimensions, TouchableOpacity, StatusBar, StyleSheet, Alert, ScrollView, ActivityIndicator } from 'react-native';
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
import { getDirections, getPlaceDetails } from '../services/googleMaps';
import { startDestinationRecording, stopDestinationRecording, voiceToDestination } from '../services/voiceDestination';
import { supabase } from '../services/supabase';
import Toast from 'react-native-toast-message';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

// Local flow steps (independent from DB status)
// STEP 1: going_to_pickup  -> En camino al pasajero
// STEP 2: at_pickup        -> Confirma pasajero a bordo
// STEP 3: set_destination  -> Deci el destino por voz
// STEP 4: in_progress      -> Viaje en curso (timer/km)
// STEP 5: completed        -> Summary

const FLOW_STEP = {
  GOING_TO_PICKUP: 'going_to_pickup',
  AT_PICKUP: 'at_pickup',
  SET_DESTINATION: 'set_destination',
  IN_PROGRESS: 'in_progress',
};

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

  // Local flow step
  const [flowStep, setFlowStep] = useState(FLOW_STEP.GOING_TO_PICKUP);

  // Voice destination state
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceProcessing, setVoiceProcessing] = useState(false);
  const [voiceRecordingTime, setVoiceRecordingTime] = useState(0);
  const [destinationSet, setDestinationSet] = useState(false);
  const [destinationOptions, setDestinationOptions] = useState([]);
  const [voiceTranscription, setVoiceTranscription] = useState('');
  const voiceRecordingRef = useRef(null);
  const voiceTimerRef = useRef(null);

  const snapPoints = useMemo(() => ['35%', '65%'], []);

  // Derive initial flow step from DB status
  useEffect(() => {
    if (!activeTrip) return;
    if (activeTrip.status === TRIP_STATUS.IN_PROGRESS) {
      setFlowStep(FLOW_STEP.IN_PROGRESS);
      setDestinationSet(true);
    } else if (activeTrip.status === TRIP_STATUS.GOING_TO_PICKUP || activeTrip.status === TRIP_STATUS.ACCEPTED) {
      setFlowStep(FLOW_STEP.GOING_TO_PICKUP);
    }
  }, [activeTrip?.id]);

  // Fetch tariff
  useEffect(() => {
    const fetchTariff = async () => {
      try {
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

  // Start tracking
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

  // Reset route when flow step changes
  useEffect(() => {
    routeFetched.current = false;
    setRoutePolyline(null);
    setRouteInfo(null);
  }, [flowStep, destinationSet]);

  // Fetch route
  useEffect(() => {
    if (!activeTrip || !currentLocation || routeFetched.current) return;
    const fetchRoute = async () => {
      try {
        let origin, destination;
        const isApproachOnlyTrip = String(activeTrip.notes || '').includes('[APPROACH_ONLY]');
        const pickupLat = isApproachOnlyTrip ? parseFloat(activeTrip.destination_lat) : parseFloat(activeTrip.origin_lat);
        const pickupLng = isApproachOnlyTrip ? parseFloat(activeTrip.destination_lng) : parseFloat(activeTrip.origin_lng);
        if (flowStep === FLOW_STEP.IN_PROGRESS || destinationSet) {
          origin = { lat: currentLocation.lat, lng: currentLocation.lng };
          destination = { lat: parseFloat(activeTrip.destination_lat), lng: parseFloat(activeTrip.destination_lng) };
        } else {
          origin = { lat: currentLocation.lat, lng: currentLocation.lng };
          destination = { lat: pickupLat, lng: pickupLng };
        }
        if (!destination.lat || !destination.lng || isNaN(destination.lat) || isNaN(destination.lng)) return;
        const result = await getDirections(origin, destination);
        setRoutePolyline(result.polyline);
        setRouteInfo({ distance: result.distance, duration: result.duration });
        routeFetched.current = true;
      } catch (error) {
        console.log('Error fetching route:', error);
      }
    };
    fetchRoute();
  }, [activeTrip?.id, !!currentLocation, flowStep, destinationSet]);

  // Timer - only in_progress
  useEffect(() => {
    if (flowStep === FLOW_STEP.IN_PROGRESS) {
      timerRef.current = setInterval(() => {
        const current = useTripStore.getState().tripTimer;
        setTripTimer(current + 1);
      }, 1000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [flowStep]);

  // Track distance
  useEffect(() => {
    if (currentLocation && flowStep === FLOW_STEP.IN_PROGRESS) {
      addTripDistance(currentLocation);
    }
  }, [currentLocation]);

  // Live price
  const livePrice = useMemo(() => {
    return Math.round(tariffInfo.base + tariffInfo.perKm * tripDistanceKm);
  }, [tripDistanceKm, tariffInfo]);

  // Distance to pickup
  const distanceToPickup = useMemo(() => {
    if (!currentLocation || !activeTrip) return null;
    const isApproachOnlyTrip = String(activeTrip.notes || '').includes('[APPROACH_ONLY]');
    const pickupLat = isApproachOnlyTrip ? parseFloat(activeTrip.destination_lat) : parseFloat(activeTrip.origin_lat);
    const pickupLng = isApproachOnlyTrip ? parseFloat(activeTrip.destination_lng) : parseFloat(activeTrip.origin_lng);
    return haversineMeters(
      currentLocation.lat, currentLocation.lng,
      pickupLat, pickupLng
    );
  }, [currentLocation, activeTrip?.origin_lat, activeTrip?.origin_lng, activeTrip?.destination_lat, activeTrip?.destination_lng, activeTrip?.notes]);

  // ============================
  //  STEP HANDLERS
  // ============================

  // Step 1 -> Step 2: Confirm arrived at pickup
  const handleConfirmArrival = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFlowStep(FLOW_STEP.AT_PICKUP);
  }, []);

  // Step 2 -> Step 3 (or skip to Step 4 if destination already set by dashboard)
  const handlePassengerAboard = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const isApproachOnlyTrip = String(activeTrip?.notes || '').includes('[APPROACH_ONLY]');

    if (isApproachOnlyTrip && activeTrip?.id) {
      try {
        const pickupLat = parseFloat(activeTrip.destination_lat);
        const pickupLng = parseFloat(activeTrip.destination_lng);
        const pickupAddress = activeTrip.destination_address;
        const { data: updatedTrip, error } = await supabase
          .from('trips')
          .update({
            origin_address: pickupAddress,
            origin_lat: pickupLat,
            origin_lng: pickupLng,
          })
          .eq('id', activeTrip.id)
          .select()
          .single();
        if (!error && updatedTrip) {
          useTripStore.getState().updateActiveTrip(updatedTrip);
        }
      } catch (err) {
        console.warn('Error updating pickup as origin:', err);
      }
    }

    // If the dashboard already set a destination, skip voice step
    if (!isApproachOnlyTrip && activeTrip?.destination_lat && activeTrip?.destination_lng) {
      setDestinationSet(true);
      setFlowStep(FLOW_STEP.IN_PROGRESS);
      updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
    } else {
      setFlowStep(FLOW_STEP.SET_DESTINATION);
    }
  }, [activeTrip]);

  // Step 3: Voice recording
  const handleStartVoiceRecording = useCallback(async () => {
    try {
      const rec = await startDestinationRecording();
      voiceRecordingRef.current = rec;
      setVoiceRecording(true);
      setVoiceRecordingTime(0);
      voiceTimerRef.current = setInterval(() => setVoiceRecordingTime((t) => t + 1), 1000);
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (err) {
      Toast.show({ type: 'error', text1: 'Error', text2: err.message });
    }
  }, []);

  const handleCancelVoiceRecording = useCallback(async () => {
    if (voiceRecordingRef.current) {
      try { await voiceRecordingRef.current.stopAndUnloadAsync(); } catch {}
      voiceRecordingRef.current = null;
    }
    setVoiceRecording(false);
    clearInterval(voiceTimerRef.current);
    setVoiceRecordingTime(0);
  }, []);

  const handleSendVoiceDestination = useCallback(async () => {
    if (!voiceRecordingRef.current || !activeTrip) return;

    clearInterval(voiceTimerRef.current);
    setVoiceRecording(false);
    setVoiceProcessing(true);

    try {
      const uri = await stopDestinationRecording(voiceRecordingRef.current);
      voiceRecordingRef.current = null;

      Toast.show({ type: 'info', text1: 'Procesando...', text2: 'Buscando destino', visibilityTime: 2000 });

      const result = await voiceToDestination(uri);
      setVoiceTranscription(result.transcription);

      if (result.candidates.length === 1) {
        // Only one result → auto-select
        await selectDestination(result.candidates[0]);
      } else {
        // Multiple results → show picker
        setDestinationOptions(result.candidates);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      }
    } catch (err) {
      console.error('Voice destination error:', err);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Toast.show({ type: 'error', text1: 'Error', text2: err.message || 'No se pudo procesar el destino', visibilityTime: 4000 });
    } finally {
      setVoiceProcessing(false);
      setVoiceRecordingTime(0);
    }
  }, [activeTrip, currentLocation]);

  // Select a destination from the options
  const selectDestination = useCallback(async (option) => {
    if (!activeTrip) return;
    try {
      let lat = option.lat;
      let lng = option.lng;

      // If no lat/lng yet (Places Autocomplete result), resolve via Place Details
      if ((!lat || !lng) && option.placeId) {
        Toast.show({ type: 'info', text1: 'Confirmando...', visibilityTime: 1500 });
        const details = await getPlaceDetails(option.placeId);
        lat = details.lat;
        lng = details.lng;
      }

      if (!lat || !lng) {
        throw new Error('No se pudo obtener la ubicación');
      }

      const { data: updatedTrip, error } = await supabase
        .from('trips')
        .update({
          destination_address: option.address,
          destination_lat: lat,
          destination_lng: lng,
        })
        .eq('id', activeTrip.id)
        .select()
        .single();

      if (error) throw error;

      useTripStore.getState().updateActiveTrip(updatedTrip);
      setDestinationOptions([]);
      setDestinationSet(true);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Toast.show({ type: 'success', text1: 'Destino confirmado', text2: option.address, visibilityTime: 3000 });
    } catch (err) {
      Toast.show({ type: 'error', text1: 'Error', text2: 'No se pudo guardar el destino' });
    }
  }, [activeTrip]);

  // Step 3 -> Step 4: Start trip
  const handleStartTrip = useCallback(async () => {
    if (!activeTrip) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
    setFlowStep(FLOW_STEP.IN_PROGRESS);
  }, [activeTrip]);

  // Step 4 -> Complete
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

  // ============================
  //  STATUS PILL TEXT
  // ============================
  const getStatusInfo = () => {
    switch (flowStep) {
      case FLOW_STEP.GOING_TO_PICKUP: return { text: 'En camino al pasajero', color: colors.primary, step: 1 };
      case FLOW_STEP.AT_PICKUP: return { text: 'Confirmá pasajero a bordo', color: colors.warning, step: 2 };
      case FLOW_STEP.SET_DESTINATION: return { text: 'Indicá el destino', color: colors.info, step: 3 };
      case FLOW_STEP.IN_PROGRESS: return { text: 'Viaje en curso', color: colors.success, step: 4 };
      default: return { text: 'Viaje activo', color: colors.primary, step: 0 };
    }
  };

  // ============================
  //  SUMMARY SCREEN
  // ============================
  if (showSummary && completedTrip) {
    const finalPrice = completedTrip.price || livePrice;
    const finalDistance = completedTrip.distance_km || tripDistanceKm;
    const finalDuration = completedTrip.duration_minutes || Math.round(tripTimer / 60);
    const commissionPct = tariffInfo.commission;
    const commissionAmount = Math.round(finalPrice * commissionPct / 100);
    const driverEarnings = finalPrice - commissionAmount;

    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <StatusBar barStyle="dark-content" />
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 20, paddingVertical: 30 }}>
          <View style={s.successIconWrap}>
            <View style={s.successIconCircle}>
              <MaterialCommunityIcons name="check-bold" size={40} color="#fff" />
            </View>
          </View>
          <Text style={s.summaryTitle}>¡Viaje completado!</Text>
          <Text style={s.summarySubtitle}>{completedTrip.passenger_name}</Text>

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
              <Text style={s.priceItemLabel}>{formatDistance(finalDistance)} x {formatPrice(tariffInfo.perKm)}/km</Text>
              <Text style={s.priceItemValue}>{formatPrice(Math.round(tariffInfo.perKm * finalDistance))}</Text>
            </View>
            <View style={s.priceTotalDivider} />
            <View style={s.priceTotalRow}>
              <Text style={s.priceTotalLabel}>Total a pagar</Text>
              <Text style={s.priceTotalValue}>{formatPrice(finalPrice)}</Text>
            </View>
          </View>

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

  const statusInfo = getStatusInfo();
  const speedKmh = speed ? Math.round((speed < 0 ? 0 : speed) * 3.6) : 0;
  const isInProgress = flowStep === FLOW_STEP.IN_PROGRESS;
  const isApproachOnlyTrip = String(activeTrip.notes || '').includes('[APPROACH_ONLY]');

  const pickupPoint = isApproachOnlyTrip
    ? { lat: activeTrip.destination_lat, lng: activeTrip.destination_lng, address: activeTrip.destination_address }
    : { lat: activeTrip.origin_lat, lng: activeTrip.origin_lng, address: activeTrip.origin_address };

  // Map destination target based on step
  const mapDestination = (flowStep === FLOW_STEP.GOING_TO_PICKUP || flowStep === FLOW_STEP.AT_PICKUP)
    ? pickupPoint
    : { lat: activeTrip.destination_lat, lng: activeTrip.destination_lng, address: activeTrip.destination_address };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* Map */}
      <TripMap
        driverLocation={currentLocation}
        origin={pickupPoint}
        destination={mapDestination}
        polyline={routePolyline}
        heading={heading}
        style={StyleSheet.absoluteFillObject}
      />

      {/* Status pill */}
      <View style={[s.statusPill, { top: insets.top + 12 }]}>
        <View style={[s.statusDot, { backgroundColor: statusInfo.color }]} />
        <Text style={s.statusText}>{statusInfo.text}</Text>
        <View style={s.stepBadge}>
          <Text style={s.stepBadgeText}>{statusInfo.step}/4</Text>
        </View>
      </View>

      {/* Speed + Timer + KM chips */}
      <View style={[s.chipRow, { top: insets.top + 52 }]}>
        <View style={s.chip}>
          <Text style={s.chipValue}>{speedKmh}</Text>
          <Text style={s.chipLabel}>km/h</Text>
        </View>
        {isInProgress && (
          <>
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
                <Text style={s.routeInfoText}>{routeInfo.distance} · {routeInfo.duration}</Text>
              )}
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {activeTrip.passenger_phone ? (
                <TouchableOpacity style={s.iconBtn} onPress={() => Linking.openURL(`tel:${activeTrip.passenger_phone}`)}>
                  <Ionicons name="call" size={18} color={colors.primary} />
                </TouchableOpacity>
              ) : null}
              <TouchableOpacity style={s.iconBtn} onPress={() => Linking.openURL(`tel:${DISPATCHER_PHONE}`)}>
                <MaterialCommunityIcons name="headset" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          </View>

          {/* STEP 1: Going to pickup */}
          {flowStep === FLOW_STEP.GOING_TO_PICKUP && (
            <>
              <View style={s.addressCard}>
                <View style={s.addressRow}>
                  <View style={[s.addressDot, { backgroundColor: colors.primary }]} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.addressLabel}>Buscá al pasajero en</Text>
                    <Text style={s.addressText} numberOfLines={2}>{pickupPoint.address}</Text>
                  </View>
                </View>
              </View>

              {distanceToPickup !== null && (
                <View style={[s.proximityHint, distanceToPickup <= 300 ? s.proximityNear : s.proximityFar]}>
                  <MaterialCommunityIcons
                    name={distanceToPickup <= 300 ? 'check-circle' : 'map-marker-radius'}
                    size={16}
                    color={distanceToPickup <= 300 ? colors.success : colors.warning}
                  />
                  <Text style={[s.proximityText, { color: distanceToPickup <= 300 ? colors.success : colors.warning }]}>
                    {distanceToPickup <= 300
                      ? 'Estás cerca del pasajero'
                      : `A ${Math.round(distanceToPickup)}m del punto de recogida`}
                  </Text>
                </View>
              )}

              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.primary }]}
                onPress={handleConfirmArrival}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="map-marker-check" size={22} color="#fff" />
                <Text style={s.actionBtnText}>Llegué al punto de encuentro</Text>
              </TouchableOpacity>
            </>
          )}

          {/* STEP 2: At pickup - Confirm passenger aboard */}
          {flowStep === FLOW_STEP.AT_PICKUP && (
            <>
              <View style={s.stepInfoCard}>
                <MaterialCommunityIcons name="account-check" size={28} color={colors.warning} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.stepInfoTitle}>¿El pasajero subió?</Text>
                  <Text style={s.stepInfoSubtitle}>Confirmá que el pasajero está a bordo para continuar</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.warning }]}
                onPress={handlePassengerAboard}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="account-check" size={22} color="#fff" />
                <Text style={s.actionBtnText}>Pasajero a bordo</Text>
              </TouchableOpacity>
            </>
          )}

          {/* STEP 3: Set destination by voice */}
          {flowStep === FLOW_STEP.SET_DESTINATION && (
            <>
              {!destinationSet ? (
                <>
                  <View style={s.stepInfoCard}>
                    <MaterialCommunityIcons name="microphone" size={28} color={colors.info} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.stepInfoTitle}>¿A dónde van?</Text>
                      <Text style={s.stepInfoSubtitle}>Grabá un audio diciendo la dirección de destino</Text>
                    </View>
                  </View>

                  <View style={s.voiceDestSection}>
                    {destinationOptions.length > 0 ? (
                      <View>
                        {voiceTranscription ? (
                          <View style={s.transcriptionCard}>
                            <MaterialCommunityIcons name="ear-hearing" size={14} color={colors.textMuted} />
                            <Text style={s.transcriptionText}>Escuché: "{voiceTranscription}"</Text>
                          </View>
                        ) : null}
                        <Text style={s.optionsTitle}>Seleccioná el destino correcto:</Text>
                        {destinationOptions.map((opt, idx) => (
                          <TouchableOpacity
                            key={opt.placeId || `${opt.lat}-${opt.lng}-${idx}`}
                            style={s.optionCard}
                            onPress={() => selectDestination(opt)}
                            activeOpacity={0.7}
                          >
                            <View style={s.optionNumberCircle}>
                              <Text style={s.optionNumber}>{idx + 1}</Text>
                            </View>
                            <Text style={s.optionAddress} numberOfLines={2}>{opt.address}</Text>
                            <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        ))}
                        <TouchableOpacity
                          style={s.reRecordBtn}
                          onPress={() => { setDestinationOptions([]); setVoiceTranscription(''); }}
                          activeOpacity={0.7}
                        >
                          <MaterialCommunityIcons name="microphone" size={14} color={colors.textMuted} />
                          <Text style={s.reRecordText}>Grabar de nuevo</Text>
                        </TouchableOpacity>
                      </View>
                    ) : voiceProcessing ? (
                      <View style={s.voiceProcessingCard}>
                        <ActivityIndicator size="small" color={colors.primary} />
                        <Text style={s.voiceProcessingText}>Buscando destino...</Text>
                      </View>
                    ) : voiceRecording ? (
                      <View style={s.voiceRecordingCard}>
                        <View style={s.voiceRecDotWrap}>
                          <View style={s.voiceRecDot} />
                        </View>
                        <Text style={s.voiceRecTime}>
                          {Math.floor(voiceRecordingTime / 60)}:{(voiceRecordingTime % 60).toString().padStart(2, '0')}
                        </Text>
                        <Text style={s.voiceRecLabel}>Decí el destino...</Text>
                        <View style={{ flex: 1 }} />
                        <TouchableOpacity style={s.voiceCancelBtn} onPress={handleCancelVoiceRecording}>
                          <MaterialCommunityIcons name="close" size={18} color={colors.danger} />
                        </TouchableOpacity>
                        <TouchableOpacity style={s.voiceSendBtn} onPress={handleSendVoiceDestination}>
                          <MaterialCommunityIcons name="send" size={18} color="#fff" />
                        </TouchableOpacity>
                      </View>
                    ) : (
                      <TouchableOpacity style={s.voiceDestBtn} onPress={handleStartVoiceRecording} activeOpacity={0.85}>
                        <MaterialCommunityIcons name="microphone" size={24} color={colors.primary} />
                        <Text style={s.voiceDestBtnText}>Grabar destino por voz</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              ) : (
                <>
                  {/* Destination confirmed - show address and start button */}
                  <View style={s.addressCard}>
                    <View style={s.addressRow}>
                      <View style={[s.addressDot, { backgroundColor: colors.success }]} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={s.addressLabel}>Destino confirmado</Text>
                        <Text style={s.addressText} numberOfLines={2}>{activeTrip.destination_address}</Text>
                      </View>
                    </View>
                  </View>

                  {routeInfo && (
                    <View style={s.routeInfoCard}>
                      <MaterialCommunityIcons name="map-marker-distance" size={16} color={colors.info} />
                      <Text style={s.routeInfoCardText}>{routeInfo.distance} · {routeInfo.duration}</Text>
                    </View>
                  )}

                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: colors.success }]}
                    onPress={handleStartTrip}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="car" size={22} color="#fff" />
                    <Text style={s.actionBtnText}>Empezar viaje</Text>
                  </TouchableOpacity>

                  {/* Allow re-recording */}
                  <TouchableOpacity
                    style={s.reRecordBtn}
                    onPress={() => { setDestinationSet(false); setDestinationOptions([]); setVoiceTranscription(''); }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="microphone" size={14} color={colors.textMuted} />
                    <Text style={s.reRecordText}>Cambiar destino</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {/* STEP 4: In progress */}
          {flowStep === FLOW_STEP.IN_PROGRESS && (
            <>
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

              <View style={s.livePriceCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={s.livePriceLabel}>Estimado en vivo</Text>
                    <Text style={s.livePriceSubLabel}>{formatDistance(tripDistanceKm)} recorridos</Text>
                  </View>
                  <Text style={s.livePriceValue}>{formatPrice(livePrice)}</Text>
                </View>
              </View>

              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.danger }]}
                onPress={handleEndTrip}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="flag-checkered" size={22} color="#fff" />
                <Text style={s.actionBtnText}>Finalizar viaje</Text>
              </TouchableOpacity>
            </>
          )}

          {/* SOS */}
          <TouchableOpacity style={s.sosBtn} onPress={() => Linking.openURL(`tel:${EMERGENCY_PHONE}`)}>
            <Ionicons name="warning" size={14} color={colors.danger} />
            <Text style={s.sosBtnText}>Emergencia</Text>
          </TouchableOpacity>

        </BottomSheetScrollView>
      </BottomSheet>
    </View>
  );
};

/* styles */
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  successIconWrap: { alignItems: 'center', marginBottom: 16 },
  successIconCircle: {
    width: 72, height: 72, borderRadius: 36,
    backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center',
    shadowColor: colors.success, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  summaryTitle: { color: colors.text, fontSize: 22, fontFamily: 'Inter_700Bold', textAlign: 'center', marginBottom: 4 },
  summarySubtitle: { color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium', textAlign: 'center', marginBottom: 20 },
  summaryCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: colors.border },
  summaryRoute: { flexDirection: 'row' },
  routeIconCol: { alignItems: 'center', width: 20, marginRight: 10 },
  routeDot: { width: 10, height: 10, borderRadius: 5 },
  routeLine: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 3 },
  summaryAddressLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  summaryRouteText: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  summaryStatsRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  summaryStat: { flex: 1, backgroundColor: colors.surface, borderRadius: 14, paddingVertical: 14, alignItems: 'center', borderWidth: 1, borderColor: colors.border },
  summaryStatValue: { color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold', marginTop: 4 },
  summaryStatLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 2 },
  priceCard: { backgroundColor: colors.surface, borderRadius: 16, padding: 18, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  priceCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  priceCardHeaderText: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  priceItemRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  priceItemLabel: { color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular' },
  priceItemValue: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium' },
  priceTotalDivider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  priceTotalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  priceTotalLabel: { color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold' },
  priceTotalValue: { color: colors.secondary, fontSize: 28, fontFamily: 'Inter_700Bold' },
  earningsCard: { backgroundColor: `${colors.success}10`, borderRadius: 16, padding: 16, marginBottom: 16, borderWidth: 1.5, borderColor: `${colors.success}30` },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  earningsLabel: { color: colors.success, fontSize: 14, fontFamily: 'Inter_700Bold' },
  earningsSubLabel: { color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  earningsValue: { color: colors.success, fontSize: 24, fontFamily: 'Inter_700Bold' },
  summaryBtn: { backgroundColor: colors.primary, borderRadius: 14, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 },
  summaryBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_600SemiBold' },
  statusPill: {
    position: 'absolute', alignSelf: 'center', flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 20,
    paddingHorizontal: 14, paddingVertical: 7,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, borderWidth: 1, borderColor: '#E2E8F0',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusText: { color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  stepBadge: {
    marginLeft: 8, backgroundColor: colors.background, borderRadius: 8,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  stepBadgeText: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_600SemiBold' },
  chipRow: {
    position: 'absolute', left: 16, right: 16,
    flexDirection: 'row', justifyContent: 'space-between',
  },
  chip: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#FFFFFF', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 6,
    elevation: 3, shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08, shadowRadius: 4, borderWidth: 1, borderColor: '#E2E8F0',
  },
  chipValue: { color: colors.text, fontSize: 18, fontFamily: 'Inter_700Bold' },
  chipLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginLeft: 4 },
  sheetBg: {
    backgroundColor: colors.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22,
    borderWidth: 1, borderColor: colors.border,
  },
  handle: { backgroundColor: colors.textMuted, width: 32, height: 4, borderRadius: 2 },
  sheetContent: { paddingHorizontal: 20, paddingBottom: 32, paddingTop: 4 },
  passengerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  avatarCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontSize: 18, fontFamily: 'Inter_700Bold' },
  nameText: { color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  routeInfoText: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium', marginTop: 2 },
  iconBtn: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  addressCard: { backgroundColor: colors.background, borderRadius: 14, padding: 14, marginBottom: 14 },
  addressRow: { flexDirection: 'row', alignItems: 'flex-start' },
  addressDot: { width: 10, height: 10, borderRadius: 5, marginTop: 4 },
  addressLabel: { color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', textTransform: 'uppercase', letterSpacing: 0.5 },
  addressText: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', marginTop: 2 },
  addressDividerLine: { width: 1, height: 16, backgroundColor: colors.border, marginLeft: 4.5, marginVertical: 4 },
  livePriceCard: { backgroundColor: `${colors.secondary}10`, borderRadius: 14, padding: 14, marginBottom: 14, borderWidth: 1, borderColor: `${colors.secondary}30` },
  livePriceLabel: { color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  livePriceSubLabel: { color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 },
  livePriceValue: { color: colors.secondary, fontSize: 24, fontFamily: 'Inter_700Bold' },
  proximityHint: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10 },
  proximityNear: { backgroundColor: `${colors.success}12`, borderWidth: 1, borderColor: `${colors.success}30` },
  proximityFar: { backgroundColor: `${colors.warning}10`, borderWidth: 1, borderColor: `${colors.warning}25` },
  proximityText: { fontSize: 12, fontFamily: 'Inter_500Medium' },
  actionBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, borderRadius: 14, gap: 10, marginBottom: 12 },
  actionBtnText: { color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' },
  sosBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
  sosBtnText: { color: colors.danger, fontSize: 13, fontFamily: 'Inter_500Medium' },
  stepInfoCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.background, borderRadius: 14, padding: 16, marginBottom: 14,
  },
  stepInfoTitle: { color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' },
  stepInfoSubtitle: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  routeInfoCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${colors.info}10`, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10,
    marginBottom: 12, borderWidth: 1, borderColor: `${colors.info}25`,
  },
  routeInfoCardText: { color: colors.info, fontSize: 13, fontFamily: 'Inter_600SemiBold' },
  reRecordBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8,
  },
  reRecordText: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' },
  voiceDestSection: { marginBottom: 10 },
  voiceDestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 18, borderRadius: 14, gap: 10,
    backgroundColor: `${colors.primary}12`, borderWidth: 1.5, borderColor: `${colors.primary}30`,
  },
  voiceDestBtnText: { color: colors.primary, fontSize: 15, fontFamily: 'Inter_700Bold' },
  voiceRecordingCard: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, gap: 10,
    backgroundColor: `${colors.danger}08`, borderWidth: 1.5, borderColor: `${colors.danger}25`,
  },
  voiceRecDotWrap: { width: 12, height: 12, alignItems: 'center', justifyContent: 'center' },
  voiceRecDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
  voiceRecTime: { color: colors.danger, fontSize: 15, fontFamily: 'Inter_700Bold', minWidth: 36 },
  voiceRecLabel: { color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_500Medium' },
  voiceCancelBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: `${colors.danger}15`, alignItems: 'center', justifyContent: 'center' },
  voiceSendBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  voiceProcessingCard: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, paddingHorizontal: 14, borderRadius: 14, gap: 10,
    backgroundColor: `${colors.primary}08`, borderWidth: 1.5, borderColor: `${colors.primary}20`,
  },
  voiceProcessingText: { color: colors.primary, fontSize: 13, fontFamily: 'Inter_500Medium' },
  transcriptionCard: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${colors.textMuted}08`, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10,
  },
  transcriptionText: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', fontStyle: 'italic', flex: 1 },
  optionsTitle: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold', marginBottom: 10 },
  optionCard: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: colors.background, borderRadius: 12,
    padding: 14, marginBottom: 8,
    borderWidth: 1.5, borderColor: colors.border,
  },
  optionNumberCircle: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: `${colors.primary}15`, alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  optionNumber: { color: colors.primary, fontSize: 13, fontFamily: 'Inter_700Bold' },
  optionAddress: { color: colors.text, fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 },
});

export default ActiveTripScreen;
