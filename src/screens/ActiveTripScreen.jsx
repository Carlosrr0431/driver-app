import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, Linking, Platform, Dimensions, Pressable, TouchableOpacity, StatusBar, StyleSheet, ScrollView, ActivityIndicator, Modal, TextInput, Keyboard } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import BottomSheet, { BottomSheetScrollView, BottomSheetTextInput } from '@gorhom/bottom-sheet';
import * as Haptics from 'expo-haptics';
import { colors } from '../theme/colors';
import { useTripStore } from '../stores/tripStore';
import { useAuthStore } from '../stores/authStore';
import { useTrips } from '../hooks/useTrips';
import { useLocation } from '../hooks/useLocation';
import { useLocationStore } from '../stores/locationStore';
import { TripMap } from '../components/map/TripMap';
import { TRIP_STATUS, EMERGENCY_PHONE, DISPATCHER_PHONE, TRACKING_BASE_URL } from '../utils/constants';
import { formatTimerMMSS, formatPrice, formatDistance, formatDuration } from '../utils/formatters';
import { fetchTariffForTrip, calculateTripCommission } from '../utils/tripTariff';
import {
  autocompleteAddressSalta,
  computeNavigationSnapshot,
  createInitialNavigationProgressState,
  decodePolyline,
  evaluateRerouteState,
  getDirections,
  getPlaceDetails,
  projectPointOntoPolyline,
} from '../services/googleMaps';
import { useVoiceNavigation } from '../hooks/useVoiceNavigation';
import { supabase } from '../services/supabase';
import Toast from 'react-native-toast-message';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const NOTIFY_PASSENGER_URL = `${TRACKING_BASE_URL}/api/driver/notify-passenger`;

// Local flow steps (independent from DB status)
// STEP 1: going_to_pickup  -> En camino al pasajero
// STEP 2: at_pickup        -> Confirma pasajero a bordo
// STEP 3: set_destination  -> Deci el destino por voz
// STEP 4: in_progress      -> Viaje en curso (timer/km)
// STEP 5: completed        -> Summary

const FLOW_STEP = {
  GOING_TO_PICKUP: 'going_to_pickup',
  AT_PICKUP: 'at_pickup',
  CHOOSE_DEST_MODE: 'choose_dest_mode',
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

function parseRouteDistanceKm(routeInfo) {
  const meters = Number(routeInfo?.distanceValue);
  if (Number.isFinite(meters) && meters > 0) return meters / 1000;

  const distanceText = String(routeInfo?.distance || '').toLowerCase().trim();
  if (!distanceText) return null;

  const kmMatch = distanceText.match(/([\d.,]+)\s*km/);
  if (kmMatch?.[1]) {
    const km = Number.parseFloat(kmMatch[1].replace(',', '.'));
    if (Number.isFinite(km) && km > 0) return km;
  }

  const mMatch = distanceText.match(/([\d.,]+)\s*m/);
  if (mMatch?.[1]) {
    const m = Number.parseFloat(mMatch[1].replace(',', '.'));
    if (Number.isFinite(m) && m > 0) return m / 1000;
  }

  return null;
}

function formatRemainingDistance(distanceMeters) {
  if (!Number.isFinite(distanceMeters) || distanceMeters <= 0) return 'Llegando';
  if (distanceMeters < 1000) return `${Math.round(distanceMeters)} m`;
  return `${(distanceMeters / 1000).toFixed(distanceMeters >= 10000 ? 0 : 1)} km`;
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0 min';
  const totalMinutes = Math.max(1, Math.round(seconds / 60));
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes > 0 ? `${hours} h ${minutes} min` : `${hours} h`;
}

function formatArrivalClock(secondsFromNow) {
  if (!Number.isFinite(secondsFromNow) || secondsFromNow <= 0) return 'Ahora';
  const arrival = new Date(Date.now() + secondsFromNow * 1000);
  return arrival.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function createInitialRerouteEvalState() {
  return {
    offRouteSinceTs: null,
    offRouteSamples: 0,
    onRouteSamples: 0,
    emaDeviation: null,
    lastDeviationMeters: null,
    lastUpdatedAt: 0,
  };
}

function getManeuverIcon(maneuver) {
  const normalized = String(maneuver || '').toLowerCase();

  if (!normalized) return 'arrow-up';
  if (normalized.includes('uturn') || normalized.includes('u-turn')) return 'backup-restore';
  if (normalized.includes('roundabout')) return 'rotate-orbit';
  if (normalized.includes('fork-left') || normalized.includes('keep-left') || normalized.includes('ramp-left') || normalized.includes('turn-slight-left')) return 'arrow-top-left';
  if (normalized.includes('fork-right') || normalized.includes('keep-right') || normalized.includes('ramp-right') || normalized.includes('turn-slight-right')) return 'arrow-top-right';
  if (normalized.includes('turn-left')) return 'arrow-left-top';
  if (normalized.includes('turn-right')) return 'arrow-right-top';
  if (normalized.includes('merge')) return 'call-merge';
  if (normalized.includes('ferry')) return 'ferry';
  if (normalized.includes('straight')) return 'arrow-up';

  return 'arrow-up';
}

function getManeuverPresentation(maneuver, remainingDistanceMeters, nextStepDistanceMeters) {
  const normalized = String(maneuver || '').toLowerCase();
  const isArriving = Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters <= 40;

  if (isArriving) {
    return {
      icon: 'map-marker-check',
      tint: colors.success,
      background: `${colors.success}12`,
      border: `${colors.success}28`,
      isCritical: true,
      shortLabel: 'Llegada',
      instructionPrefix: 'Llegaste',
    };
  }

  if (normalized.includes('roundabout')) {
    return {
      icon: 'rotate-orbit',
      tint: colors.warning,
      background: `${colors.warning}12`,
      border: `${colors.warning}28`,
      isCritical: true,
      shortLabel: 'Rotonda',
      instructionPrefix: 'Atento',
    };
  }

  if (normalized.includes('uturn') || normalized.includes('u-turn')) {
    return {
      icon: 'backup-restore',
      tint: colors.danger,
      background: `${colors.danger}12`,
      border: `${colors.danger}28`,
      isCritical: true,
      shortLabel: 'Retorno',
      instructionPrefix: 'Prepararse',
    };
  }

  if (normalized.includes('turn-left') || normalized.includes('turn-right')) {
    return {
      icon: getManeuverIcon(normalized),
      tint: colors.primary,
      background: `${colors.primary}12`,
      border: `${colors.primary}24`,
      isCritical: Number(nextStepDistanceMeters) <= 120,
      shortLabel: normalized.includes('left') ? 'Giro izq.' : 'Giro der.',
      instructionPrefix: 'Próxima maniobra',
    };
  }

  if (
    normalized.includes('fork')
    || normalized.includes('keep-')
    || normalized.includes('ramp')
    || normalized.includes('merge')
  ) {
    return {
      icon: getManeuverIcon(normalized),
      tint: colors.info,
      background: `${colors.info}12`,
      border: `${colors.info}24`,
      isCritical: true,
      shortLabel: 'Desvío',
      instructionPrefix: 'Mantener atención',
    };
  }

  return {
    icon: getManeuverIcon(normalized),
    tint: colors.primary,
    background: `${colors.primary}10`,
    border: `${colors.primary}20`,
    isCritical: false,
    shortLabel: 'Seguir',
    instructionPrefix: 'Continuar',
  };
}

function extractRoadNameFromInstruction(instruction) {
  const text = String(instruction || '').trim();
  if (!text) return null;

  const cleanedText = text
    .replace(/^dir[ií]gete\s+hacia\s+/i, '')
    .replace(/^contin[uú]a\s+/i, '')
    .trim();

  const patterns = [
    // Allow dots so abbreviations like "C. Tadeo Tadía" are captured whole
    /(?:por|direcci[oó]n a|hacia)\s+([A-Z0-9ÁÉÍÓÚÑ][^,]+)/i,
    /en\s+([A-Z0-9ÁÉÍÓÚÑ][^,]+?)(?:\s+hacia|\s+con\s+direcci[oó]n|\s*,|$)/i,
    /(?:continua|continuá|sigue|seguí)\s+por\s+([A-Z0-9ÁÉÍÓÚÑ][^,]+)/i,
    /(?:incorp[oó]rate|incorporate)\s+a\s+([A-Z0-9ÁÉÍÓÚÑ][^,]+)/i,
  ];

  for (const pattern of patterns) {
    const match = cleanedText.match(pattern);
    if (match?.[1]) {
      const road = match[1]
        .replace(/^(el|la|los|las)\s+(norte|sur|este|oeste|noreste|noroeste|sureste|suroeste)\s+en\s+/i, '')
        .replace(/\s+hacia\s+[A-Z0-9ÁÉÍÓÚÑ].*$/i, '')
        .replace(/\s+con\s+direcci[oó]n\s+a\s+[A-Z0-9ÁÉÍÓÚÑ].*$/i, '')
        .trim();
      if (!road) return null;
      if (/^(el|la|los|las)\s+(norte|sur|este|oeste|noreste|noroeste|sureste|suroeste)$/i.test(road)) {
        return null;
      }
      return road;
    }
  }

  return null;
}

function formatDistanceForSpeech(distanceMeters) {
  const meters = Math.max(0, Math.round(Number(distanceMeters) || 0));
  if (meters <= 35) return 'ahora';
  if (meters < 80) return 'en unos metros';
  if (meters < 1000) {
    // Round to nearest 50 m for cleaner display
    const rounded = Math.round(meters / 50) * 50;
    return `en ${rounded} m`;
  }
  const km = meters / 1000;
  return `en ${km >= 10 ? Math.round(km) : km.toFixed(1)} km`;
}

// Tabla de equivalencias: clave Google → texto en español rioplatense
// Las claves más específicas van primero para que el match parcial sea correcto.
const MANEUVER_TEXT_MAP = [
  ['turn-sharp-right',    'doblá bien a la derecha'],
  ['turn-sharp-left',     'doblá bien a la izquierda'],
  ['turn-slight-right',   'seguí levemente a la derecha'],
  ['turn-slight-left',    'seguí levemente a la izquierda'],
  ['turn-right',          'doblá a la derecha'],
  ['turn-left',           'doblá a la izquierda'],
  ['roundabout-right',    'en la rotonda, salí a la derecha'],
  ['roundabout-left',     'en la rotonda, salí a la izquierda'],
  ['roundabout',          'entrá en la rotonda'],
  ['uturn-right',         'hacé un retorno a la derecha'],
  ['uturn-left',          'hacé un retorno a la izquierda'],
  ['u-turn',              'hacé un retorno'],
  ['fork-right',          'mantenete a la derecha'],
  ['fork-left',           'mantenete a la izquierda'],
  ['keep-right',          'mantenete a la derecha'],
  ['keep-left',           'mantenete a la izquierda'],
  ['ramp-right',          'tomá la rampa a la derecha'],
  ['ramp-left',           'tomá la rampa a la izquierda'],
  ['merge',               'incorporate al tráfico'],
  ['ferry',               'tomá el ferry'],
  ['straight',            'seguí derecho'],
];

const NAV_MANEUVER_PREVIEW_DISTANCE_METERS = 140;

function getDirectActionText(maneuver, roadName) {
  const normalized = String(maneuver || '').toLowerCase();
  // Use "en" for turns/maneuvers, "por" for continuing on a road
  const isTurnLike = normalized.includes('turn') || normalized.includes('roundabout')
    || normalized.includes('uturn') || normalized.includes('u-turn')
    || normalized.includes('fork') || normalized.includes('ramp');
  const roadSuffix = roadName ? (isTurnLike ? ` en ${roadName}` : ` por ${roadName}`) : '';

  // Buscar en tabla de equivalencias (orden importa: más específico primero)
  for (const [key, text] of MANEUVER_TEXT_MAP) {
    if (normalized.includes(key)) return `${text}${roadSuffix}`;
  }

  // Fallback: detectar español en el texto crudo de la instrucción
  if (normalized.includes('derecha')) return roadName ? `doblá a la derecha por ${roadName}` : 'doblá a la derecha';
  if (normalized.includes('izquierda')) return roadName ? `doblá a la izquierda por ${roadName}` : 'doblá a la izquierda';

  return roadName ? `seguí por ${roadName}` : 'seguí derecho';
}

function buildDirectNavigationInstruction(step, remainingDistanceMeters) {
  const isArriving = Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters <= 40;
  if (isArriving) {
    return {
      primary: 'Llegaste a destino',
      roadName: null,
    };
  }

  const distToStep = Number(step?.distanceToStepMeters);
  if (!Number.isFinite(distToStep) || distToStep > NAV_MANEUVER_PREVIEW_DISTANCE_METERS) {
    return {
      primary: 'Continuá por la ruta marcada',
      roadName: null,
    };
  }

  const roadName = extractRoadNameFromInstruction(step?.instruction);
  const maneuverOrText = step?.maneuver || step?.instruction || '';
  const actionText = getDirectActionText(maneuverOrText, roadName);
  const distanceText = formatDistanceForSpeech(distToStep);

  // When very close to the maneuver (< 80 m), lead with "Ahora" + action.
  // Otherwise just show the action — the distance is already displayed as the large number.
  if (distanceText === 'ahora' || distanceText === 'en unos metros') {
    const prefix = distanceText === 'ahora' ? 'Ahora' : 'En unos metros';
    return { primary: `${prefix}, ${actionText}`, roadName };
  }

  return {
    primary: `${actionText.charAt(0).toUpperCase()}${actionText.slice(1)}`,
    roadName,
  };
}

/**
 * Parsea el destino final geocodificado desde el campo notes del viaje.
 * El campo tiene el formato: [FINAL_DEST_JSON:{"address":"...","lat":...,"lng":...}]
 * Retorna { address, lat, lng } o null si no está disponible.
 */
function parsePreloadedDestination(notes) {
  const raw = String(notes || '');
  const match = raw.match(/\[FINAL_DEST_JSON:(\{[^}]+\})\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[1]);
    if (
      parsed &&
      typeof parsed.address === 'string' &&
      Number.isFinite(Number(parsed.lat)) &&
      Number.isFinite(Number(parsed.lng))
    ) {
      return {
        address: parsed.address,
        lat: Number(parsed.lat),
        lng: Number(parsed.lng),
      };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Tarifa acordada con el pasajero por WhatsApp (precio + km ya persistidos en trips).
 * Evita recalcular con platform_tariff_per_km al finalizar y cobrar distinto a lo confirmado.
 */
function resolveConfirmedPassengerFare(trip) {
  const preloaded = parsePreloadedDestination(trip?.notes);
  if (!preloaded?.address) return null;

  const price = Number(trip?.price);
  const distanceKm = Number(trip?.distance_km);
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) return null;

  const commissionAmount = Number(trip?.commission_amount);
  return {
    price: Math.round(price),
    distanceKm,
    commissionAmount: Number.isFinite(commissionAmount) && commissionAmount >= 0
      ? Math.round(commissionAmount)
      : null,
  };
}

function resolvePickupPoint(trip, currentLocation) {
  const overrideLat = parseFloat(trip?.pickup_override_lat);
  const overrideLng = parseFloat(trip?.pickup_override_lng);
  const hasOverride = Number.isFinite(overrideLat) && Number.isFinite(overrideLng);
  if (hasOverride) {
    return {
      point: {
        lat: overrideLat,
        lng: overrideLng,
        address: trip?.pickup_override_address || trip?.destination_address,
      },
      isApproachOnly: true,
    };
  }

  const originLat = parseFloat(trip?.origin_lat);
  const originLng = parseFloat(trip?.origin_lng);
  const destLat = parseFloat(trip?.destination_lat);
  const destLng = parseFloat(trip?.destination_lng);

  const hasOrigin = Number.isFinite(originLat) && Number.isFinite(originLng);
  const hasDestination = Number.isFinite(destLat) && Number.isFinite(destLng);
  const notes = String(trip?.notes || '');
  const notesNorm = notes.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const hasApproachTag = notesNorm.includes('[approach_only]') || notesNorm.includes('approach_only');
  const hasPassengerAppMarker = notesNorm.includes('[passenger_app]');
  const hasWhatsappAutoMarker = notesNorm.includes('creado automaticamente desde whatsapp');

  if (hasApproachTag && hasPassengerAppMarker && hasOrigin) {
    return {
      point: { lat: originLat, lng: originLng, address: trip?.origin_address },
      isApproachOnly: true,
    };
  }

  if (hasApproachTag && hasDestination) {
    return {
      point: { lat: destLat, lng: destLng, address: trip?.destination_address },
      isApproachOnly: true,
    };
  }

  // Defensive fallback for legacy/inconsistent approach trips where notes tag may be missing.
  // If current location is almost at origin but destination is still far away, pickup is destination.
  const tripStatus = String(trip?.status || '').toLowerCase();
  const isPickupPhase = tripStatus === 'pending' || tripStatus === 'accepted' || tripStatus === 'going_to_pickup';
  const phoneDigits = String(trip?.passenger_phone || '').replace(/\D/g, '');
  const isLikelyWhatsappPhone = phoneDigits.length >= 10;
  const hasNoFareDataYet = trip?.price == null && trip?.distance_km == null && trip?.duration_minutes == null;
  const looksLikeApproachTrip = hasApproachTag || hasWhatsappAutoMarker;
  const shouldUseLegacyApproachFallback = !looksLikeApproachTrip && isPickupPhase && isLikelyWhatsappPhone && hasNoFareDataYet;

  if (currentLocation && hasOrigin && hasDestination && shouldUseLegacyApproachFallback) {
    const metersToOrigin = haversineMeters(currentLocation.lat, currentLocation.lng, originLat, originLng);
    const metersToDestination = haversineMeters(currentLocation.lat, currentLocation.lng, destLat, destLng);
    if (metersToOrigin <= 300 && metersToDestination > 250) {
      return {
        point: { lat: destLat, lng: destLng, address: trip?.destination_address },
        isApproachOnly: true,
      };
    }
  }

  if (hasOrigin) {
    return {
      point: { lat: originLat, lng: originLng, address: trip?.origin_address },
      isApproachOnly: false,
    };
  }

  return {
    point: hasDestination ? { lat: destLat, lng: destLng, address: trip?.destination_address } : null,
    isApproachOnly: false,
  };
}

/**
 * Snaps a raw GPS origin to the nearest point on the active route polyline.
 * Returns the snapped {lat, lng} if the GPS is within 30 m of the road,
 * otherwise returns the raw coordinates unchanged.
 * This keeps the route and navigation calculations road-aligned even when
 * the GPS drifts onto a sidewalk.
 */
function snapOriginToRoute(lat, lng, routeCoords) {
  if (!routeCoords || routeCoords.length < 2) return { lat, lng };
  const projection = projectPointOntoPolyline(
    { latitude: lat, longitude: lng },
    routeCoords,
  );
  const snapThreshold = 35;
  if (projection.deviationMeters <= snapThreshold && projection.snappedPoint) {
    return {
      lat: projection.snappedPoint.latitude,
      lng: projection.snappedPoint.longitude,
    };
  }
  return { lat, lng };
}

// ─── SliderButton ─────────────────────────────────────────────────────────────
// Gesto horizontal en todo el track (RNGH + Reanimated) para evitar conflictos
// con BottomSheetScrollView y lograr animaciones fluidas en el hilo de UI.
const SLIDER_THUMB = 52;
const SLIDER_PAD   = 4;
const SLIDER_SPRING_RESET = { damping: 22, stiffness: 320, mass: 0.7 };

const sliderS = StyleSheet.create({
  track: {
    height: 60, borderRadius: 30, borderWidth: 1.5, marginBottom: 12,
    justifyContent: 'center', overflow: 'hidden',
  },
  fill: {
    position: 'absolute', top: 0, bottom: 0, left: 0,
    borderRadius: 30,
  },
  labelRow: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  labelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  thumb: {
    width: SLIDER_THUMB, height: SLIDER_THUMB, borderRadius: SLIDER_THUMB / 2,
    alignItems: 'center', justifyContent: 'center',
    position: 'absolute', left: SLIDER_PAD,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 5,
  },
});

const SliderButton = React.memo(React.forwardRef(({ onConfirm, label = 'Deslizá para confirmar', color, disabled = false }, ref) => {
  const onConfirmRef = useRef(onConfirm);
  const translateX = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const startX = useSharedValue(0);
  const dragging = useSharedValue(0);
  const confirmed = useSharedValue(false);
  const disabledSV = useSharedValue(disabled);

  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { disabledSV.value = disabled; }, [disabled, disabledSV]);

  const maxTravel = useDerivedValue(() =>
    Math.max(1, trackWidth.value - SLIDER_THUMB - SLIDER_PAD * 2),
  );

  const triggerConfirm = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    onConfirmRef.current?.();
  }, []);

  React.useImperativeHandle(ref, () => ({
    reset: () => {
      confirmed.value = false;
      dragging.value = 0;
      translateX.value = withSpring(0, SLIDER_SPRING_RESET);
    },
  }));

  const panGesture = useMemo(() => Gesture.Pan()
    .activeOffsetX([-6, 6])
    .failOffsetY([-12, 12])
    .onBegin(() => {
      if (disabledSV.value || confirmed.value) return;
      dragging.value = 1;
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      if (disabledSV.value || confirmed.value) return;
      const max = maxTravel.value;
      translateX.value = Math.max(0, Math.min(startX.value + e.translationX, max));
    })
    .onEnd((e) => {
      if (disabledSV.value || confirmed.value) {
        dragging.value = 0;
        return;
      }
      dragging.value = 0;
      const max = maxTravel.value;
      const progress = max > 0 ? translateX.value / max : 0;
      const flickConfirm = e.velocityX > 700 && progress >= 0.45;
      if (progress >= 0.72 || flickConfirm) {
        confirmed.value = true;
        translateX.value = withTiming(max, { duration: 120 }, (finished) => {
          if (finished) runOnJS(triggerConfirm)();
        });
      } else {
        translateX.value = withSpring(0, SLIDER_SPRING_RESET);
      }
    })
    .onFinalize((_e, success) => {
      dragging.value = 0;
      if (!success && !confirmed.value && !disabledSV.value) {
        translateX.value = withSpring(0, SLIDER_SPRING_RESET);
      }
    }),
  [disabledSV, confirmed, dragging, maxTravel, startX, translateX, triggerConfirm]);

  const btnColor = color || colors.danger;

  const trackStyle = useAnimatedStyle(() => ({
    opacity: disabledSV.value ? 0.45 : 1,
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: Math.max(trackWidth.value, 1),
    backgroundColor: btnColor,
    opacity: 0.32,
    transform: [{
      translateX: interpolate(
        translateX.value,
        [0, maxTravel.value],
        [-Math.max(trackWidth.value, 1), 0],
        Extrapolation.CLAMP,
      ),
    }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, maxTravel.value * 0.45],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: btnColor,
    transform: [
      { translateX: translateX.value },
      { scale: interpolate(dragging.value, [0, 1], [1, 1.06], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        onLayout={(e) => { trackWidth.value = e.nativeEvent.layout.width; }}
        style={[
          sliderS.track,
          { backgroundColor: `${btnColor}18`, borderColor: `${btnColor}45` },
          trackStyle,
        ]}
      >
        <Animated.View pointerEvents="none" style={[sliderS.fill, fillStyle]} />
        <Animated.View style={[sliderS.labelRow, labelStyle]} pointerEvents="none">
          <MaterialCommunityIcons name="chevron-double-right" size={16} color={btnColor} />
          <Text style={[sliderS.labelText, { color: btnColor }]}>{label}</Text>
          <MaterialCommunityIcons name="chevron-double-right" size={16} color={`${btnColor}55`} />
        </Animated.View>
        <Animated.View style={[sliderS.thumb, thumbStyle]} pointerEvents="none">
          <MaterialCommunityIcons name="flag-checkered" size={22} color="#fff" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}));

const ActiveTripScreen = () => {
  const DEFAULT_TARIFF_PER_KM = 600;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef(null);
  const timerRef = useRef(null);
  const sliderRef = useRef(null);
  const routeFetched = useRef(false);
  const lastRouteKeyRef = useRef('');
  const lastRerouteAtRef = useRef(0);
  const rerouteInFlightRef = useRef(false);
  const rerouteEvalStateRef = useRef(createInitialRerouteEvalState());
  const fareRouteKeyRef = useRef('');
  // Ref que mantiene las routeCoords actuales para que fetchNavigationRoute
  // pueda leerlas sin agregarlas como dependencia del useCallback.
  const routeCoordsRef = useRef([]);
  const autocompleteTimerRef = useRef(null);
  const navProgressRef = useRef(createInitialNavigationProgressState());
  const trafficRefreshTimerRef = useRef(null);
  const lastTrafficRefreshAtRef = useRef(0);
  const finishTripInFlightRef = useRef(false);

  const { activeTrip, tripTimer, tripDistanceKm, setTripTimer, addTripDistance, clearActiveTrip } = useTripStore();
  const session = useAuthStore((s) => s.session);
  const { updateTripStatus } = useTrips();
  const { startTracking, stopTracking, startNavigationWatch, stopNavigationWatch } = useLocation();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const heading = useLocationStore((s) => s.heading);
  const speed = useLocationStore((s) => s.speed);

  const {
    isMuted,
    toggleMute,
    announceManeuver,
    announceReroute,
    announcePickupArrival,
    announceDestinationArrival,
    resetAnnouncements,
  } = useVoiceNavigation();

  const [routePolyline, setRoutePolyline] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [completedTrip, setCompletedTrip] = useState(null);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [finishingTrip, setFinishingTrip] = useState(false);
  const [showCancelledModal, setShowCancelledModal] = useState(false);
  const [cancelledReason, setCancelledReason] = useState('');
  const [tariffInfo, setTariffInfo] = useState({ base: 0, perKm: 0, commission: 0 });
  const [tariffLoaded, setTariffLoaded] = useState(false);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState(null);
  const [remainingDurationSeconds, setRemainingDurationSeconds] = useState(null);
  const [nextStepInfo, setNextStepInfo] = useState(null);
  const [isRerouting, setIsRerouting] = useState(false);
  const [fareRouteDistanceKm, setFareRouteDistanceKm] = useState(null);

  // Local flow step
  const [flowStep, setFlowStep] = useState(FLOW_STEP.GOING_TO_PICKUP);

  // Destination state
  const [destinationSet, setDestinationSet] = useState(false);
  const [destinationOptions, setDestinationOptions] = useState([]);
  const [isFreeRide, setIsFreeRide] = useState(false);
  const [isNorth3DEnabled, setIsNorth3DEnabled] = useState(true);
  const [textDestInput, setTextDestInput] = useState('');
  const [textDestProcessing, setTextDestProcessing] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [accumulatedLegs, setAccumulatedLegs] = useState([]);

  const snapPoints = useMemo(() => ['24%', '68%', '90%'], []);
  const mapControlsBottomOffset = useMemo(() => Math.max(136, Math.round(SCREEN_HEIGHT * 0.2)), []);

  // Derive initial flow step from DB status
  useEffect(() => {
    if (!activeTrip) return;
    if (activeTrip.status === TRIP_STATUS.IN_PROGRESS) {
      setFlowStep(FLOW_STEP.IN_PROGRESS);
      setDestinationSet(true);
    } else if (activeTrip.status === TRIP_STATUS.GOING_TO_PICKUP || activeTrip.status === TRIP_STATUS.ACCEPTED) {
      setFlowStep(FLOW_STEP.GOING_TO_PICKUP);
      setDestinationSet(false);
    }
  }, [activeTrip?.id, activeTrip?.status]);

  // When the trip is cancelled by the passenger, show custom modal
  useEffect(() => {
    if (activeTrip?.status !== TRIP_STATUS.CANCELLED) return;
    setCancelledReason(activeTrip.cancel_reason || 'El pasajero canceló el viaje.');
    setShowCancelledModal(true);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
  }, [activeTrip?.status]);

  useEffect(() => {
    if (!bottomSheetRef.current) return;
    if (flowStep === FLOW_STEP.SET_DESTINATION && !destinationSet) {
      // Abrir bien arriba para que el teclado no tape el input
      bottomSheetRef.current.snapToIndex(2);
    } else if (flowStep === FLOW_STEP.CHOOSE_DEST_MODE) {
      bottomSheetRef.current.snapToIndex(1);
    } else {
      bottomSheetRef.current.snapToIndex(0);
    }
  }, [flowStep, destinationSet, activeTrip?.id]);

  useEffect(() => {
    // Cada viaje inicia con modo 3D Norte-arriba activo por defecto.
    setIsNorth3DEnabled(true);
  }, [activeTrip?.id]);

  useEffect(() => {
    // Evita arrastrar modo "viaje libre" entre viajes distintos.
    setIsFreeRide(false);
  }, [activeTrip?.id]);

  // Fetch tariff según tipo de viaje (WhatsApp vs plataforma)
  useEffect(() => {
    if (!activeTrip?.id) return undefined;

    let cancelled = false;
    const loadTariff = async () => {
      try {
        const tariff = await fetchTariffForTrip(supabase, activeTrip, { defaultPerKm: DEFAULT_TARIFF_PER_KM });
        if (cancelled) return;
        setTariffInfo({
          base: tariff.base,
          perKm: tariff.perKm,
          commission: tariff.commission,
        });
      } catch (e) {
        console.warn('Error fetching tariff:', e);
        if (!cancelled) {
          setTariffInfo((prev) => ({ ...prev, perKm: prev.perKm > 0 ? prev.perKm : DEFAULT_TARIFF_PER_KM }));
        }
      } finally {
        if (!cancelled) setTariffLoaded(true);
      }
    };

    setTariffLoaded(false);
    loadTariff();
    return () => { cancelled = true; };
  }, [activeTrip?.id, activeTrip?.notes]);

  // Start tracking
  useEffect(() => {
    if (!activeTrip) {
      navigation.goBack();
      return;
    }
    startTracking(activeTrip.id);
    startNavigationWatch();
    return () => {
      stopTracking();
      stopNavigationWatch();
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeTrip?.id]);

  // Reset route when routing-relevant trip data changes.
  // Voice announcements only reset when the navigation endpoints actually change
  // (trip id, origin, destination) to avoid re-announcing the same maneuver when
  // flowStep or destinationSet toggle without changing the route.
  const routeResetKeyRef = useRef('');
  useEffect(() => {
    routeFetched.current = false;
    lastRouteKeyRef.current = '';
    lastRerouteAtRef.current = 0;
    rerouteInFlightRef.current = false;
    rerouteEvalStateRef.current = createInitialRerouteEvalState();
    navProgressRef.current = createInitialNavigationProgressState();
    lastTrafficRefreshAtRef.current = 0;
    setIsRerouting(false);
    setRoutePolyline(null);
    setRouteInfo(null);
    setRouteSteps([]);
    setRemainingDistanceMeters(null);
    setRemainingDurationSeconds(null);
    setNextStepInfo(null);

    const newRouteKey = [
      activeTrip?.id,
      activeTrip?.origin_lat,
      activeTrip?.origin_lng,
      activeTrip?.destination_lat,
      activeTrip?.destination_lng,
    ].join('|');

    if (newRouteKey !== routeResetKeyRef.current) {
      routeResetKeyRef.current = newRouteKey;
      resetAnnouncements();
    }
  }, [
    activeTrip?.id,
    activeTrip?.origin_lat,
    activeTrip?.origin_lng,
    activeTrip?.destination_lat,
    activeTrip?.destination_lng,
    activeTrip?.notes,
    flowStep,
    destinationSet,
    resetAnnouncements,
  ]);

  // La tarifa fija depende solo de los endpoints del tramo (origen/destino),
  // no del paso UI. Si cambia alguno, se invalida y se vuelve a calcular.
  useEffect(() => {
    setFareRouteDistanceKm(null);
    fareRouteKeyRef.current = '';
  }, [
    activeTrip?.id,
    activeTrip?.origin_lat,
    activeTrip?.origin_lng,
    activeTrip?.destination_lat,
    activeTrip?.destination_lng,
  ]);

  const fetchNavigationRoute = useCallback(async (forceRefresh = false) => {
    if (!activeTrip || !currentLocation) return;

    try {
      const { point: pickupPoint } = resolvePickupPoint(activeTrip, currentLocation);
      // Snap the origin to the existing polyline (if loaded) so the new route
      // always departs from the road, not from a sidewalk GPS position.
      const origin = snapOriginToRoute(currentLocation.lat, currentLocation.lng, routeCoordsRef.current);
      const destination = (flowStep === FLOW_STEP.IN_PROGRESS || destinationSet)
        ? {
          lat: parseFloat(activeTrip.destination_lat),
          lng: parseFloat(activeTrip.destination_lng),
        }
        : {
          lat: parseFloat(pickupPoint?.lat),
          lng: parseFloat(pickupPoint?.lng),
        };

      if (!Number.isFinite(origin.lat) || !Number.isFinite(origin.lng)) return;
      if (!Number.isFinite(destination.lat) || !Number.isFinite(destination.lng)) return;

      const routeKey = [
        activeTrip.id,
        flowStep,
        destinationSet ? '1' : '0',
        Number(destination.lat).toFixed(6),
        Number(destination.lng).toFixed(6),
      ].join('|');

      if (!forceRefresh && routeFetched.current && lastRouteKeyRef.current === routeKey) {
        return;
      }

      const result = await getDirections(origin, destination);
      setRoutePolyline(result.polyline);
      setRouteInfo({
        distance: result.distance,
        duration: result.duration,
        distanceValue: result.distanceValue,
        durationValue: result.durationValue,
      });
      setRouteSteps(Array.isArray(result.steps) ? result.steps : []);
      routeFetched.current = true;
      lastRouteKeyRef.current = routeKey;
    } catch (error) {
      console.log('Error fetching route:', error);
    }
  }, [
    activeTrip,
    currentLocation,
    flowStep,
    destinationSet,
  ]);

  const triggerAdaptiveReroute = useCallback(async (reason, cooldownMs = 5000) => {
    const now = Date.now();
    const minCooldownMs = Number.isFinite(cooldownMs)
      ? Math.max(1500, Number(cooldownMs))
      : 5000;

    if (rerouteInFlightRef.current) return;
    if (now - lastRerouteAtRef.current < minCooldownMs) return;

    rerouteInFlightRef.current = true;
    setIsRerouting(true);
    lastRerouteAtRef.current = now;

    announceReroute();

    try {
      await fetchNavigationRoute(true);
      rerouteEvalStateRef.current = createInitialRerouteEvalState();
      navProgressRef.current = createInitialNavigationProgressState();
      resetAnnouncements();
    } catch (error) {
      console.warn('Error recalculando ruta:', reason || error);
    } finally {
      rerouteInFlightRef.current = false;
      setIsRerouting(false);
    }
  }, [fetchNavigationRoute, announceReroute, resetAnnouncements]);

  useEffect(() => {
    fetchNavigationRoute();
  }, [fetchNavigationRoute]);

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

  const routeCoords = useMemo(
    () => (routePolyline ? decodePolyline(routePolyline) : []),
    [routePolyline]
  );

  const shouldUseFixedRouteFare = useMemo(() => {
    if (!destinationSet || isFreeRide) return false;
    const originLat = parseFloat(activeTrip?.origin_lat);
    const originLng = parseFloat(activeTrip?.origin_lng);
    const destLat = parseFloat(activeTrip?.destination_lat);
    const destLng = parseFloat(activeTrip?.destination_lng);
    return Number.isFinite(originLat)
      && Number.isFinite(originLng)
      && Number.isFinite(destLat)
      && Number.isFinite(destLng);
  }, [
    activeTrip?.origin_lat,
    activeTrip?.origin_lng,
    activeTrip?.destination_lat,
    activeTrip?.destination_lng,
    destinationSet,
    isFreeRide,
  ]);

  useEffect(() => {
    if (!activeTrip || !shouldUseFixedRouteFare) {
      setFareRouteDistanceKm(null);
      fareRouteKeyRef.current = '';
      return;
    }

    const origin = {
      lat: parseFloat(activeTrip.origin_lat),
      lng: parseFloat(activeTrip.origin_lng),
    };
    const destination = {
      lat: parseFloat(activeTrip.destination_lat),
      lng: parseFloat(activeTrip.destination_lng),
    };

    const fareKey = [
      activeTrip.id,
      Number(origin.lat).toFixed(6),
      Number(origin.lng).toFixed(6),
      Number(destination.lat).toFixed(6),
      Number(destination.lng).toFixed(6),
    ].join('|');

    if (fareRouteKeyRef.current === fareKey) return;
    fareRouteKeyRef.current = fareKey;

    let cancelled = false;

    const fetchFareRouteDistance = async () => {
      try {
        const result = await getDirections(origin, destination);
        if (cancelled) return;

        const parsedKm = parseRouteDistanceKm({
          distanceValue: result?.distanceValue,
          distance: result?.distance,
        });

        setFareRouteDistanceKm(Number.isFinite(parsedKm) && parsedKm > 0 ? parsedKm : null);
      } catch (error) {
        if (cancelled) return;
        console.warn('Error fetching fare route:', error);
        setFareRouteDistanceKm(null);
        fareRouteKeyRef.current = '';
      }
    };

    fetchFareRouteDistance();

    return () => {
      cancelled = true;
    };
  }, [
    activeTrip?.id,
    activeTrip?.origin_lat,
    activeTrip?.origin_lng,
    activeTrip?.destination_lat,
    activeTrip?.destination_lng,
    shouldUseFixedRouteFare,
  ]);

  // Keep ref in sync so fetchNavigationRoute can read routeCoords without
  // adding it to the useCallback dependency array.
  useEffect(() => { routeCoordsRef.current = routeCoords; }, [routeCoords]);

  const effectiveTariffPerKm = useMemo(() => {
    const kmRate = Number(tariffInfo.perKm);
    return Number.isFinite(kmRate) && kmRate > 0 ? kmRate : DEFAULT_TARIFF_PER_KM;
  }, [tariffInfo.perKm]);

  const fixedRouteTotalPrice = useMemo(() => {
    if (!tariffLoaded || !shouldUseFixedRouteFare || !Number.isFinite(fareRouteDistanceKm)) return null;
    return Math.round(tariffInfo.base + effectiveTariffPerKm * fareRouteDistanceKm);
  }, [tariffLoaded, shouldUseFixedRouteFare, effectiveTariffPerKm, fareRouteDistanceKm, tariffInfo.base]);

  const confirmedPassengerFare = useMemo(
    () => (isFreeRide ? null : resolveConfirmedPassengerFare(activeTrip)),
    [
      activeTrip?.notes,
      activeTrip?.price,
      activeTrip?.distance_km,
      activeTrip?.commission_amount,
      isFreeRide,
    ],
  );

  const checkoutDistanceKm = useMemo(() => {
    if (confirmedPassengerFare) return confirmedPassengerFare.distanceKm;
    if (shouldUseFixedRouteFare && Number.isFinite(fareRouteDistanceKm) && fareRouteDistanceKm > 0) {
      return fareRouteDistanceKm;
    }
    return tripDistanceKm;
  }, [confirmedPassengerFare, shouldUseFixedRouteFare, fareRouteDistanceKm, tripDistanceKm]);

  const checkoutTotalPrice = useMemo(() => {
    if (confirmedPassengerFare) return confirmedPassengerFare.price;
    if (Number.isFinite(fixedRouteTotalPrice) && fixedRouteTotalPrice > 0) return fixedRouteTotalPrice;
    if (Number.isFinite(checkoutDistanceKm) && checkoutDistanceKm > 0) {
      return Math.round(tariffInfo.base + effectiveTariffPerKm * checkoutDistanceKm);
    }
    return livePrice;
  }, [
    confirmedPassengerFare,
    fixedRouteTotalPrice,
    checkoutDistanceKm,
    effectiveTariffPerKm,
    tariffInfo.base,
    livePrice,
  ]);

  const grandTotalDistanceKm = useMemo(() =>
    accumulatedLegs.reduce((s, l) => s + (l.distanceKm || 0), 0) + (checkoutDistanceKm || 0),
    [accumulatedLegs, checkoutDistanceKm]
  );

  const grandTotalPrice = useMemo(() =>
    accumulatedLegs.reduce((s, l) => s + (l.price || 0), 0) + (checkoutTotalPrice || 0),
    [accumulatedLegs, checkoutTotalPrice]
  );

  useEffect(() => {
    if (!currentLocation || routeCoords.length === 0) return;

    const navPoint = {
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
    };
    const speedMps = Number.isFinite(currentLocation.speed)
      ? Number(currentLocation.speed)
      : (Number.isFinite(speed) ? Number(speed) : 0);

    const snapshot = computeNavigationSnapshot({
      currentPoint: navPoint,
      routeCoords,
      steps: routeSteps,
      progressState: navProgressRef.current,
      speedMps,
      routeDistanceMeters: Number(routeInfo?.distanceValue) || 0,
      routeDurationSeconds: Number(routeInfo?.durationValue) || 0,
      accuracyMeters: currentLocation.accuracy,
    });

    navProgressRef.current = snapshot.progressState;
    setRemainingDistanceMeters(snapshot.remainingDistanceMeters);
    setRemainingDurationSeconds(snapshot.remainingDurationSeconds);

    const step = snapshot.currentStep
      ? { ...snapshot.currentStep, distanceToStepMeters: snapshot.currentStep.distanceToStepMeters }
      : null;
    setNextStepInfo(step);

    if (step && Number.isFinite(step.distanceToStepMeters)) {
      announceManeuver(step, step.distanceToStepMeters);
    }
    if (Number.isFinite(snapshot.remainingDistanceMeters) && snapshot.remainingDistanceMeters <= 40) {
      announceDestinationArrival();
    }
  }, [
    currentLocation,
    routeCoords,
    routeInfo?.distanceValue,
    routeInfo?.durationValue,
    routeSteps,
    speed,
    announceManeuver,
    announceDestinationArrival,
  ]);

  // Refresca tráfico/ETA periódicamente mientras hay navegación activa.
  useEffect(() => {
    const isNavigating = flowStep === FLOW_STEP.GOING_TO_PICKUP || flowStep === FLOW_STEP.IN_PROGRESS;
    if (!isNavigating || !routePolyline) return undefined;

    trafficRefreshTimerRef.current = setInterval(() => {
      const now = Date.now();
      const speedMps = Number(currentLocation?.speed) || Number(speed) || 0;
      if (speedMps < 1 || rerouteInFlightRef.current) return;
      if (now - lastTrafficRefreshAtRef.current < 180000) return;

      lastTrafficRefreshAtRef.current = now;
      fetchNavigationRoute(true);
    }, 60000);

    return () => {
      if (trafficRefreshTimerRef.current) {
        clearInterval(trafficRefreshTimerRef.current);
        trafficRefreshTimerRef.current = null;
      }
    };
  }, [flowStep, routePolyline, currentLocation?.speed, speed, fetchNavigationRoute]);

  useEffect(() => {
    if (!currentLocation || routeCoords.length < 2) return;
    if (Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters <= 45) return;

    const currentPoint = {
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
    };
    const projection = projectPointOntoPolyline(currentPoint, routeCoords);
    const deviationMeters = projection.deviationMeters;

    const speedMps = Number.isFinite(currentLocation.speed)
      ? Number(currentLocation.speed)
      : (Number.isFinite(speed) ? Number(speed) : 0);

    const evaluation = evaluateRerouteState({
      deviationMeters,
      speedMps,
      accuracyMeters: currentLocation.accuracy,
      distanceToNextStepMeters: nextStepInfo?.distanceToStepMeters,
      state: rerouteEvalStateRef.current,
    });

    rerouteEvalStateRef.current = evaluation.state;

    if (evaluation.shouldReroute) {
      triggerAdaptiveReroute(
        evaluation.rerouteReason,
        evaluation.thresholds.cooldownMs,
      );
    }
  }, [
    currentLocation,
    routeCoords,
    speed,
    nextStepInfo?.distanceToStepMeters,
    remainingDistanceMeters,
    triggerAdaptiveReroute,
  ]);

  // Distance to pickup
  const distanceToPickup = useMemo(() => {
    if (!currentLocation || !activeTrip) return null;
    const { point: pickupPoint } = resolvePickupPoint(activeTrip, currentLocation);
    const pickupLat = pickupPoint?.lat;
    const pickupLng = pickupPoint?.lng;
    if (!Number.isFinite(pickupLat) || !Number.isFinite(pickupLng)) return null;
    return haversineMeters(
      currentLocation.lat, currentLocation.lng,
      pickupLat, pickupLng
    );
  }, [currentLocation, activeTrip?.origin_lat, activeTrip?.origin_lng, activeTrip?.destination_lat, activeTrip?.destination_lng, activeTrip?.notes]);

  // Anuncio de voz al acercarse al punto de encuentro (< 50 m)
  useEffect(() => {
    if (flowStep !== FLOW_STEP.GOING_TO_PICKUP) return;
    if (!Number.isFinite(distanceToPickup)) return;
    if (distanceToPickup <= 50) {
      announcePickupArrival();
    }
  }, [flowStep, distanceToPickup, announcePickupArrival]);

  // Preview de la maniobra siguiente a la actual (la que viene después)
  const nextNextStepInfo = useMemo(() => {
    if (!nextStepInfo || !Array.isArray(routeSteps) || routeSteps.length === 0) return null;
    const idx = Number.isFinite(nextStepInfo.index) ? nextStepInfo.index : -1;
    if (idx < 0 || idx + 1 >= routeSteps.length) return null;
    return routeSteps[idx + 1];
  }, [nextStepInfo, routeSteps]);

  // ============================
  //  STEP HANDLERS
  // ============================

  // Step 1 -> Step 2: Confirm arrived at pickup
  const handleConfirmArrival = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFlowStep(FLOW_STEP.AT_PICKUP);
  }, []);

  // Abre Google Maps externo con navegación turn-by-turn.
  // - Android: google.navigation arranca directo sin pantalla de overview (entry=fnls)
  // - iOS: comgooglemaps con modo driving
  // - Fallback: web con destino y nombre
  const handleOpenGoogleMapsNav = useCallback((destLat, destLng, destAddress) => {
    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) return;
    const label = destAddress ? encodeURIComponent(destAddress) : `${destLat},${destLng}`;
    const coordDest = `${destLat},${destLng}`;
    const oLat = currentLocation?.latitude;
    const oLng = currentLocation?.longitude;
    const hasOrigin = Number.isFinite(oLat) && Number.isFinite(oLng);
    let url;
    if (Platform.OS === 'android') {
      // entry=fnls = salta overview y arranca navegación inmediatamente
      url = `google.navigation:q=${coordDest}&mode=d&entry=fnls`;
    } else {
      const origin = hasOrigin ? `saddr=${oLat},${oLng}&` : '';
      url = `comgooglemaps://?${origin}daddr=${coordDest}&directionsmode=driving`;
    }
    Linking.canOpenURL(url).then((supported) => {
      if (supported) {
        Linking.openURL(url);
      } else {
        const originParam = hasOrigin ? `&origin=${oLat},${oLng}` : '';
        Linking.openURL(
          `https://www.google.com/maps/dir/?api=1${originParam}&destination=${coordDest}&destination_place_id=&travelmode=driving`,
        );
      }
    });
  }, [currentLocation]);

  // Share real-time tracking link via WhatsApp
  const handleShareTracking = useCallback(() => {
    if (!activeTrip?.tracking_token) return;
    const url = `${TRACKING_BASE_URL}/seguimiento/${activeTrip.tracking_token}`;
    const firstName = activeTrip.passenger_name
      ? ` ${activeTrip.passenger_name.split(' ')[0]}`
      : '';
    const msg =
      `Hola${firstName}! Tu chofer está en camino. Seguí el viaje en tiempo real:\n${url}`;
    Linking.openURL(`whatsapp://send?text=${encodeURIComponent(msg)}`).catch(() =>
      Linking.openURL(`https://wa.me/?text=${encodeURIComponent(msg)}`),
    );
  }, [activeTrip?.tracking_token, activeTrip?.passenger_name]);

  // Step 2 -> Step 3 (or skip to Step 4 if destination already set by dashboard or preloaded from notes)
  const handlePassengerAboard = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const { isApproachOnly: isApproachOnlyTrip } = resolvePickupPoint(activeTrip, currentLocation);

    if (activeTrip?.id) {
      const pickupUpdates = {
        pickup_at: new Date().toISOString(),
      };

      const isPassengerAppTrip = String(activeTrip?.notes || '').includes('[PASSENGER_APP]');
      if (isApproachOnlyTrip && !isPassengerAppTrip) {
        const pickupLat = parseFloat(activeTrip.destination_lat);
        const pickupLng = parseFloat(activeTrip.destination_lng);
        const pickupAddress = activeTrip.destination_address;

        if (Number.isFinite(pickupLat) && Number.isFinite(pickupLng)) {
          pickupUpdates.origin_address = pickupAddress;
          pickupUpdates.origin_lat = pickupLat;
          pickupUpdates.origin_lng = pickupLng;
        }
      }

      // Sync in background so a slow network update never blocks the local flow.
      supabase
        .from('trips')
        .update(pickupUpdates)
        .eq('id', activeTrip.id)
        .select()
        .single()
        .then(({ data: updatedTrip, error }) => {
          if (!error && updatedTrip) {
            useTripStore.getState().updateActiveTrip(updatedTrip);
          }
        })
        .catch((err) => {
          console.warn('Error syncing pickup info:', err);
        });

      useTripStore.getState().updateActiveTrip(pickupUpdates);
    }

    // Verificar si el destino final fue precargado por el pasajero vía WhatsApp
    const preloadedDest = parsePreloadedDestination(activeTrip?.notes);

    // Si ya hay un destino precargado desde WhatsApp, auto-setearlo sin pasar por voz
    if (preloadedDest) {
      try {
        const { data: updatedTrip, error } = await supabase
          .from('trips')
          .update({
            destination_address: preloadedDest.address,
            destination_lat: preloadedDest.lat,
            destination_lng: preloadedDest.lng,
          })
          .eq('id', activeTrip.id)
          .select()
          .single();

        if (!error && updatedTrip) {
          useTripStore.getState().updateActiveTrip(updatedTrip);
        }

        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        Toast.show({
          type: 'success',
          text1: 'Destino cargado automáticamente',
          text2: preloadedDest.address,
          visibilityTime: 4000,
        });

        setDestinationSet(true);
        setFlowStep(FLOW_STEP.IN_PROGRESS);
        updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
        return;
      } catch (err) {
        console.warn('Error aplicando destino precargado:', err);
        // Si falla, continuar al flujo normal de voz
      }
    }

    // If the dashboard already set a destination, skip to in progress
    if (!isApproachOnlyTrip && activeTrip?.destination_lat && activeTrip?.destination_lng) {
      setDestinationSet(true);
      setFlowStep(FLOW_STEP.IN_PROGRESS);
      updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
    } else {
      setFlowStep(FLOW_STEP.CHOOSE_DEST_MODE);
    }
  }, [activeTrip, currentLocation]);

  // Autocomplete en tiempo real: se dispara cada vez que el usuario escribe,
  // con un debounce de 350 ms para no saturar la API.
  useEffect(() => {
    if (flowStep !== FLOW_STEP.SET_DESTINATION || destinationSet) return;
    const query = textDestInput.trim();
    if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current);
    if (query.length < 3) {
      setDestinationOptions([]);
      setTextDestProcessing(false);
      return;
    }
    setTextDestProcessing(true);
    autocompleteTimerRef.current = setTimeout(async () => {
      try {
        const results = await autocompleteAddressSalta(query, 6);
        setDestinationOptions(results);
      } catch {
        setDestinationOptions([]);
      } finally {
        setTextDestProcessing(false);
      }
    }, 350);
    return () => { if (autocompleteTimerRef.current) clearTimeout(autocompleteTimerRef.current); };
  }, [textDestInput, flowStep, destinationSet]);

  // Step 3: Text destination search (manual fallback via teclado)
  const handleTextDestSearch = useCallback(async () => {
    if (!textDestInput.trim() || textDestProcessing) return;
    // Seleccionar automáticamente el primer resultado si ya hay opciones
    if (destinationOptions.length > 0) {
      await selectDestination(destinationOptions[0]);
    }
  }, [textDestInput, textDestProcessing, destinationOptions, selectDestination]);

  // Free ride: start without a preset destination, calculate fare by GPS km
  const handleChooseFreeRide = useCallback(async () => {
    if (!activeTrip) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setIsFreeRide(true);
    setDestinationSet(true);
    setFlowStep(FLOW_STEP.IN_PROGRESS);
    await updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
  }, [activeTrip, updateTripStatus]);

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
    if (!activeTrip || finishingTrip) return;
    setShowFinishModal(true);
  }, [activeTrip, finishingTrip]);

  // Agregar otro destino: guarda el tramo actual y vuelve al selector de destino
  const handleAddAnotherDestination = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setAccumulatedLegs(prev => [...prev, {
      distanceKm: checkoutDistanceKm || 0,
      price: checkoutTotalPrice || 0,
      address: activeTrip?.destination_address || 'Destino',
    }]);
    setDestinationSet(false);
    setTextDestInput('');
    setDestinationOptions([]);
    setRoutePolyline(null);
    setRouteInfo(null);
    setRouteSteps([]);
    routeFetched.current = false;
    lastRouteKeyRef.current = '';
    navProgressRef.current = createInitialNavigationProgressState();
    setFlowStep(FLOW_STEP.CHOOSE_DEST_MODE);
  }, [activeTrip, checkoutDistanceKm, checkoutTotalPrice]);

  const handleConfirmFinishTrip = useCallback(async () => {
    if (!activeTrip || finishingTrip || finishTripInFlightRef.current) return;
    finishTripInFlightRef.current = true;
    try {
      setFinishingTrip(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const accumulatedDistanceKm = accumulatedLegs.reduce((sum, leg) => {
        const legDistance = Number(leg?.distanceKm);
        return sum + (Number.isFinite(legDistance) ? legDistance : 0);
      }, 0);
      const accumulatedPrice = accumulatedLegs.reduce((sum, leg) => {
        const legPrice = Number(leg?.price);
        return sum + (Number.isFinite(legPrice) ? legPrice : 0);
      }, 0);

      let currentLegDistanceKm = Number(checkoutDistanceKm);
      if (!Number.isFinite(currentLegDistanceKm) || currentLegDistanceKm < 0) {
        currentLegDistanceKm = 0;
      }

      let currentLegPrice = Number(checkoutTotalPrice);
      if (!Number.isFinite(currentLegPrice) || currentLegPrice < 0) {
        currentLegPrice = 0;
      }

      // Fallback de seguridad: si el destino está definido pero el tramo quedó
      // en 0 km (por race condition o fetch fallido), recalcular antes de cerrar.
      const needsFixedFareFallback = shouldUseFixedRouteFare && !confirmedPassengerFare && (
        currentLegDistanceKm <= 0 || currentLegPrice <= 0
      );

      if (needsFixedFareFallback) {
        const origin = {
          lat: parseFloat(activeTrip.origin_lat),
          lng: parseFloat(activeTrip.origin_lng),
        };
        const destination = {
          lat: parseFloat(activeTrip.destination_lat),
          lng: parseFloat(activeTrip.destination_lng),
        };

        if (
          Number.isFinite(origin.lat)
          && Number.isFinite(origin.lng)
          && Number.isFinite(destination.lat)
          && Number.isFinite(destination.lng)
        ) {
          let fallbackDistanceKm = Number.isFinite(fareRouteDistanceKm) && fareRouteDistanceKm > 0
            ? fareRouteDistanceKm
            : null;

          if (!fallbackDistanceKm) {
            try {
              const result = await getDirections(origin, destination);
              const parsedKm = parseRouteDistanceKm({
                distanceValue: result?.distanceValue,
                distance: result?.distance,
              });
              if (Number.isFinite(parsedKm) && parsedKm > 0) {
                fallbackDistanceKm = parsedKm;
              }
            } catch (error) {
              console.warn('Error recalculating fixed fare route on finish:', error);
            }
          }

          if (!fallbackDistanceKm) {
            const routeMeters = Number(routeInfo?.distanceValue);
            if (Number.isFinite(routeMeters) && routeMeters > 0) {
              fallbackDistanceKm = routeMeters / 1000;
            }
          }

          if (Number.isFinite(fallbackDistanceKm) && fallbackDistanceKm > 0) {
            currentLegDistanceKm = fallbackDistanceKm;
            currentLegPrice = Math.round(tariffInfo.base + effectiveTariffPerKm * fallbackDistanceKm);
            setFareRouteDistanceKm(fallbackDistanceKm);
          }
        }
      }

      const distanceKm = Math.round((accumulatedDistanceKm + currentLegDistanceKm) * 10) / 10;
      const totalPrice = Math.round(accumulatedPrice + currentLegPrice);
      const commissionAmount = calculateTripCommission({
        price: totalPrice,
        commissionPercent: tariffInfo.commission,
      });

      const result = await updateTripStatus(activeTrip.id, TRIP_STATUS.COMPLETED, {
        distance_km: distanceKm,
        price: totalPrice,
        commission_amount: commissionAmount,
      });

      if (result.success) {
        setShowFinishModal(false);
        stopTracking();
        if (timerRef.current) clearInterval(timerRef.current);
        setCompletedTrip(result.data);
        setShowSummary(true);

        // Enviar resumen de tarifa por WhatsApp al pasajero vía WaSender
        const passengerPhone = String(activeTrip.passenger_phone || '').replace(/\D/g, '');
        const jwt = session?.access_token || '';
        if (passengerPhone && jwt) {
          const passengerFirst = activeTrip.passenger_name
            ? ` ${activeTrip.passenger_name.split(' ')[0]}`
            : '';
          const waMsg =
            `¡Hola${passengerFirst}! Gracias por viajar con nosotros 🚗\n\n` +
            `*Resumen de tu viaje:*\n` +
            `📍 Distancia: *${formatDistance(distanceKm)}*\n` +
            `💰 Total a abonar: *${formatPrice(totalPrice)}*\n\n` +
            `¡Que tengas un excelente día!`;
          fetch(NOTIFY_PASSENGER_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${jwt}`,
            },
            body: JSON.stringify({
              phone: passengerPhone,
              message: waMsg,
              tripId: activeTrip.id,
            }),
          }).catch((err) => console.warn('Error enviando WhatsApp al pasajero:', err));
        }
      }
    } finally {
      finishTripInFlightRef.current = false;
      setFinishingTrip(false);
    }
  }, [
    activeTrip,
    finishingTrip,
    accumulatedLegs,
    checkoutDistanceKm,
    checkoutTotalPrice,
    confirmedPassengerFare,
    shouldUseFixedRouteFare,
    fareRouteDistanceKm,
    routeInfo?.distanceValue,
    effectiveTariffPerKm,
    tariffInfo.base,
    tariffInfo.commission,
    updateTripStatus,
    stopTracking,
  ]);

  // ============================
  //  STATUS PILL TEXT
  // ============================
  const getStatusInfo = () => {
    switch (flowStep) {
      case FLOW_STEP.GOING_TO_PICKUP: return { text: 'En camino al pasajero', color: colors.primary, step: 1 };
      case FLOW_STEP.AT_PICKUP: return { text: 'Confirmá pasajero a bordo', color: colors.warning, step: 2 };
      case FLOW_STEP.CHOOSE_DEST_MODE: return { text: 'Elegí el modo de destino', color: colors.info, step: 2 };
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
    const storedCommission = Number(completedTrip.commission_amount);
    const commissionAmount = Number.isFinite(storedCommission) && storedCommission >= 0
      ? Math.round(storedCommission)
      : calculateTripCommission({ price: finalPrice, commissionPercent: tariffInfo.commission });
    const commissionPct = finalPrice > 0
      ? Math.round((commissionAmount / finalPrice) * 1000) / 10
      : tariffInfo.commission;
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

  const isInProgress = flowStep === FLOW_STEP.IN_PROGRESS;
  const { point: pickupPoint, isApproachOnly: isApproachOnlyTrip } = resolvePickupPoint(activeTrip, currentLocation);
  const tripOriginPoint = {
    lat: parseFloat(activeTrip.origin_lat),
    lng: parseFloat(activeTrip.origin_lng),
    address: activeTrip.origin_address,
  };
  const hasTripOrigin = Number.isFinite(tripOriginPoint.lat) && Number.isFinite(tripOriginPoint.lng);
  const useTripOriginRoute = flowStep === FLOW_STEP.SET_DESTINATION || flowStep === FLOW_STEP.IN_PROGRESS || destinationSet;
  const maneuverPresentation = getManeuverPresentation(
    nextStepInfo?.maneuver,
    remainingDistanceMeters,
    nextStepInfo?.distanceToStepMeters,
  );
  const isArriving = Number.isFinite(remainingDistanceMeters) && remainingDistanceMeters <= 40;
  const directInstruction = buildDirectNavigationInstruction(nextStepInfo, remainingDistanceMeters);
  const navigationInstruction = directInstruction.primary || 'Seguí por la ruta marcada';
  const navigationDistanceText = isArriving
    ? 'Llegaste'
    : formatRemainingDistance(nextStepInfo?.distanceToStepMeters);
  const remainingDistanceText = formatRemainingDistance(remainingDistanceMeters);
  const etaText = formatEta(remainingDurationSeconds);
  const maneuverIcon = maneuverPresentation.icon;
  const totalRouteDistanceMeters = Number(routeInfo?.distanceValue) || 0;
  const traveledDistanceMeters = Number.isFinite(remainingDistanceMeters) && totalRouteDistanceMeters > 0
    ? Math.max(0, totalRouteDistanceMeters - remainingDistanceMeters)
    : 0;
  const progressRatio = totalRouteDistanceMeters > 0
    ? Math.max(0, Math.min(1, traveledDistanceMeters / totalRouteDistanceMeters))
    : 0;
  const progressPercent = Math.round(progressRatio * 100);
  const destinationPoint = {
    lat: parseFloat(activeTrip.destination_lat),
    lng: parseFloat(activeTrip.destination_lng),
    address: activeTrip.destination_address,
  };
  const hasDestinationPoint = Number.isFinite(destinationPoint.lat) && Number.isFinite(destinationPoint.lng);
  const shouldKeepPickupAsDestination =
    flowStep === FLOW_STEP.GOING_TO_PICKUP
    || flowStep === FLOW_STEP.AT_PICKUP
    || flowStep === FLOW_STEP.CHOOSE_DEST_MODE
    || (flowStep === FLOW_STEP.SET_DESTINATION && !hasDestinationPoint);

  // Map destination target based on step
  const mapOrigin = (useTripOriginRoute && hasTripOrigin) ? tripOriginPoint : pickupPoint;
  const mapDestination = shouldKeepPickupAsDestination
    ? pickupPoint
    : (hasDestinationPoint ? destinationPoint : null);

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      {/* ── Passenger cancelled modal ── */}
      <Modal
        visible={showCancelledModal}
        transparent
        animationType="fade"
        onRequestClose={() => {}}
        statusBarTranslucent
      >
        <View style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.72)',
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 28,
        }}>
          <View style={{
            backgroundColor: colors.surface,
            borderRadius: 24,
            paddingVertical: 32,
            paddingHorizontal: 28,
            width: '100%',
            alignItems: 'center',
            elevation: 24,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 8 },
            shadowOpacity: 0.28,
            shadowRadius: 16,
          }}>
            {/* Icon */}
            <View style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: '#FEE2E2',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 20,
            }}>
              <MaterialCommunityIcons name="car-off" size={36} color="#EF4444" />
            </View>

            <Text style={{
              color: colors.text,
              fontSize: 20,
              fontFamily: 'Inter_700Bold',
              textAlign: 'center',
              marginBottom: 10,
            }}>
              Viaje cancelado
            </Text>

            <Text style={{
              color: colors.textMuted,
              fontSize: 14,
              fontFamily: 'Inter_400Regular',
              textAlign: 'center',
              lineHeight: 20,
              marginBottom: 28,
            }}>
              {cancelledReason}
            </Text>

            {/* Divider */}
            <View style={{ width: '100%', height: 1, backgroundColor: colors.border, marginBottom: 20 }} />

            <TouchableOpacity
              onPress={() => {
                setShowCancelledModal(false);
                clearActiveTrip();
                navigation.navigate('Home');
              }}
              activeOpacity={0.82}
              style={{
                backgroundColor: colors.primary,
                borderRadius: 14,
                paddingVertical: 14,
                paddingHorizontal: 32,
                width: '100%',
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 15, fontFamily: 'Inter_700Bold' }}>
                Volver al inicio
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showFinishModal}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!finishingTrip) { setShowFinishModal(false); sliderRef.current?.reset(); } }}
      >
        <View style={s.finishModalBackdrop}>
          <View style={s.finishModalCard}>
            <View style={s.finishModalHeader}>
              <View style={s.finishModalIconWrap}>
                <MaterialCommunityIcons name="cash-check" size={18} color={colors.success} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.finishModalTitle}>Confirmar cobro y finalizar</Text>
                <Text style={s.finishModalSubtitle}>Verificá el pago antes de cerrar el viaje</Text>
              </View>
            </View>

            {accumulatedLegs.length > 0 && (
              <View style={s.finishModalLegsRow}>
                <MaterialCommunityIcons name="layers-triple-outline" size={14} color={colors.info} />
                <Text style={s.finishModalLegsText}>
                  {accumulatedLegs.length} tramo{accumulatedLegs.length !== 1 ? 's' : ''} acumulado{accumulatedLegs.length !== 1 ? 's' : ''} incluido{accumulatedLegs.length !== 1 ? 's' : ''}
                </Text>
              </View>
            )}

            <View style={s.finishModalInfoRow}>
              <Text style={s.finishModalInfoLabel}>Distancia total</Text>
              <Text style={s.finishModalInfoValue}>{formatDistance(grandTotalDistanceKm)}</Text>
            </View>

            <View style={s.finishModalTotalWrap}>
              <Text style={s.finishModalTotalLabel}>Costo total del viaje</Text>
              <Text style={s.finishModalTotalValue}>{formatPrice(grandTotalPrice)}</Text>
            </View>

            <View style={s.finishModalActions}>
              <TouchableOpacity
                style={[s.finishModalBtn, s.finishModalBtnGhost, finishingTrip && s.finishModalBtnDisabled]}
                onPress={() => { if (!finishingTrip) { setShowFinishModal(false); sliderRef.current?.reset(); } }}
                activeOpacity={0.8}
                disabled={finishingTrip}
              >
                <Text style={s.finishModalBtnGhostText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.finishModalBtn, s.finishModalBtnPrimary, finishingTrip && s.finishModalBtnDisabled]}
                onPress={handleConfirmFinishTrip}
                activeOpacity={0.85}
                disabled={finishingTrip}
              >
                {finishingTrip ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={s.finishModalBtnPrimaryText}>Confirmar pago</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Map */}
      <TripMap
        driverLocation={currentLocation}
        origin={mapOrigin}
        destination={mapDestination}
        polyline={routePolyline}
        heading={heading}
        navigationMode={isInProgress || flowStep === FLOW_STEP.GOING_TO_PICKUP}
        threeDEnabled={(isInProgress || flowStep === FLOW_STEP.GOING_TO_PICKUP) && isNorth3DEnabled}
        onToggleThreeD={() => setIsNorth3DEnabled((prev) => !prev)}
        onOpenGoogleMaps={() => {
          const dest =
            flowStep === FLOW_STEP.GOING_TO_PICKUP
              ? pickupPoint
              : (hasDestinationPoint ? destinationPoint : pickupPoint);
          if (dest?.lat != null) handleOpenGoogleMapsNav(dest.lat, dest.lng, dest.address);
        }}
        controlsBottomOffset={mapControlsBottomOffset}
        remainingDistanceMeters={remainingDistanceMeters}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[
        s.navigationCard,
        maneuverPresentation.isCritical ? s.navigationCardCritical : null,
        { top: insets.top + 8, borderColor: maneuverPresentation.border },
      ]}>
        <View style={s.navTopRow}>
          <View style={[s.navBadge, { backgroundColor: `${maneuverPresentation.tint}14` }]}>
            <MaterialCommunityIcons name="navigation-variant" size={12} color={maneuverPresentation.tint} />
            <Text style={[s.navBadgeText, { color: maneuverPresentation.tint }]}>
              {isRerouting ? 'Recalculando' : maneuverPresentation.shortLabel}
            </Text>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            {isRerouting && (
              <ActivityIndicator size="small" color={colors.primary} />
            )}
            <Text style={s.navEtaText}>
              {isArriving ? 'Llegada' : `${etaText} · ${formatArrivalClock(remainingDurationSeconds)}`}
            </Text>
          </View>
        </View>

        <View style={s.navMainRow}>
          <View style={[s.navIconBox, { backgroundColor: maneuverPresentation.background, borderColor: maneuverPresentation.border }]}>
            <MaterialCommunityIcons name={maneuverIcon} size={32} color={maneuverPresentation.tint} />
          </View>
          <View style={s.navDistanceCol}>
            <Text style={[s.navDistanceText, { color: maneuverPresentation.tint }]} numberOfLines={1}>{navigationDistanceText}</Text>
            <Text style={s.navInstructionText} numberOfLines={2}>{navigationInstruction}</Text>
            {nextNextStepInfo && (
              <View style={s.navNextStepRow}>
                <MaterialCommunityIcons name={getManeuverIcon(nextNextStepInfo.maneuver)} size={13} color={colors.textMuted} />
                <Text style={s.navNextStepText} numberOfLines={1}>
                  {' '}{nextNextStepInfo.instruction || 'Seguí la ruta'}
                </Text>
              </View>
            )}
          </View>
          <View style={s.navRightCol}>
            <Text style={s.navTotalText}>{remainingDistanceText}</Text>
            {Number.isFinite(speed) && speed > 0.5 && (
              <View style={s.navSpeedBadge}>
                <Text style={s.navSpeedText}>{Math.round(speed * 3.6)}</Text>
                <Text style={s.navSpeedUnit}>km/h</Text>
              </View>
            )}
            <Pressable
              style={({ pressed }) => [s.navMuteBtn, { opacity: pressed ? 0.7 : 1 }]}
              onPress={toggleMute}
              hitSlop={8}
            >
              <MaterialCommunityIcons
                name={isMuted ? 'volume-off' : 'volume-high'}
                size={18}
                color={isMuted ? colors.textMuted : colors.primary}
              />
            </Pressable>
          </View>
        </View>

        <View style={s.navProgressTrack}>
          <View
            style={[
              s.navProgressFill,
              {
                width: `${Math.max(4, progressPercent)}%`,
                backgroundColor: maneuverPresentation.tint,
              },
            ]}
          />
        </View>
        <View style={s.navProgressLabels}>
          <Text style={s.navProgressLabel}>{remainingDistanceText} restantes</Text>
          <Text style={s.navProgressLabel}>{progressPercent}% recorrido</Text>
        </View>
      </View>

      {/* Floating map toggle button */}

      {/* Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={s.sheetBg}
        handleIndicatorStyle={s.handle}
        onChange={(index) => setSheetIndex(index)}
        keyboardBehavior="extend"
        keyboardBlurBehavior="restore"
      >
        <BottomSheetScrollView contentContainerStyle={s.sheetContent} showsVerticalScrollIndicator={false}>

          {/* STEP 1: Going to pickup */}
          {flowStep === FLOW_STEP.GOING_TO_PICKUP && (
            <>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.primary }]}
                onPress={handleConfirmArrival}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="map-marker-check" size={22} color="#fff" />
                <Text style={s.actionBtnText}>Llegué al punto de encuentro</Text>
              </TouchableOpacity>

              <View style={s.addressCard}>
                <View style={s.addressRow}>
                  <View style={[s.addressDot, { backgroundColor: colors.primary }]} />
                  <View style={{ flex: 1, marginLeft: 10 }}>
                    <Text style={s.addressLabel}>Buscá al pasajero en</Text>
                    <Text style={s.addressText} numberOfLines={2}>{pickupPoint?.address || 'Ubicación pendiente de confirmar'}</Text>
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
            </>
          )}

          {/* STEP 2: At pickup - Confirm passenger aboard */}
          {flowStep === FLOW_STEP.AT_PICKUP && (
            <>
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.warning }]}
                onPress={handlePassengerAboard}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="account-check" size={22} color="#fff" />
                <Text style={s.actionBtnText}>Pasajero a bordo</Text>
              </TouchableOpacity>

              <View style={s.stepInfoCard}>
                <MaterialCommunityIcons name="account-check" size={28} color={colors.warning} />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.stepInfoTitle}>¿El pasajero subió?</Text>
                  <Text style={s.stepInfoSubtitle}>Confirmá que el pasajero está a bordo para continuar</Text>
                </View>
              </View>
            </>
          )}

          {/* STEP CHOOSE_DEST_MODE: Elegir cómo ingresar el destino */}
          {flowStep === FLOW_STEP.CHOOSE_DEST_MODE && (
            <>
              <Text style={s.chooseModeTitle}>¿Cómo ingresás el destino?</Text>

              <TouchableOpacity
                style={[s.chooseModeBtn, { borderColor: colors.primary }]}
                onPress={() => setFlowStep(FLOW_STEP.SET_DESTINATION)}
                activeOpacity={0.85}
              >
                <View style={[s.chooseModeBtnIcon, { backgroundColor: `${colors.primary}15` }]}>
                  <MaterialCommunityIcons name="map-search" size={24} color={colors.primary} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[s.chooseModeBtnTitle, { color: colors.primary }]}>Ingresar destino por texto</Text>
                  <Text style={s.chooseModeBtnSubtitle}>Escribí la dirección y seleccioná</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.primary} />
              </TouchableOpacity>

              <TouchableOpacity
                style={[s.chooseModeBtn, { borderColor: colors.warning }]}
                onPress={handleChooseFreeRide}
                activeOpacity={0.85}
              >
                <View style={[s.chooseModeBtnIcon, { backgroundColor: `${colors.warning}15` }]}>
                  <MaterialCommunityIcons name="car-cruise-control" size={24} color={colors.warning} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={[s.chooseModeBtnTitle, { color: colors.warning }]}>Ir sin destino</Text>
                  <Text style={s.chooseModeBtnSubtitle}>La tarifa se calcula por km recorridos</Text>
                </View>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.warning} />
              </TouchableOpacity>
            </>
          )}

          {/* STEP 3: Set destination by text */}
          {flowStep === FLOW_STEP.SET_DESTINATION && (
            <>
              {!destinationSet ? (
                <>
                  {/* Input con BottomSheetTextInput para que el sheet suba con el teclado */}
                  <View style={s.textDestInputRow}>
                    <View style={s.textDestInputWrap}>
                      <MaterialCommunityIcons
                        name={textDestProcessing ? 'loading' : 'magnify'}
                        size={20}
                        color={colors.textMuted}
                        style={s.textDestIcon}
                      />
                      <BottomSheetTextInput
                        style={s.textDestInput}
                        value={textDestInput}
                        onChangeText={setTextDestInput}
                        placeholder="Buscar dirección..."
                        placeholderTextColor={colors.textMuted}
                        returnKeyType="search"
                        onSubmitEditing={handleTextDestSearch}
                        autoFocus
                        autoCorrect={false}
                        autoCapitalize="words"
                      />
                      {textDestProcessing && (
                        <ActivityIndicator size="small" color={colors.primary} style={{ marginRight: 8 }} />
                      )}
                      {!textDestProcessing && textDestInput.length > 0 && (
                        <TouchableOpacity
                          onPress={() => { setTextDestInput(''); setDestinationOptions([]); }}
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          style={{ marginRight: 10 }}
                        >
                          <MaterialCommunityIcons name="close-circle" size={18} color={colors.textMuted} />
                        </TouchableOpacity>
                      )}
                    </View>
                  </View>

                  {/* Opciones de autocomplete — aparecen mientras el usuario escribe */}
                  {destinationOptions.length > 0 && (
                    <View style={s.autocompleteList}>
                      {destinationOptions.map((opt, idx) => (
                        <TouchableOpacity
                          key={opt.placeId || `opt-${idx}`}
                          style={[
                            s.autocompleteItem,
                            idx < destinationOptions.length - 1 && s.autocompleteItemBorder,
                          ]}
                          onPress={() => selectDestination(opt)}
                          activeOpacity={0.7}
                        >
                          <View style={s.autocompleteIcon}>
                            <MaterialCommunityIcons name="map-marker-outline" size={18} color={colors.primary} />
                          </View>
                          <Text style={s.autocompleteAddress} numberOfLines={2}>{opt.address}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}

                  {textDestInput.length >= 3 && !textDestProcessing && destinationOptions.length === 0 && (
                    <Text style={s.autocompleteEmpty}>Sin resultados para "{textDestInput}"</Text>
                  )}

                  <TouchableOpacity
                    style={s.backToChooseBtn}
                    onPress={() => { setDestinationOptions([]); setTextDestInput(''); setFlowStep(FLOW_STEP.CHOOSE_DEST_MODE); }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="arrow-left" size={14} color={colors.textMuted} />
                    <Text style={s.reRecordText}>Volver</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <>
                  <TouchableOpacity
                    style={[s.actionBtn, { backgroundColor: colors.success }]}
                    onPress={handleStartTrip}
                    activeOpacity={0.85}
                  >
                    <MaterialCommunityIcons name="car" size={22} color="#fff" />
                    <Text style={s.actionBtnText}>Empezar viaje</Text>
                  </TouchableOpacity>

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

                  <View style={s.livePriceCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View>
                        <Text style={s.livePriceLabel}>Costo estimado</Text>
                        <Text style={s.livePriceSubLabel}>
                          {Number.isFinite(checkoutDistanceKm) && checkoutDistanceKm > 0
                            ? `${formatDistance(checkoutDistanceKm)} x ${formatPrice(effectiveTariffPerKm)}/km`
                            : 'Calculando costo...'}
                        </Text>
                      </View>
                      <Text style={s.livePriceValue}>
                        {fixedRouteTotalPrice == null ? '...' : formatPrice(fixedRouteTotalPrice)}
                      </Text>
                    </View>
                  </View>

                  <TouchableOpacity
                    style={s.reRecordBtn}
                    onPress={() => { setDestinationSet(false); setDestinationOptions([]); setTextDestInput(''); }}
                    activeOpacity={0.7}
                  >
                    <MaterialCommunityIcons name="pencil" size={14} color={colors.textMuted} />
                    <Text style={s.reRecordText}>Cambiar destino</Text>
                  </TouchableOpacity>
                </>
              )}
            </>
          )}

          {/* STEP 4: In progress */}
          {flowStep === FLOW_STEP.IN_PROGRESS && (
            <>
              {/* Resumen de tramos anteriores */}
              {accumulatedLegs.length > 0 && (
                <View style={s.accumulatedCard}>
                  <MaterialCommunityIcons name="layers-triple-outline" size={15} color={colors.info} />
                  <Text style={s.accumulatedCardText}>
                    {accumulatedLegs.length} tramo{accumulatedLegs.length !== 1 ? 's' : ''} anterior{accumulatedLegs.length !== 1 ? 'es' : ''}{' '}
                    · {formatDistance(accumulatedLegs.reduce((s, l) => s + (l.distanceKm || 0), 0))}{' '}
                    · {formatPrice(accumulatedLegs.reduce((s, l) => s + (l.price || 0), 0))}
                  </Text>
                </View>
              )}

              {/* Slider para finalizar */}
              <SliderButton
                ref={sliderRef}
                onConfirm={handleEndTrip}
                label="Deslizá para finalizar viaje"
                color={colors.success}
                disabled={finishingTrip}
              />

              {/* Agregar otro destino */}
              <TouchableOpacity
                style={s.addDestBtn}
                onPress={handleAddAnotherDestination}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="map-marker-plus" size={20} color={colors.primary} />
                <Text style={s.addDestBtnText}>Agregar otro destino</Text>
                {accumulatedLegs.length > 0 && (
                  <View style={s.addDestBadge}>
                    <Text style={s.addDestBadgeText}>{accumulatedLegs.length}</Text>
                  </View>
                )}
              </TouchableOpacity>

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
                    <Text style={s.addressLabel}>Destino actual</Text>
                    <Text style={s.addressText} numberOfLines={2}>{activeTrip.destination_address}</Text>
                  </View>
                </View>
              </View>

              <View style={s.livePriceCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={s.livePriceLabel}>{accumulatedLegs.length > 0 ? 'Total acumulado' : 'Costo total'}</Text>
                    <Text style={s.livePriceSubLabel}>
                      {grandTotalDistanceKm > 0
                        ? `${formatDistance(grandTotalDistanceKm)} x ${formatPrice(effectiveTariffPerKm)}/km`
                        : 'Calculando costo...'}
                    </Text>
                  </View>
                  <Text style={s.livePriceValue}>
                    {grandTotalPrice > 0 ? formatPrice(grandTotalPrice) : '...'}
                  </Text>
                </View>
              </View>
            </>
          )}

          {/* Passenger row (moved to end to prioritize actions) */}
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
  navigationCard: {
    position: 'absolute',
    left: 12,
    right: 12,
    backgroundColor: 'rgba(255,255,255,0.97)',
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
  },
  navigationCardCritical: {
    shadowOpacity: 0.18,
  },
  navTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  navBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },
  navBadgeText: {
    fontSize: 11,
    fontFamily: 'Inter_700Bold',
  },
  navEtaText: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_600SemiBold',
  },
  navMainRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
  },
  navIconBox: {
    width: 48,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navDistanceCol: {
    flex: 1,
  },
  navDistanceText: {
    fontSize: 26,
    fontFamily: 'Inter_700Bold',
    lineHeight: 30,
  },
  navInstructionText: {
    color: colors.text,
    fontSize: 16,
    fontFamily: 'Inter_600SemiBold',
    lineHeight: 21,
    marginTop: 2,
  },
  navTotalText: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  navRightCol: {
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
    minWidth: 50,
  },
  navSpeedBadge: {
    alignItems: 'center',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 40,
  },
  navSpeedText: {
    fontSize: 16,
    fontFamily: 'Inter_700Bold',
    color: colors.text,
    lineHeight: 18,
  },
  navSpeedUnit: {
    fontSize: 9,
    fontFamily: 'Inter_600SemiBold',
    color: colors.textMuted,
    lineHeight: 11,
  },
  navMuteBtn: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 15,
  },
  navNextStepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  navNextStepText: {
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    color: colors.textMuted,
    lineHeight: 14,
    flex: 1,
  },
  navProgressTrack: {
    height: 4,
    borderRadius: 999,
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
    marginBottom: 4,
  },
  navProgressFill: {
    height: '100%',
    borderRadius: 999,
    minWidth: 4,
  },
  navProgressLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  navProgressLabel: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
  },
  navFooterRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  navFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flex: 1,
  },
  navFooterText: {
    color: colors.textMuted,
    fontSize: 10,
    fontFamily: 'Inter_500Medium',
    flex: 1,
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
  sheetContent: { paddingHorizontal: 20, paddingBottom: 100, paddingTop: 4 },
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
  shareWhatsappBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: '#F0FDF4',
    borderWidth: 1.5,
    borderColor: '#86EFAC',
    marginBottom: 12,
  },
  shareWhatsappBtnText: {
    color: '#16A34A',
    fontSize: 14,
    fontFamily: 'Inter_600SemiBold',
  },
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
  finishModalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(12, 18, 28, 0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  finishModalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.surface,
    borderRadius: 20,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
  },
  finishModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
    gap: 10,
  },
  finishModalIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: `${colors.success}15`,
    alignItems: 'center',
    justifyContent: 'center',
  },
  finishModalTitle: { color: colors.text, fontSize: 17, fontFamily: 'Inter_700Bold' },
  finishModalSubtitle: {
    color: colors.textMuted,
    fontSize: 12,
    fontFamily: 'Inter_500Medium',
    marginTop: 2,
  },
  finishModalInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  finishModalInfoLabel: { color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_500Medium' },
  finishModalInfoValue: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  finishModalTotalWrap: {
    marginTop: 10,
    marginBottom: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: `${colors.success}35`,
    backgroundColor: `${colors.success}12`,
    padding: 14,
  },
  finishModalTotalLabel: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' },
  finishModalTotalValue: { color: colors.success, fontSize: 32, fontFamily: 'Inter_700Bold', marginTop: 2 },
  finishModalActions: { flexDirection: 'row', gap: 10 },
  finishModalBtn: {
    flex: 1,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 46,
  },
  finishModalBtnGhost: { backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border },
  finishModalBtnPrimary: { backgroundColor: colors.success },
  finishModalBtnGhostText: { color: colors.text, fontSize: 14, fontFamily: 'Inter_600SemiBold' },
  finishModalBtnPrimaryText: { color: '#fff', fontSize: 14, fontFamily: 'Inter_700Bold' },
  finishModalBtnDisabled: { opacity: 0.7 },
  reRecordBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8,
  },
  reRecordText: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_500Medium' },
  floatingMapToggle: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    transform: [{ translateX: -70 }],
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  floatingMapToggleText: {
    color: colors.primary,
    fontSize: 13,
    fontFamily: 'Inter_600SemiBold',
  },
  // Choose destination mode
  chooseModeTitle: {
    color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold',
    marginBottom: 14, textAlign: 'center',
  },
  chooseModeBtn: {
    flexDirection: 'row', alignItems: 'center',
    borderRadius: 16, borderWidth: 1.5, padding: 16, marginBottom: 12,
    backgroundColor: colors.background,
  },
  chooseModeBtnIcon: {
    width: 48, height: 48, borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  chooseModeBtnTitle: { fontSize: 15, fontFamily: 'Inter_700Bold' },
  chooseModeBtnSubtitle: { color: colors.textMuted, fontSize: 12, fontFamily: 'Inter_400Regular', marginTop: 2 },
  // Text destination
  textDestSection: { marginBottom: 10 },
  textDestInputRow: { marginBottom: 4 },
  textDestInputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingLeft: 12,
  },
  textDestIcon: { marginRight: 8 },
  textDestInput: {
    flex: 1,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 15,
    fontFamily: 'Inter_400Regular',
  },
  textDestSearchBtn: {
    width: 46, height: 46, borderRadius: 12,
    backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  autocompleteList: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: 10,
    overflow: 'hidden',
  },
  autocompleteItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  autocompleteItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  autocompleteIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: `${colors.primary}12`,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    flexShrink: 0,
  },
  autocompleteAddress: {
    flex: 1,
    color: colors.text,
    fontSize: 13,
    fontFamily: 'Inter_500Medium',
    lineHeight: 18,
  },
  autocompleteEmpty: {
    color: colors.textMuted,
    fontSize: 13,
    fontFamily: 'Inter_400Regular',
    textAlign: 'center',
    paddingVertical: 12,
  },
  backToChooseBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 8,
  },
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
  // Multi-destino
  accumulatedCard: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: `${colors.info}10`, borderRadius: 12,
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 10,
    borderWidth: 1, borderColor: `${colors.info}25`,
  },
  accumulatedCardText: { color: colors.info, fontSize: 12, fontFamily: 'Inter_600SemiBold', flex: 1 },
  addDestBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 14, borderRadius: 14, gap: 10, marginBottom: 10,
    backgroundColor: `${colors.primary}10`, borderWidth: 1.5, borderColor: `${colors.primary}30`,
  },
  addDestBtnText: { color: colors.primary, fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  addDestBadge: {
    backgroundColor: colors.primary, borderRadius: 10,
    minWidth: 20, height: 20, paddingHorizontal: 5,
    alignItems: 'center', justifyContent: 'center',
  },
  addDestBadgeText: { color: '#fff', fontSize: 11, fontFamily: 'Inter_700Bold' },
  finishModalLegsRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: `${colors.info}10`, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 8, marginBottom: 10,
    borderWidth: 1, borderColor: `${colors.info}25`,
  },
  finishModalLegsText: { color: colors.info, fontSize: 12, fontFamily: 'Inter_500Medium', flex: 1 },
});

export default ActiveTripScreen;
