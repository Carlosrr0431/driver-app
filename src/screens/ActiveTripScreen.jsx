import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, Linking, Dimensions, TouchableOpacity, StatusBar, StyleSheet, ScrollView, ActivityIndicator, Modal } from 'react-native';
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
import {
  decodePolyline,
  getCurrentNavigationStep,
  getDirections,
  getDistanceToPolylineMeters,
  getPlaceDetails,
  getRouteRemainingMeters,
} from '../services/googleMaps';
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

function parseSettingNumber(rawValue) {
  const normalized = String(rawValue ?? '')
    .replace(',', '.')
    .replace(/[^0-9.-]/g, '');
  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
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
    /(?:por|direcci[oó]n a|hacia)\s+([A-Z0-9ÁÉÍÓÚÑ][^,.]+)/i,
    /en\s+([A-Z0-9ÁÉÍÓÚÑ][^,.]+?)(?:\s+hacia|\s+con\s+direcci[oó]n|\s*,|$)/i,
    /(?:continua|continuá|sigue|seguí)\s+por\s+([A-Z0-9ÁÉÍÓÚÑ][^,.]+)/i,
    /(?:incorp[oó]rate|incorporate)\s+a\s+([A-Z0-9ÁÉÍÓÚÑ][^,.]+)/i,
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
  if (meters <= 650) {
    const blocks = Math.max(1, Math.round(meters / 100));
    return blocks === 1 ? 'en 1 cuadra' : `en ${blocks} cuadras`;
  }
  if (meters < 1000) return `en ${meters} metros`;
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

function getDirectActionText(maneuver, roadName) {
  const normalized = String(maneuver || '').toLowerCase();
  const roadSuffix = roadName ? ` por ${roadName}` : '';

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

  const roadName = extractRoadNameFromInstruction(step?.instruction);
  const maneuverOrText = step?.maneuver || step?.instruction || '';
  const actionText = getDirectActionText(maneuverOrText, roadName);
  const distanceText = formatDistanceForSpeech(step?.distanceToStepMeters);
  const prefix = distanceText === 'ahora'
    ? 'Ahora'
    : `${distanceText.charAt(0).toUpperCase()}${distanceText.slice(1)}`;

  return {
    primary: `${prefix}, ${actionText}`,
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
  const hasWhatsappAutoMarker = notesNorm.includes('creado automaticamente desde whatsapp');

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

const ActiveTripScreen = () => {
  const DEFAULT_TARIFF_PER_KM = 600;
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const bottomSheetRef = useRef(null);
  const timerRef = useRef(null);
  const routeFetched = useRef(false);
  const lastRouteKeyRef = useRef('');
  const lastRerouteAtRef = useRef(0);

  const { activeTrip, tripTimer, tripDistanceKm, setTripTimer, addTripDistance } = useTripStore();
  const { updateTripStatus } = useTrips();
  const { startTracking, stopTracking } = useLocation();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const heading = useLocationStore((s) => s.heading);
  const speed = useLocationStore((s) => s.speed);

  const [routePolyline, setRoutePolyline] = useState(null);
  const [routeInfo, setRouteInfo] = useState(null);
  const [routeSteps, setRouteSteps] = useState([]);
  const [showSummary, setShowSummary] = useState(false);
  const [completedTrip, setCompletedTrip] = useState(null);
  const [showFinishModal, setShowFinishModal] = useState(false);
  const [finishingTrip, setFinishingTrip] = useState(false);
  const [tariffInfo, setTariffInfo] = useState({ base: 0, perKm: 0, commission: 15 });
  const [tariffLoaded, setTariffLoaded] = useState(false);
  const [remainingDistanceMeters, setRemainingDistanceMeters] = useState(null);
  const [remainingDurationSeconds, setRemainingDurationSeconds] = useState(null);
  const [nextStepInfo, setNextStepInfo] = useState(null);

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

  const snapPoints = useMemo(() => ['18%', '68%'], []);

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

  useEffect(() => {
    if (!bottomSheetRef.current) return;
    bottomSheetRef.current.snapToIndex(0);
  }, [flowStep, activeTrip?.id]);

  // Fetch tariff
  useEffect(() => {
    const fetchTariff = async () => {
      try {
        const { data } = await supabase
          .from('settings')
          .select('key, value')
          .in('key', ['tariff_per_km', 'tariff_base', 'commission_percent', 'whatsapp_driver_commission']);

        const rows = Array.isArray(data) ? data : [];
        const map = {};
        rows.forEach((r) => {
          const key = String(r?.key || '').trim().toLowerCase();
          if (key) map[key] = parseSettingNumber(r?.value);
        });

        // Fallback query if key filter returned empty/incomplete values.
        if (!Number.isFinite(map.tariff_per_km) || map.tariff_per_km <= 0) {
          const { data: perKmRow } = await supabase
            .from('settings')
            .select('key, value')
            .ilike('key', 'tariff_per_km')
            .limit(1)
            .maybeSingle();
          map.tariff_per_km = parseSettingNumber(perKmRow?.value);
        }

        setTariffInfo({
          base: Number.isFinite(map.tariff_base) ? map.tariff_base : 0,
          perKm: Number.isFinite(map.tariff_per_km) && map.tariff_per_km > 0 ? map.tariff_per_km : DEFAULT_TARIFF_PER_KM,
          commission: Number.isFinite(map.whatsapp_driver_commission) && map.whatsapp_driver_commission > 0
            ? map.whatsapp_driver_commission
            : (Number.isFinite(map.commission_percent) && map.commission_percent > 0 ? map.commission_percent : 10),
        });
      } catch (e) {
        console.warn('Error fetching tariff:', e);
        setTariffInfo((prev) => ({ ...prev, perKm: prev.perKm > 0 ? prev.perKm : DEFAULT_TARIFF_PER_KM }));
      } finally {
        setTariffLoaded(true);
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

  // Reset route when routing-relevant trip data changes
  useEffect(() => {
    routeFetched.current = false;
    lastRouteKeyRef.current = '';
    setRoutePolyline(null);
    setRouteInfo(null);
    setRouteSteps([]);
    setRemainingDistanceMeters(null);
    setRemainingDurationSeconds(null);
    setNextStepInfo(null);
  }, [
    activeTrip?.id,
    activeTrip?.origin_lat,
    activeTrip?.origin_lng,
    activeTrip?.destination_lat,
    activeTrip?.destination_lng,
    activeTrip?.notes,
    flowStep,
    destinationSet,
  ]);

  const fetchNavigationRoute = useCallback(async (forceRefresh = false) => {
    if (!activeTrip || !currentLocation) return;

    try {
      const { point: pickupPoint } = resolvePickupPoint(activeTrip, currentLocation);
      const origin = { lat: currentLocation.lat, lng: currentLocation.lng };
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

  // Estimated total using full route distance (when available)
  const routeDistanceKm = useMemo(() => parseRouteDistanceKm(routeInfo), [routeInfo]);
  const routeCoords = useMemo(
    () => (routePolyline ? decodePolyline(routePolyline) : []),
    [routePolyline]
  );

  const effectiveTariffPerKm = useMemo(() => {
    const kmRate = Number(tariffInfo.perKm);
    return Number.isFinite(kmRate) && kmRate > 0 ? kmRate : DEFAULT_TARIFF_PER_KM;
  }, [tariffInfo.perKm]);

  const estimatedTotalPrice = useMemo(() => {
    if (!Number.isFinite(routeDistanceKm)) return livePrice;
    return Math.round(tariffInfo.base + tariffInfo.perKm * routeDistanceKm);
  }, [routeDistanceKm, tariffInfo, livePrice]);

  const routeBasedTotalPrice = useMemo(() => {
    if (!tariffLoaded || !Number.isFinite(routeDistanceKm)) return null;
    return Math.round(effectiveTariffPerKm * routeDistanceKm);
  }, [tariffLoaded, effectiveTariffPerKm, routeDistanceKm]);

  const checkoutDistanceKm = useMemo(() => {
    if (Number.isFinite(routeDistanceKm) && routeDistanceKm > 0) return routeDistanceKm;
    return tripDistanceKm;
  }, [routeDistanceKm, tripDistanceKm]);

  const checkoutTotalPrice = useMemo(() => {
    if (Number.isFinite(routeBasedTotalPrice) && routeBasedTotalPrice > 0) return routeBasedTotalPrice;
    if (Number.isFinite(checkoutDistanceKm) && checkoutDistanceKm > 0) {
      return Math.round(effectiveTariffPerKm * checkoutDistanceKm);
    }
    return livePrice;
  }, [routeBasedTotalPrice, checkoutDistanceKm, effectiveTariffPerKm, livePrice]);

  useEffect(() => {
    if (!currentLocation || routeCoords.length === 0) return;

    const currentPoint = {
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
    };

    const remainingMeters = getRouteRemainingMeters(currentPoint, routeCoords);
    setRemainingDistanceMeters(remainingMeters);

    const totalDistanceMeters = Number(routeInfo?.distanceValue) || 0;
    const totalDurationSeconds = Number(routeInfo?.durationValue) || 0;
    const estimatedRemainingSeconds = totalDistanceMeters > 0 && totalDurationSeconds > 0
      ? Math.max(0, Math.round((remainingMeters / totalDistanceMeters) * totalDurationSeconds))
      : null;
    setRemainingDurationSeconds(estimatedRemainingSeconds);

    const step = getCurrentNavigationStep(currentPoint, routeSteps);
    setNextStepInfo(step);
  }, [currentLocation, routeCoords, routeInfo?.distanceValue, routeInfo?.durationValue, routeSteps]);

  useEffect(() => {
    if (!currentLocation || routeCoords.length < 2) return;

    const currentPoint = {
      latitude: currentLocation.lat,
      longitude: currentLocation.lng,
    };
    const deviationMeters = getDistanceToPolylineMeters(currentPoint, routeCoords);
    const now = Date.now();
    if (deviationMeters > 80 && now - lastRerouteAtRef.current > 4000) {
      lastRerouteAtRef.current = now;
      fetchNavigationRoute(true);
    }
  }, [currentLocation, routeCoords, fetchNavigationRoute]);

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

  // ============================
  //  STEP HANDLERS
  // ============================

  // Step 1 -> Step 2: Confirm arrived at pickup
  const handleConfirmArrival = useCallback(() => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFlowStep(FLOW_STEP.AT_PICKUP);
  }, []);

  // Step 2 -> Step 3 (or skip to Step 4 if destination already set by dashboard or preloaded from notes)
  const handlePassengerAboard = useCallback(async () => {
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    const { isApproachOnly: isApproachOnlyTrip } = resolvePickupPoint(activeTrip, currentLocation);

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

    // If the dashboard already set a destination, skip voice step
    if (!isApproachOnlyTrip && activeTrip?.destination_lat && activeTrip?.destination_lng) {
      setDestinationSet(true);
      setFlowStep(FLOW_STEP.IN_PROGRESS);
      updateTripStatus(activeTrip.id, TRIP_STATUS.IN_PROGRESS);
    } else {
      setFlowStep(FLOW_STEP.SET_DESTINATION);
    }
  }, [activeTrip, currentLocation]);

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
    if (!activeTrip || finishingTrip) return;
    setShowFinishModal(true);
  }, [activeTrip, finishingTrip]);

  const handleConfirmFinishTrip = useCallback(async () => {
    if (!activeTrip || finishingTrip) return;
    try {
      setFinishingTrip(true);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      const distanceKm = Number.isFinite(checkoutDistanceKm) ? Math.round(checkoutDistanceKm * 10) / 10 : 0;
      const totalPrice = Number.isFinite(checkoutTotalPrice) ? Math.round(checkoutTotalPrice) : 0;
      const commissionAmount = Math.round(totalPrice * (tariffInfo.commission || 10) / 100);

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
      }
    } finally {
      setFinishingTrip(false);
    }
  }, [
    activeTrip,
    finishingTrip,
    checkoutDistanceKm,
    checkoutTotalPrice,
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

  // Map destination target based on step
  const mapOrigin = (useTripOriginRoute && hasTripOrigin) ? tripOriginPoint : pickupPoint;
  const mapDestination = (flowStep === FLOW_STEP.GOING_TO_PICKUP || flowStep === FLOW_STEP.AT_PICKUP)
    ? pickupPoint
    : {
      lat: parseFloat(activeTrip.destination_lat),
      lng: parseFloat(activeTrip.destination_lng),
      address: activeTrip.destination_address,
    };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" translucent backgroundColor="transparent" />

      <Modal
        visible={showFinishModal}
        transparent
        animationType="fade"
        onRequestClose={() => !finishingTrip && setShowFinishModal(false)}
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

            <View style={s.finishModalInfoRow}>
              <Text style={s.finishModalInfoLabel}>Distancia total</Text>
              <Text style={s.finishModalInfoValue}>{formatDistance(checkoutDistanceKm)}</Text>
            </View>

            <View style={s.finishModalTotalWrap}>
              <Text style={s.finishModalTotalLabel}>Costo total del viaje</Text>
              <Text style={s.finishModalTotalValue}>{formatPrice(checkoutTotalPrice)}</Text>
            </View>

            <View style={s.finishModalActions}>
              <TouchableOpacity
                style={[s.finishModalBtn, s.finishModalBtnGhost, finishingTrip && s.finishModalBtnDisabled]}
                onPress={() => !finishingTrip && setShowFinishModal(false)}
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
        navigationMode
        remainingDistanceMeters={remainingDistanceMeters}
        style={StyleSheet.absoluteFillObject}
      />

      <View style={[
        s.navigationCard,
        maneuverPresentation.isCritical ? s.navigationCardCritical : null,
        { top: insets.top + 8, borderColor: maneuverPresentation.border },
      ]}>
        {/* Ícono de maniobra + distancia al próximo paso + instrucción + km restantes */}
        <View style={s.navMainRow}>
          <View style={[s.navIconBox, { backgroundColor: maneuverPresentation.background, borderColor: maneuverPresentation.border }]}>
            <MaterialCommunityIcons name={maneuverIcon} size={32} color={maneuverPresentation.tint} />
          </View>
          <View style={s.navDistanceCol}>
            <Text style={[s.navDistanceText, { color: maneuverPresentation.tint }]} numberOfLines={1}>{navigationDistanceText}</Text>
            <Text style={s.navInstructionText} numberOfLines={2}>{navigationInstruction}</Text>
          </View>
          <Text style={s.navTotalText}>{remainingDistanceText}</Text>
        </View>
      </View>

      {/* Bottom Sheet */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        backgroundStyle={s.sheetBg}
        handleIndicatorStyle={s.handle}
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

          {/* STEP 3: Set destination by voice */}
          {flowStep === FLOW_STEP.SET_DESTINATION && (
            <>
              {!destinationSet ? (
                <>
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

                  <View style={s.stepInfoCard}>
                    <MaterialCommunityIcons name="microphone" size={28} color={colors.info} />
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={s.stepInfoTitle}>¿A dónde van?</Text>
                      <Text style={s.stepInfoSubtitle}>Grabá un audio diciendo la dirección de destino</Text>
                    </View>
                  </View>
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

                  <View style={s.livePriceCard}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                      <View>
                        <Text style={s.livePriceLabel}>Costo total</Text>
                        <Text style={s.livePriceSubLabel}>
                          {Number.isFinite(routeDistanceKm)
                            ? `${formatDistance(routeDistanceKm)} x ${formatPrice(effectiveTariffPerKm)}/km`
                            : 'Calculando costo...'}
                        </Text>
                      </View>
                      <Text style={s.livePriceValue}>
                        {routeBasedTotalPrice == null ? '...' : formatPrice(routeBasedTotalPrice)}
                      </Text>
                    </View>
                  </View>

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
              <TouchableOpacity
                style={[s.actionBtn, { backgroundColor: colors.danger }]}
                onPress={handleEndTrip}
                activeOpacity={0.85}
              >
                <MaterialCommunityIcons name="flag-checkered" size={22} color="#fff" />
                <Text style={s.actionBtnText}>Llegué a destino</Text>
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
                    <Text style={s.addressLabel}>Destino</Text>
                    <Text style={s.addressText} numberOfLines={2}>{activeTrip.destination_address}</Text>
                  </View>
                </View>
              </View>

              <View style={s.livePriceCard}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View>
                    <Text style={s.livePriceLabel}>Costo total</Text>
                    <Text style={s.livePriceSubLabel}>
                      {Number.isFinite(routeDistanceKm)
                        ? `${formatDistance(routeDistanceKm)} x ${formatPrice(effectiveTariffPerKm)}/km`
                        : 'Calculando costo...'}
                    </Text>
                  </View>
                  <Text style={s.livePriceValue}>
                    {routeBasedTotalPrice == null ? '...' : formatPrice(routeBasedTotalPrice)}
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
