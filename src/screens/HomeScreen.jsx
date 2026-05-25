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
import { useNavigation } from '@react-navigation/native';
import MapView, { Marker, Circle, PROVIDER_GOOGLE } from 'react-native-maps';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import BottomSheet, { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { colors } from '../theme/colors';
import { useAuthStore } from '../stores/authStore';
import { useTripStore } from '../stores/tripStore';
import { useLocationStore } from '../stores/locationStore';
import { useTrips } from '../hooks/useTrips';
import { useRealtime } from '../hooks/useRealtime';
import { useQueryClient } from '@tanstack/react-query';
import { useLocation } from '../hooks/useLocation';
import { supabase } from '../services/supabase';
import { NewTripModal } from '../components/trip/NewTripModal';
import { VoiceChatModal } from '../components/VoiceChatModal';
import { formatPrice, formatDistance } from '../utils/formatters';
import { DEFAULT_REGION } from '../utils/constants';
import Toast from 'react-native-toast-message';
import * as Haptics from 'expo-haptics';

const DriverLocationMarker = React.memo(({ location }) => {
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
        {/* Halo exterior pulsante */}
        <View style={{
          position: 'absolute',
          width: 52, height: 52, borderRadius: 26,
          backgroundColor: `${colors.primary}18`,
          borderWidth: 1.5, borderColor: `${colors.primary}30`,
        }} />
        {/* Marcador principal */}
        <View style={{
          width: 38, height: 38, borderRadius: 19,
          backgroundColor: colors.primary,
          alignItems: 'center', justifyContent: 'center',
          borderWidth: 2.5, borderColor: '#FFFFFF',
          boxShadow: '0 3px 10px rgba(40,46,105,0.45)',
        }}>
          <MaterialCommunityIcons name="navigation" size={20} color="#fff" />
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
  const { subscribeToNewTrips, subscribeToMessages, subscribeToCommissionPayments } = useRealtime();
  const queryClient = useQueryClient();
  const { requestPermissions, getCurrentPosition, startWatching, stopWatching } = useLocation();
  const mapRef = useRef(null);
  const bottomSheetRef = useRef(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showVoice, setShowVoice] = useState(false);
  const [sheetIndex, setSheetIndex] = useState(0);
  const snapPoints = useMemo(() => ['28%', '72%'], []);

  const { data: stats, refetch: refetchStats } = useTodayStats();
  const { data: activeTripData } = useActiveTrip();
  const { data: commissionData } = useCommissionBalance();
  const { data: todayTrips, isLoading: tripsLoading, refetch: refetchTrips } = useTripHistory('today');

  const isOnline = driver?.is_available || false;

  useEffect(() => {
    if (!driver?.id) return;

    let cancelled = false;
    const init = async () => {
      await requestPermissions();
      await getCurrentPosition({ syncToSupabase: isOnline });
      if (cancelled) return;
      if (isOnline) startWatching();
    };
    init();
    return () => {
      cancelled = true;
      stopWatching();
    };
  }, [driver?.id, isOnline]);

  // Recover any pending trip that arrived while the app was in the background/killed
  const checkPendingTripFromDB = useCallback(async () => {
    if (!driver?.id) return;
    const { pendingTrip: current, showNewTripModal, setPendingTrip, clearPendingTrip } = useTripStore.getState();

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
        }
      } else if (current) {
        // Evita quedar con pending stale cuando Realtime/push fallan.
        clearPendingTrip();
      }
    } catch (_) {}
  }, [driver?.id]);

  useEffect(() => {
    if (driver?.id) {
      subscribeToNewTrips();
      subscribeToMessages();
      subscribeToCommissionPayments(() => {
        queryClient.invalidateQueries({ queryKey: ['commissionBalance', driver.id] });
      });
      // Check immediately in case a trip arrived while app was in background
      checkPendingTripFromDB();
    }
  }, [driver?.id, subscribeToNewTrips, subscribeToMessages, subscribeToCommissionPayments, checkPendingTripFromDB]);

  // Re-check every time the app comes back to foreground
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        checkPendingTripFromDB();
      }
    });
    return () => sub.remove();
  }, [checkPendingTripFromDB]);

  // Fallback liviano: si Realtime/push fallan, revalidar pending asignado periódicamente.
  useEffect(() => {
    if (!driver?.id) return;
    const intervalId = setInterval(() => {
      checkPendingTripFromDB();
    }, 20000);
    return () => clearInterval(intervalId);
  }, [driver?.id, checkPendingTripFromDB]);

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
        lat: currentLocation?.lat ?? null,
        lng: currentLocation?.lng ?? null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'driver_id' });

      updateDriver({ is_available: newStatus });
      if (newStatus) {
        await getCurrentPosition({ syncToSupabase: true });
        startWatching();
      } else {
        stopWatching();
      }

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
              radius={200}
              fillColor="rgba(40,46,105,0.06)"
              strokeColor="rgba(40,46,105,0.12)"
              strokeWidth={1}
            />
            <DriverLocationMarker location={currentLocation} />
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

      {/* ========== BOTTOM SHEET ========== */}
      <BottomSheet
        ref={bottomSheetRef}
        index={0}
        snapPoints={snapPoints}
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
        onChange={(index) => setSheetIndex(index)}
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
          {/* Alerta de comisiones */}
          {commissionData && commissionData.balance > 0 && (
            <Animated.View entering={FadeInUp.delay(60).duration(350)}>
              <View style={{
                backgroundColor: commissionData.isOverdue ? '#EEEEF8' : '#FFFBEB',
                borderRadius: 14, padding: 14, marginBottom: 12,
                borderWidth: 1, borderColor: commissionData.isOverdue ? '#C5C8E8' : '#FDE68A',
              }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 5 }}>
                  <MaterialCommunityIcons
                    name={commissionData.isOverdue ? 'alert-circle' : 'cash-clock'}
                    size={17} color={commissionData.isOverdue ? '#282e69' : '#D97706'}
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
                  borderTopWidth: 1, borderTopColor: commissionData.isOverdue ? '#D5D8F0' : '#FEF3C7',
                }}>
                  <Text style={{ color: '#9CA3AF', fontSize: 10, fontFamily: 'Inter_500Medium' }}>Deuda actual</Text>
                  <Text style={{
                    color: commissionData.isOverdue ? '#282e69' : '#D97706',
                    fontSize: 16, fontFamily: 'Inter_700Bold',
                  }}>
                    {formatPrice(commissionData.balance)}
                  </Text>
                </View>
                <Pressable
                  onPress={() => navigation.navigate('CommissionPayment', { commissionData, autoStart: true })}
                  style={({ pressed }) => ({
                    marginTop: 10,
                    backgroundColor: commissionData.isOverdue ? '#282e69' : '#D97706',
                    borderRadius: 10, paddingVertical: 9,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
                    opacity: pressed ? 0.85 : 1,
                  })}
                >
                  <MaterialCommunityIcons name="credit-card-outline" size={15} color="#FFFFFF" />
                  <Text style={{ color: '#FFFFFF', fontSize: 13, fontFamily: 'Inter_700Bold' }}>
                    Pagar comisión
                  </Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* ── Card de ganancias del día ── */}
          <Animated.View entering={FadeInUp.delay(60).duration(350)} style={{ marginBottom: 10 }}>
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
          <Animated.View entering={FadeInUp.delay(80).duration(380)}>
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
          <Animated.View entering={FadeInUp.delay(140).duration(380)} style={{ marginTop: 18 }}>
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

            {tripsLoading ? (
              <SkeletonTrips />
            ) : allTrips.length > 0 ? (
              allTrips.slice(0, 4).map((trip, idx) => (
                <Animated.View key={trip.id} entering={FadeInUp.delay(150 + idx * 55).duration(320)}>
                  <TripRow trip={trip} onPress={() => navigation.navigate('TripDetail', { tripId: trip.id })} />
                </Animated.View>
              ))
            ) : (
              <Animated.View entering={FadeInUp.delay(160).duration(320)}>
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
const TripRow = ({ trip, onPress }) => {
  const statusConfig = {
    completed:       { color: colors.success,  icon: 'check-circle',  bg: colors.successBg },
    cancelled:       { color: colors.danger,   icon: 'close-circle',  bg: colors.dangerBg },
    in_progress:     { color: colors.primary,  icon: 'navigation',    bg: colors.surfaceLight },
    pending:         { color: colors.warning,  icon: 'clock-outline', bg: colors.warningBg },
    accepted:        { color: colors.info,     icon: 'car-arrow-right', bg: colors.infoBg },
    going_to_pickup: { color: colors.primary,  icon: 'car-arrow-right', bg: colors.surfaceLight },
  };
  const cfg = statusConfig[trip.status] || { color: colors.textMuted, icon: 'car', bg: colors.surfaceLight };
  const time = trip.created_at
    ? new Date(trip.created_at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
    : '';

  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({
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
};

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
