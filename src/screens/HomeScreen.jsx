import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  RefreshControl,
  StatusBar,
  StyleSheet,
  AppState,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, { FadeInUp, SlideInRight } from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation, useFocusEffect, useIsFocused } from '@react-navigation/native';
import MapLibreGL from '../lib/maplibre';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { colors } from '../theme/colors';
import { MAPLIBRE_STYLE } from '../utils/mapProvider';
import DriverLocationMarker from '../components/map/DriverLocationMarker';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { useTrips } from '../hooks/useTrips';
import { useRealtime } from '../hooks/useRealtime';
import { useQueryClient } from '@tanstack/react-query';
import { useAppResumeHydrator } from '../hooks/useAppResumeHydration';
import { useLocation } from '../hooks/useLocation';
import { useResponsive } from '../hooks/useResponsive';
import { supabase } from '../services/supabase';
import { setDriverOnlineStatus } from '../services/assignedDriverService';
import { NewTripModal } from '../components/trip/NewTripModal';
import { StreetHailHomeButton } from '../components/trip/StreetHailHomeButton';
import { StreetHailSetupSheet } from '../components/trip/StreetHailSetupSheet';
import { prefetchDriverToPickupRoute } from '../services/navigationRoutePrefetch';
import { VoiceChatModal } from '../components/VoiceChatModal';
import { formatPrice, formatDistance } from '../utils/formatters';
import { DEFAULT_REGION } from '../utils/constants';
import {
  resolveLiveTripForNavigation,
  SHEET_PAN_ACTIVE_OFFSET_Y,
  SHEET_PAN_FAIL_OFFSET_X,
} from '../utils/activeTripNavigation';
import {
  HOME_CAMERA_ZOOM,
  nextHomeFollowCenter,
  shouldSkipHomeCameraFollow,
  toCameraLngLat,
} from '../utils/homeMapCamera';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';
import CommissionDebtBanner from '../components/CommissionDebtBanner';
import { shouldShowCommissionDebtUi } from '../../shared/driver-billing';
import { isNextTripOffer } from '../../shared/next-trip';
import { isLiveDriverTrip } from '../utils/activeTripNavigation';

const TRIP_ROW_ENTER = [
  FadeInUp.delay(150).duration(320),
  FadeInUp.delay(205).duration(320),
  FadeInUp.delay(260).duration(320),
  FadeInUp.delay(315).duration(320),
];

const TRIP_STATUS_UI = {
  completed:       { color: colors.success,  icon: 'check-circle',  bg: colors.successBg },
  cancelled:       { color: colors.danger,   icon: 'close-circle',  bg: colors.dangerBg },
  in_progress:     { color: colors.primary,  icon: 'navigation',    bg: colors.surfaceLight },
  pending:         { color: colors.warning,  icon: 'clock-outline', bg: colors.warningBg },
  accepted:        { color: colors.info,     icon: 'car-arrow-right', bg: colors.infoBg },
  going_to_pickup: { color: colors.primary,  icon: 'car-arrow-right', bg: colors.surfaceLight },
};

const HomeDriverPuck = React.memo(() => {
  const lat = useLocationStore((s) => s.currentLocation?.lat);
  const lng = useLocationStore((s) => s.currentLocation?.lng);
  const speed = useLocationStore((s) => s.currentLocation?.speed);
  const heading = useLocationStore((s) => s.heading);
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lng))) return null;
  return <DriverLocationMarker lat={lat} lng={lng} speed={speed} heading={heading} />;
});

const HomeScreen = () => {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const isFocused = useIsFocused();
  const { isLandscape, isCompactHeight } = useResponsive();
  const { driver, updateDriver } = useAuthStore();
  const { pendingTrip, showNewTripModal, activeTrip, ignoredTripId } = useTripStore();
  const currentLocation = useLocationStore((s) => s.currentLocation);
  const { useTodayStats, useActiveTrip, useCommissionBalance, acceptTrip, rejectTrip, useTripHistory, createStreetHailTrip } = useTrips();
  const {
    subscribeToNewTrips,
    subscribeToMessages,
    subscribeToCommissionPayments,
    unsubscribeAll,
  } = useRealtime();
  const queryClient = useQueryClient();
  const { getCurrentPosition, startWatching, stopWatching } = useLocation();
  const openTripDetail = useCallback((tripId) => {
    navigation.navigate('TripDetail', { tripId });
  }, [navigation]);
  const mapRef = useRef(null);
  const mapReadyRef = useRef(false);
  const pendingCenterRef = useRef(null);
  const lastCameraFollowRef = useRef(null);
  const isHomeFocusedRef = useRef(false);
  const [followCenter, setFollowCenter] = useState(() => (
    nextHomeFollowCenter(null, useLocationStore.getState().currentLocation, { force: true })
  ));
  const followCenterRef = useRef(followCenter);
  const bottomSheetRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [startingStreetHail, setStartingStreetHail] = useState(false);
  const [streetHailSetup, setStreetHailSetup] = useState(null);
  const snapPoints = useMemo(() => {
    if (isLandscape) return ['36%', '88%'];
    if (isCompactHeight) return ['34%', '88%'];
    return activeTrip ? ['28%', '82%'] : ['38%', '88%'];
  }, [isLandscape, isCompactHeight, activeTrip]);

  const { data: stats, refetch: refetchStats } = useTodayStats();
  const { data: activeTripData } = useActiveTrip();
  const { data: commissionData, refetch: refetchCommission } = useCommissionBalance();
  const showCommissionDebt = shouldShowCommissionDebtUi(commissionData)
    && (Boolean(commissionData?.isBlocked) || commissionData?.balance > 0);
  const showWeeklyManualLock = Boolean(
    commissionData?.isWeekly && commissionData?.blockReason === 'manual',
  );
  const { data: todayTrips, isLoading: tripsLoading, isFetching: tripsFetching, refetch: refetchTrips } = useTripHistory('today');
  // Con placeholderData, isLoading es false si hay cache. Solo mostramos skeleton la primera vez.
  const showTripsSkeleton = tripsLoading && !todayTrips;

  const isOnline = driver?.is_available || false;

  const applyHomeCameraTarget = useCallback((loc, options = {}) => {
    const { force = false, duration = 0 } = options;
    const next = nextHomeFollowCenter(followCenterRef.current, loc, { force });
    if (!next) return false;
    const changed = !followCenterRef.current
      || followCenterRef.current.lat !== next.lat
      || followCenterRef.current.lng !== next.lng;
    followCenterRef.current = next;
    lastCameraFollowRef.current = next;
    pendingCenterRef.current = next;
    if (changed) setFollowCenter(next);
    if (mapReadyRef.current && mapRef.current) {
      mapRef.current.setCamera({
        centerCoordinate: [next.lng, next.lat],
        zoomLevel: HOME_CAMERA_ZOOM,
        animationDuration: duration,
        animationMode: 'easeTo',
      });
      pendingCenterRef.current = null;
    }
    return true;
  }, []);

  const handleMapReady = useCallback(() => {
    mapReadyRef.current = true;
    const loc = pendingCenterRef.current
      || followCenterRef.current
      || useLocationStore.getState().currentLocation;
    if (loc) applyHomeCameraTarget(loc, { force: true, duration: 0 });
  }, [applyHomeCameraTarget]);

  // Solo mientras Home tiene foco: evita que este watcher compita con
  // startNavigationWatch de ActiveTrip (Home queda montado en el stack).
  useFocusEffect(
    useCallback(() => {
      if (!driver?.id) return undefined;

      isHomeFocusedRef.current = true;
      lastCameraFollowRef.current = null;
      let cancelled = false;
      const init = async () => {
        const loc = await getCurrentPosition({ syncToSupabase: isOnline, force: true });
        if (cancelled) return;
        startWatching({ mapOnly: !isOnline });
        const coords = loc || useLocationStore.getState().currentLocation;
        if (coords) applyHomeCameraTarget(coords, { force: true, duration: 0 });
      };
      init();

      return () => {
        cancelled = true;
        isHomeFocusedRef.current = false;
        stopWatching();
      };
    }, [driver?.id, isOnline, getCurrentPosition, startWatching, stopWatching, applyHomeCameraTarget]),
  );

  // Recover any pending trip that arrived while the app was in the background/killed
  const checkPendingTripFromDB = useCallback(async () => {
    if (!driver?.id) return;
    const { pendingTrip: current, showNewTripModal, setPendingTrip, clearPendingTrip, updatePendingTrip } = useTripStore.getState();

    try {
      const { data } = await supabase
        .from('trips')
        .select('*')
        .eq('driver_id', driver.id)
        .eq('status', 'pending')
        .order('assigned_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (data) {
        // Si cambió el pending o el modal no está visible, refrescar estado para mostrarlo.
        if (current?.id !== data.id || !showNewTripModal) {
          setPendingTrip(data);
        } else if (current.notes !== data.notes) {
          updatePendingTrip(data);
        }
      } else if (current) {
        // Evita quedar con pending stale cuando Realtime/push fallan.
        clearPendingTrip();
      }
    } catch (_) {}
  }, [driver?.id]);

  useAppResumeHydrator(checkPendingTripFromDB);

  useEffect(() => {
    if (!driver?.id) return undefined;

    subscribeToNewTrips();
    subscribeToMessages();
    subscribeToCommissionPayments(() => {
      queryClient.invalidateQueries({ queryKey: ['commissionBalance', driver.id] });
    });
    // Check immediately in case a trip arrived while app was in background
    checkPendingTripFromDB();

    return () => {
      unsubscribeAll();
    };
  }, [
    driver?.id,
    subscribeToNewTrips,
    subscribeToMessages,
    subscribeToCommissionPayments,
    checkPendingTripFromDB,
    unsubscribeAll,
  ]);

  // Al volver, el GPS se recentra; el viaje pendiente lo rehidrata el overlay raíz.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (!isHomeFocusedRef.current || !driver?.id) return;
      void (async () => {
        const loc = await getCurrentPosition({
          syncToSupabase: isOnline,
          force: true,
        });
        const coords = loc || useLocationStore.getState().currentLocation;
        if (coords) applyHomeCameraTarget(coords, { force: true, duration: 0 });
      })();
    });
    return () => sub.remove();
  }, [applyHomeCameraTarget, driver?.id, getCurrentPosition, isOnline]);

  // Fallback liviano: si Realtime/push fallan, revalidar pending asignado periódicamente.
  useEffect(() => {
    if (!driver?.id) return;
    const intervalId = setInterval(() => {
      checkPendingTripFromDB();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [driver?.id, checkPendingTripFromDB]);

  const hasGpsFix = Number.isFinite(Number(currentLocation?.lat))
    && Number.isFinite(Number(currentLocation?.lng));

  useEffect(() => {
    if (!pendingTrip?.id || !hasGpsFix) return;
    prefetchDriverToPickupRoute(pendingTrip, useLocationStore.getState().currentLocation);
  }, [
    pendingTrip?.id,
    pendingTrip?.origin_lat,
    pendingTrip?.origin_lng,
    pendingTrip?.destination_lat,
    pendingTrip?.destination_lng,
    hasGpsFix,
  ]);

  // Seguir GPS en Home solo con foco y si el punto se movió lo suficiente.
  useEffect(() => {
    if (!currentLocation || !isHomeFocusedRef.current) return;
    if (shouldSkipHomeCameraFollow(lastCameraFollowRef.current, currentLocation)) {
      return;
    }
    applyHomeCameraTarget(currentLocation, {
      duration: lastCameraFollowRef.current ? 400 : 0,
    });
  }, [currentLocation?.lat, currentLocation?.lng, applyHomeCameraTarget]);

  useEffect(() => {
    if (!isFocused) {
      mapReadyRef.current = false;
    }
  }, [isFocused]);

  const autoNavTripIdRef = useRef(null);
  useEffect(() => {
    const liveTrip = resolveLiveTripForNavigation(
      useTripStore.getState().activeTrip,
      activeTripData,
      useTripStore.getState().ignoredTripId,
    );
    const tripId = liveTrip?.id ?? null;
    if (!tripId) {
      autoNavTripIdRef.current = null;
      return;
    }
    // Solo auto-navegar cuando aparece un viaje nuevo; no re-navegar en cada refetch/realtime.
    if (autoNavTripIdRef.current === tripId) return;
    autoNavTripIdRef.current = tripId;
    navigation.navigate('ActiveTrip');
  }, [activeTripData?.id, activeTripData?.status, ignoredTripId, navigation]);

  useFocusEffect(
    useCallback(() => {
      const liveTrip = resolveLiveTripForNavigation(
        useTripStore.getState().activeTrip,
        activeTripData,
        useTripStore.getState().ignoredTripId,
      );
      if (!liveTrip?.id) return undefined;
      navigation.navigate('ActiveTrip');
      return undefined;
    }, [activeTripData?.id, activeTripData?.status, ignoredTripId, navigation]),
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([refetchStats(), refetchTrips(), refetchCommission(), getCurrentPosition()]);
    setRefreshing(false);
  }, []);

  const handleToggleStatus = async () => {
    if (!driver?.id) return;
    const newStatus = !isOnline;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (newStatus && commissionData?.isBlocked) {
      const isManualWeekly = commissionData?.isWeekly && commissionData?.blockReason === 'manual';
      const toastPayload = {
        type: 'error',
        text1: 'Cuenta bloqueada',
        visibilityTime: 4000,
      };
      if (!isManualWeekly) {
        toastPayload.text2 = commissionData?.blockReason === 'manual'
          ? 'Tu cuenta fue bloqueada por la central. Contactá a la administración.'
          : 'Regularizá tus comisiones para poder conectarte';
      }
      Toast.show(toastPayload);
      return;
    }

    try {
      await setDriverOnlineStatus(driver.id, newStatus);

      await supabase.from('driver_locations').upsert({
        driver_id: driver.id,
        is_online: newStatus,
        lat: useLocationStore.getState().currentLocation?.lat ?? null,
        lng: useLocationStore.getState().currentLocation?.lng ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' });

      updateDriver({ is_available: newStatus });
      if (newStatus) {
        await getCurrentPosition({ syncToSupabase: true, force: true });
        await startWatching({ mapOnly: false });
      } else {
        await stopWatching({ markOffline: true });
      }

      Toast.show({
        type: 'success',
        text1: newStatus ? 'Estás en línea' : 'Estás desconectado',
        text2: newStatus ? 'Vas a recibir viajes' : 'No recibirás viajes',
      });
    } catch (e) {
      Toast.show({ type: 'error', text1: 'Error', text2: e.message || 'No se pudo cambiar el estado' });
    }
  };

  const handleStartStreetHail = useCallback(async () => {
    if (startingStreetHail || activeTrip || streetHailSetup) return;

    if (commissionData?.isBlocked) {
      Toast.show({
        type: 'error',
        text1: 'Cuenta bloqueada',
        text2: 'Regularizá tu cuenta para tomar viajes en calle.',
      });
      return;
    }

    if (!isOnline) {
      Toast.show({
        type: 'error',
        text1: 'Ponete en línea',
        text2: 'Activá tu estado para tomar un viaje en calle.',
      });
      return;
    }

    if (pendingTrip?.id) {
      Toast.show({
        type: 'error',
        text1: 'Tenés un viaje asignado',
        text2: 'Aceptá o rechazá la solicitud antes de tomar un viaje en calle.',
      });
      return;
    }

    let loc = useLocationStore.getState().currentLocation;
    if (!Number.isFinite(Number(loc?.lat)) || !Number.isFinite(Number(loc?.lng))) {
      loc = await getCurrentPosition({ force: true });
    }
    if (!Number.isFinite(Number(loc?.lat)) || !Number.isFinite(Number(loc?.lng))) {
      Toast.show({
        type: 'error',
        text1: 'Sin GPS',
        text2: 'Esperá a que se fije tu ubicación y volvé a intentar.',
      });
      return;
    }

    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setStreetHailSetup({
      lat: loc.lat,
      lng: loc.lng,
      address: loc.address || '',
    });
  }, [
    startingStreetHail,
    activeTrip,
    streetHailSetup,
    commissionData?.isBlocked,
    isOnline,
    pendingTrip?.id,
    getCurrentPosition,
  ]);

  const startStreetHailTripNow = useCallback(async (destination = null) => {
    if (startingStreetHail || !streetHailSetup) return;
    setStartingStreetHail(true);
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    try {
      const result = await createStreetHailTrip({
        lat: streetHailSetup.lat,
        lng: streetHailSetup.lng,
        address: streetHailSetup.address,
        destination,
        startNow: true,
      });
      if (result?.success) {
        setStreetHailSetup(null);
        navigation.navigate('ActiveTrip');
      }
    } finally {
      setStartingStreetHail(false);
    }
  }, [startingStreetHail, streetHailSetup, createStreetHailTrip, navigation]);

  const handleRejectTrip = async (tripId, reason) => {
    await rejectTrip(tripId, reason);
  };

  const recenter = () => {
    const loc = useLocationStore.getState().currentLocation || followCenterRef.current;
    if (!loc) return;
    applyHomeCameraTarget(loc, { force: true, duration: 500 });
  };

  const cameraCoordinate = useMemo(
    () => toCameraLngLat(followCenter) ?? toCameraLngLat(currentLocation),
    [followCenter?.lat, followCenter?.lng, currentLocation?.lat, currentLocation?.lng],
  );
  const cameraBootKey = cameraCoordinate ? 'gps' : 'boot';

  const allTrips = todayTrips?.pages?.flatMap((p) => p.data) || [];
  const firstName = driver?.full_name?.split(' ')[0] || 'Chofer';
  const initials = driver?.full_name?.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase() || '?';

  // Home queda montado detrás de ActiveTrip. Si el BottomSheet sigue vivo,
  // Gorhom dispara onChange(-1/0) en loop y tumba toda la app.
  if (!isFocused) {
    return <View style={{ flex: 1, backgroundColor: colors.background }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      {/* MAPA */}
      <MapLibreGL.MapView
        style={StyleSheet.absoluteFillObject}
        mapStyle={MAPLIBRE_STYLE}
        compassEnabled={false}
        logoEnabled={false}
        attributionEnabled={false}
        onDidFinishLoadingMap={handleMapReady}
        onDidFinishLoadingStyle={handleMapReady}
      >
        <MapLibreGL.Camera
          key={cameraBootKey}
          ref={mapRef}
          defaultSettings={{
            centerCoordinate: cameraCoordinate
              ?? [DEFAULT_REGION.longitude, DEFAULT_REGION.latitude],
            zoomLevel: HOME_CAMERA_ZOOM,
          }}
          {...(cameraCoordinate ? {
            center: cameraCoordinate,
            zoom: HOME_CAMERA_ZOOM,
          } : {})}
        />
        {currentLocation ? <HomeDriverPuck /> : null}
      </MapLibreGL.MapView>

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
        {/* Chip de conductor */}
        <View style={{
          flexDirection: 'row', alignItems: 'center',
          backgroundColor: 'rgba(255,255,255,0.96)',
          borderRadius: 24, paddingVertical: 6, paddingHorizontal: 10,
          borderWidth: 1, borderColor: colors.borderLight,
          boxShadow: '0 3px 12px rgba(15,23,42,0.10)',
          gap: 8,
        }}>
          <View style={{
            width: 38, height: 38, borderRadius: 19,
            backgroundColor: colors.surfaceLight,
            borderWidth: 2, borderColor: isOnline ? colors.success : colors.border,
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            {driver?.photo_url ? (
              <Image source={{ uri: driver.photo_url }} style={{ width: 38, height: 38, borderRadius: 19 }} contentFit="cover" />
            ) : (
              <Text style={{ color: colors.primary, fontSize: 14, fontFamily: 'Inter_700Bold' }}>{initials}</Text>
            )}
          </View>
          <View>
            <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }}>
              {firstName}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <View style={{
                width: 7, height: 7, borderRadius: 3.5,
                backgroundColor: isOnline ? colors.success : colors.offline,
              }} />
              <Text style={{
                color: isOnline ? colors.success : colors.textLight,
                fontSize: 10, fontFamily: 'Inter_600SemiBold',
              }}>
                {isOnline ? 'En línea' : 'Desconectado'}
              </Text>
            </View>
          </View>
        </View>

        {/* Botón notificaciones */}
        <Pressable style={({ pressed }) => ({
          width: 42, height: 42, borderRadius: 21,
          backgroundColor: 'rgba(255,255,255,0.96)',
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: colors.borderLight,
          boxShadow: '0 3px 12px rgba(15,23,42,0.10)',
          opacity: pressed ? 0.7 : 1,
        })}>
          <Ionicons name="notifications-outline" size={21} color={colors.secondary} />
        </Pressable>
      </View>

      {/* Controles flotantes del mapa — grupo derecho */}
      <View style={{
        position: 'absolute', right: 14, top: insets.top + 70,
        gap: 10,
      }}>
        <Pressable onPress={recenter} style={({ pressed }) => ({
          width: 44, height: 44, borderRadius: 22,
          backgroundColor: 'rgba(255,255,255,0.97)',
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 1, borderColor: colors.borderLight,
          boxShadow: '0 3px 12px rgba(15,23,42,0.12)',
          opacity: pressed ? 0.7 : 1,
        })}>
          <Ionicons name="locate" size={22} color={colors.primary} />
        </Pressable>
      </View>

      {/* Botón de voz — grupo izquierdo */}
      <View style={{
        position: 'absolute', left: 14, top: insets.top + 70,
      }}>
        <Pressable
          onPress={() => setShowVoice(true)}
          style={({ pressed }) => ({
            width: 44, height: 44, borderRadius: 22,
            backgroundColor: 'rgba(255,255,255,0.97)',
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: colors.borderLight,
            boxShadow: '0 3px 12px rgba(15,23,42,0.12)',
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <MaterialCommunityIcons name="radio-tower" size={21} color={colors.primary} />
        </Pressable>
      </View>

      {streetHailSetup ? (
        <StreetHailSetupSheet
          confirming={startingStreetHail}
          onCancel={() => {
            if (startingStreetHail) return;
            setStreetHailSetup(null);
          }}
          onChooseFreeRide={() => startStreetHailTripNow(null)}
          onConfirmDestination={(destination) => startStreetHailTripNow(destination)}
        />
      ) : null}

      {/* ========== BOTTOM SHEET ========== */}
      {streetHailSetup ? null : (
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
        enableDynamicSizing={false}
        animateOnMount={false}
        enableContentPanningGesture
        enableHandlePanningGesture
        activeOffsetY={SHEET_PAN_ACTIVE_OFFSET_Y}
        failOffsetX={SHEET_PAN_FAIL_OFFSET_X}
        handleStyle={{ paddingVertical: 14 }}
        backgroundStyle={{
          backgroundColor: '#FFFFFF',
          borderTopLeftRadius: 28,
          borderTopRightRadius: 28,
          boxShadow: '0 -6px 16px rgba(0,0,0,0.08)',
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

          {/* Toggle estado — se oculta si hay un viaje activo */}
          {!activeTrip && (
            <Pressable onPress={handleToggleStatus}
              style={({ pressed }) => ({
                borderRadius: 20,
                overflow: 'hidden',
                boxShadow: isOnline
                  ? '0 6px 20px rgba(22,199,132,0.28)'
                  : '0 4px 14px rgba(15,23,42,0.07)',
                opacity: pressed ? 0.93 : 1,
              })}>
              <LinearGradient
                colors={isOnline ? ['#1AD98A', '#0DAA6E'] : ['#F8F9FC', '#F1F4F9']}
                start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  paddingVertical: 15, paddingHorizontal: 16,
                  borderWidth: isOnline ? 0 : 1,
                  borderColor: colors.borderLight,
                  borderRadius: 20,
                }}
              >
                {/* Ícono de estado */}
                <View style={{
                  width: 48, height: 48, borderRadius: 24,
                  backgroundColor: isOnline ? 'rgba(255,255,255,0.22)' : colors.surfaceLight,
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons
                    name={isOnline ? 'steering' : 'power-standby'}
                    size={24}
                    color={isOnline ? '#FFFFFF' : colors.textMuted}
                  />
                </View>

                {/* Texto */}
                <View style={{ flex: 1, marginLeft: 13 }}>
                  <Text style={{
                    fontSize: 16, fontFamily: 'Inter_700Bold',
                    color: isOnline ? '#FFFFFF' : colors.text,
                  }}>
                    {isOnline ? 'Estás en línea' : 'Estás desconectado'}
                  </Text>
                  <Text style={{
                    fontSize: 12, fontFamily: 'Inter_500Medium',
                    color: isOnline ? 'rgba(255,255,255,0.80)' : colors.textMuted,
                    marginTop: 3,
                  }}>
                    {isOnline ? 'Recibiendo solicitudes de viaje' : 'Tocá para empezar a recibir viajes'}
                  </Text>
                </View>

                {/* Indicador ON/OFF */}
                <View style={{
                  width: 52, height: 28, borderRadius: 14,
                  backgroundColor: isOnline ? 'rgba(255,255,255,0.22)' : '#E2E8F0',
                  justifyContent: 'center', paddingHorizontal: 3,
                }}>
                  <View style={{
                    width: 22, height: 22, borderRadius: 11, backgroundColor: '#fff',
                    alignSelf: isOnline ? 'flex-end' : 'flex-start',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
                  }} />
                </View>
              </LinearGradient>
            </Pressable>
          )}

          {!activeTrip ? (
            <StreetHailHomeButton
              online={isOnline}
              loading={startingStreetHail}
              compact={isLandscape || isCompactHeight}
              disabled={Boolean(pendingTrip)}
              onPress={handleStartStreetHail}
            />
          ) : null}

        </View>

        {/* Divisor */}
        <View style={{ height: 1, backgroundColor: '#F3F4F6', marginHorizontal: 16, marginBottom: 2 }} />

        {/* ── ZONA SCROLL: stats + historial ── */}
        <BottomSheetScrollView
          contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 90 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh}
              tintColor={colors.primary} colors={[colors.primary]} />
          }
          showsVerticalScrollIndicator={false}
        >
          {/* Comisiones pendientes: solo plan commission_current. Semanal acumula
              en BD para el dashboard, pero no muestra saldo al chofer. */}
          {showWeeklyManualLock ? (
            <Animated.View entering={FadeInUp.duration(200)}>
              <View style={{
                backgroundColor: '#EEEEF8',
                borderRadius: 14, padding: 14, marginBottom: 12,
                borderWidth: 1, borderColor: '#C5C8E8',
                flexDirection: 'row', alignItems: 'center',
              }}>
                <MaterialCommunityIcons name="lock" size={17} color="#282e69" />
                <Text style={{
                  color: '#DC2626',
                  fontSize: 13, fontFamily: 'Inter_700Bold', marginLeft: 7,
                }}>
                  Cuenta bloqueada
                </Text>
              </View>
            </Animated.View>
          ) : null}
          {showCommissionDebt ? (
            <Animated.View entering={FadeInUp.duration(200)}>
              <CommissionDebtBanner
                commissionData={commissionData}
                onPayPress={() => navigation.navigate('CommissionPayment', { commissionData, autoStart: true })}
              />
            </Animated.View>
          ) : null}

          {/* ── Card de ganancias del día ── */}
          <Animated.View entering={FadeInUp.duration(180)} style={{ marginBottom: 10 }}>
            <LinearGradient
              colors={[colors.primary, colors.primaryDark]}
              start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
              style={{
                borderRadius: 20, padding: 18,
                flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
              }}
            >
              <View>
                <Text style={{ color: 'rgba(255,255,255,0.72)', fontSize: 11, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 }}>
                  GANANCIAS DE HOY
                </Text>
                <Text style={{ color: '#FFFFFF', fontSize: 30, fontFamily: 'Inter_700Bold', marginTop: 4, lineHeight: 34 }}>
                  {formatPrice(stats?.totalEarnings || 0)}
                </Text>
                <Text style={{ color: 'rgba(255,255,255,0.58)', fontSize: 11, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                  {stats?.totalTrips || 0} {stats?.totalTrips === 1 ? 'viaje' : 'viajes'} · {stats?.totalHours || 0}h de trabajo
                </Text>
              </View>
              <View style={{
                width: 56, height: 56, borderRadius: 28,
                backgroundColor: 'rgba(255,255,255,0.15)',
                alignItems: 'center', justifyContent: 'center',
              }}>
                <MaterialCommunityIcons name="cash-multiple" size={28} color="rgba(255,255,255,0.90)" />
              </View>
            </LinearGradient>
          </Animated.View>

          {/* ── Stats secundarias ── */}
          <Animated.View entering={FadeInUp.duration(200)}>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 4 }}>
              <MiniStat
                icon="car-side"
                label="Viajes"
                value={String(stats?.totalTrips || 0)}
                color={colors.primary}
              />
              <MiniStat
                icon="map-marker-distance"
                label="Distancia"
                value={formatDistance(stats?.totalKm)}
                color={colors.info}
                bg={colors.infoBg}
              />
              <MiniStat
                icon="clock-outline"
                label="Horas"
                value={`${stats?.totalHours || 0}h`}
                color={colors.warning}
                bg={colors.warningBg}
              />
            </View>
          </Animated.View>

          {/* Viaje activo */}
          {activeTrip && (
            <Animated.View entering={SlideInRight.delay(100).springify()} style={{ marginTop: 10, marginBottom: 2 }}>
              <Pressable onPress={() => navigation.navigate('ActiveTrip')}
                style={({ pressed }) => ({
                  borderRadius: 18, overflow: 'hidden',
                  opacity: pressed ? 0.88 : 1,
                  boxShadow: '0 4px 16px rgba(40,46,105,0.22)',
                })}>
                <LinearGradient
                  colors={[colors.primaryLight, colors.primary]}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{
                    flexDirection: 'row', alignItems: 'center',
                    paddingVertical: 14, paddingHorizontal: 16,
                  }}
                >
                  <View style={{
                    width: 42, height: 42, borderRadius: 21,
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <MaterialCommunityIcons name="navigation" size={22} color="#fff" />
                  </View>
                  <View style={{ flex: 1, marginLeft: 13 }}>
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.5 }}>
                      VIAJE EN CURSO
                    </Text>
                    <Text style={{ color: '#FFFFFF', fontSize: 14, fontFamily: 'Inter_600SemiBold', marginTop: 2 }} numberOfLines={1}>
                      {activeTrip.destination_address || 'Ver mapa'}
                    </Text>
                  </View>
                  <View style={{
                    backgroundColor: 'rgba(255,255,255,0.18)',
                    borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6,
                    flexDirection: 'row', alignItems: 'center', gap: 4,
                  }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontFamily: 'Inter_700Bold' }}>Ver</Text>
                    <Ionicons name="chevron-forward" size={14} color="rgba(255,255,255,0.9)" />
                  </View>
                </LinearGradient>
              </Pressable>
            </Animated.View>
          )}

          {/* Actividad reciente */}
          <Animated.View entering={FadeInUp.duration(200)} style={{ marginTop: 18 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <Text style={{ color: '#111827', fontSize: 15, fontFamily: 'Inter_700Bold' }}>
                Actividad reciente
              </Text>
              {allTrips.length > 0 && (
                <Pressable onPress={() => navigation.navigate('History')}>
                  <Text style={{ color: colors.primary, fontSize: 12, fontFamily: 'Inter_600SemiBold' }}>Ver todo →</Text>
                </Pressable>
              )}
            </View>

            {showTripsSkeleton ? (
              <SkeletonTrips />
            ) : allTrips.length > 0 ? (
              allTrips.slice(0, 4).map((trip, idx) => (
                <Animated.View key={trip.id} entering={TRIP_ROW_ENTER[idx] || TRIP_ROW_ENTER[0]}>
                  <TripRow trip={trip} onOpen={openTripDetail} />
                </Animated.View>
              ))
            ) : (
              <Animated.View entering={FadeInUp.duration(200)}>
                <View style={{
                  backgroundColor: colors.surface,
                  borderRadius: 20, paddingVertical: 32, paddingHorizontal: 20,
                  alignItems: 'center',
                  borderWidth: 1, borderColor: colors.borderLight,
                  boxShadow: '0 2px 8px rgba(15,23,42,0.04)',
                }}>
                  <View style={{
                    width: 64, height: 64, borderRadius: 32,
                    backgroundColor: colors.surfaceLight,
                    alignItems: 'center', justifyContent: 'center',
                    marginBottom: 14,
                  }}>
                    <MaterialCommunityIcons name={isOnline ? 'car-clock' : 'car-off'} size={34} color={colors.textLight} />
                  </View>
                  <Text style={{ color: colors.textDark, fontSize: 16, fontFamily: 'Inter_700Bold', marginBottom: 6 }}>
                    Sin viajes hoy
                  </Text>
                  <Text style={{ color: colors.textMuted, fontSize: 13, fontFamily: 'Inter_400Regular', textAlign: 'center', lineHeight: 19 }}>
                    {isOnline
                      ? 'Estás en línea y esperando asignaciones'
                      : 'Activá tu estado para empezar a recibir viajes'
                    }
                  </Text>
                </View>
              </Animated.View>
            )}
          </Animated.View>
        </BottomSheetScrollView>
      </BottomSheet>
      )}

      <NewTripModal
        visible={showNewTripModal}
        trip={pendingTrip}
        parallelOffer={Boolean(
          isNextTripOffer(pendingTrip)
          || (isLiveDriverTrip(activeTrip) && pendingTrip?.id && pendingTrip.id !== activeTrip.id)
        )}
        onAccept={async (id) => {
          const result = await acceptTrip(id);
          if (result?.success && !result.queuedNext) {
            navigation.navigate('ActiveTrip');
          }
          return result;
        }}
        onReject={handleRejectTrip}
      />

      <VoiceChatModal visible={showVoice} onClose={() => setShowVoice(false)} />
    </View>
  );
};

/* ========== COMPONENTES ========== */

/**
 * Tarjeta de estadística del día — diseño de app premium.
 * Muestra ícono con fondo de color, valor grande y label.
 */
const MiniStat = ({ icon, label, value, color, bg }) => (
  <View style={{
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderLight,
    boxShadow: '0 2px 8px rgba(15,23,42,0.06)',
  }}>
    <View style={{
      width: 34, height: 34, borderRadius: 10,
      backgroundColor: bg || `${color}18`,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 7,
    }}>
      <MaterialCommunityIcons name={icon} size={17} color={color} />
    </View>
    <Text
      style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_700Bold', width: '100%', textAlign: 'center' }}
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.5}
    >
      {value}
    </Text>
    <Text style={{ color: colors.textLight, fontSize: 9, fontFamily: 'Inter_600SemiBold', marginTop: 3, letterSpacing: 0.3 }}>
      {label.toUpperCase()}
    </Text>
  </View>
);

/**
 * Fila de viaje reciente — diseño limpio con indicador de color de estado.
 */
const TripRow = React.memo(({ trip, onOpen }) => {
  const cfg = TRIP_STATUS_UI[trip.status] || { color: colors.textMuted, icon: 'car', bg: colors.surfaceLight };
  const time = trip.created_at
    ? new Date(trip.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Pressable onPress={() => onOpen(trip.id)} style={({ pressed }) => ({
      flexDirection: 'row', alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: 16, padding: 13, marginBottom: 8,
      borderWidth: 1, borderColor: colors.borderLight,
      boxShadow: '0 2px 6px rgba(15,23,42,0.05)',
      opacity: pressed ? 0.75 : 1,
    })}>
      <View style={{
        width: 40, height: 40, borderRadius: 13,
        backgroundColor: cfg.bg, alignItems: 'center', justifyContent: 'center',
      }}>
        <MaterialCommunityIcons name={cfg.icon} size={20} color={cfg.color} />
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <Text style={{ color: colors.text, fontSize: 13, fontFamily: 'Inter_600SemiBold' }} numberOfLines={1}>
          {trip.destination_address || 'Viaje sin destino'}
        </Text>
        <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_400Regular', marginTop: 2 }}>
          {time}{trip.distance_km ? ` · ${formatDistance(trip.distance_km)}` : ''}
        </Text>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 3 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' }}>
          {trip.price != null ? formatPrice(trip.price) : '—'}
        </Text>
        {(trip.commission_amount > 0) && (
          <Text style={{ color: colors.warning, fontSize: 10, fontFamily: 'Inter_600SemiBold' }}>
            Com. {formatPrice(trip.commission_amount)}
          </Text>
        )}
      </View>
    </Pressable>
  );
});

/**
 * Skeleton de carga para la lista de viajes.
 */
const SkeletonTrips = () => (
  <View>
    {[1, 2, 3].map(i => (
      <View key={i} style={{
        backgroundColor: colors.surfaceRaised,
        borderRadius: 16, height: 68, marginBottom: 8,
        borderWidth: 1, borderColor: colors.borderLight,
        opacity: 0.5 + (i * 0.1),
      }} />
    ))}
  </View>
);

export default HomeScreen;
