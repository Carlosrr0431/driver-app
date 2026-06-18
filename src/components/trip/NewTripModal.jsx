/**
 * Componente: NewTripModal
 * Que hace: Muestra la asignacion de un viaje nuevo con cuenta regresiva, detalle del recorrido y acciones de aceptar/rechazar.
 * Usado por:
 * - driver-app/src/screens/HomeScreen.jsx -> import { NewTripModal } from '../components/trip/NewTripModal';
 * - driver-app/src/screens/HomeScreen.old.jsx -> import { NewTripModal } from '../components/trip/NewTripModal';
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  View,
  Text,
  Modal,
  Linking,
  Vibration,
  TouchableOpacity,
  Pressable,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  FadeIn,
  FadeInDown,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useAudioPlayer, setAudioModeAsync } from 'expo-audio';
import { colors } from '../../theme/colors';
import { formatPrice, formatDistance, formatDuration } from '../../utils/formatters';
import { TRIP_ACCEPT_TIMEOUT, CANCEL_REASONS } from '../../utils/constants';
import {
  isApproachOnlyTrip,
  resolveTripPickupCoords,
  resolveTripFinalDestCoords,
  resolveTripWaypoints,
} from '../../../shared/trip-contract';
import { TripRouteTimeline } from './TripRouteTimeline';

// Clean notes: strip the [APPROACH_ONLY] tag and the boilerplate sentence
const getCleanNotes = (trip) => {
  if (!trip?.notes) return null;
  const cleaned = trip.notes
    .replace(/\[APPROACH_ONLY\]/gi, '')
    .replace(/\[FINAL_DEST_JSON:[^\]]*\]/g, '')
    .replace(/\[PICKUP_JSON:[^\]]*\]/g, '')
    .replace(/\[WAYPOINTS_JSON:[^\]]*\]/g, '')
    .replace(/\[PASSENGER_APP\]/gi, '')
    .replace(/Creado autom[aá]ticamente desde WhatsApp[^.]*\./gi, '')
    .replace(/chofer\s*->\s*retiro pasajero[^.]*\./gi, '')
    .replace(/Destino final:[^.]*\./gi, '')
    .replace(/Destino final sugerido:.*/gi, '')
    .trim();
  return cleaned || null;
};

// Countdown must be based on assignment time, not modal open time.
const getInitialCountdown = (trip) => {
  const assignedAtMs = trip?.assigned_at ? Date.parse(trip.assigned_at) : NaN;
  if (!Number.isFinite(assignedAtMs)) return TRIP_ACCEPT_TIMEOUT;
  // Evita que un reloj del dispositivo atrasado muestre mas segundos que el timeout real.
  const elapsedSeconds = Math.max(0, Math.floor((Date.now() - assignedAtMs) / 1000));
  return Math.max(0, TRIP_ACCEPT_TIMEOUT - elapsedSeconds);
};

export const NewTripModal = ({ visible, trip, onAccept, onReject }) => {
  const [countdown, setCountdown] = useState(() => getInitialCountdown(trip));
  const [showRejectSheet, setShowRejectSheet] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const countdownRef = useRef(null);
  const timeoutRef = useRef(null);
  const notifPlayer = useAudioPlayer(require('../../../assets/notification.wav'));
  const progressWidth = useSharedValue(100);
  const tripRef = useRef(trip);
  const onRejectRef = useRef(onReject);
  useEffect(() => { tripRef.current = trip; }, [trip]);
  useEffect(() => { onRejectRef.current = onReject; }, [onReject]);
  // Prevents both timer-timeout and manual-accept from firing simultaneously
  const decidedRef = useRef(false);

  const clearTimers = () => {
    if (countdownRef.current) {
      clearInterval(countdownRef.current);
      countdownRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  const handleTimeout = () => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    clearTimers();
    setCountdown(0);
    setIsDismissed(true);
    stopSound();
    onRejectRef.current?.(tripRef.current?.id, 'Tiempo agotado');
  };

  useEffect(() => {
    if (visible && trip) {
      decidedRef.current = false;
      setIsDismissed(false);
      setShowRejectSheet(false);
      setIsAccepting(false);
      clearTimers();

      const initialCountdown = getInitialCountdown(trip);
      const initialProgress = Math.max(0, (initialCountdown / TRIP_ACCEPT_TIMEOUT) * 100);

      setCountdown(initialCountdown);
      progressWidth.value = initialProgress;

      if (initialCountdown <= 0) {
        handleTimeout();
        return () => {
          clearTimers();
          stopSound();
        };
      }

      playNotificationSound();
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => Math.max(0, prev - 1));
      }, 1000);

      timeoutRef.current = setTimeout(handleTimeout, initialCountdown * 1000);
      progressWidth.value = withTiming(0, { duration: initialCountdown * 1000 });
    }

    return () => {
      clearTimers();
      stopSound();
    };
  }, [visible, trip?.id]);

  const playNotificationSound = async () => {
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
        allowsRecording: false,
      });
      notifPlayer.seekTo(0);
      notifPlayer.loop = true;
      notifPlayer.play();
    } catch {
      Vibration.vibrate([0, 300, 100, 300]);
    }
  };

  const stopSound = async () => {
    try {
      notifPlayer.pause();
    } catch (_) {}
  };

  const handleAccept = async () => {
    if (isAccepting || decidedRef.current) return;
    decidedRef.current = true;
    clearTimers();
    setIsAccepting(true);
    stopSound();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    try {
      if (onAccept) {
        const result = await onAccept(trip?.id);
        if (!result?.success) {
          setIsAccepting(false);
          Alert.alert(
            result?.isTimeout ? 'Tiempo agotado' : 'Error al aceptar',
            result?.isTimeout
              ? 'La confirmación tardó demasiado. Intentá de nuevo.'
              : 'No pudimos confirmar la aceptación. Intentá de nuevo.',
            [{ text: 'OK' }]
          );
        }
      }
    } catch {
      setIsAccepting(false);
      Alert.alert('Error', 'Ocurrió un error al aceptar el viaje.', [{ text: 'OK' }]);
    }
  };

  const handleRejectWithReason = (reason) => {
    if (decidedRef.current) return;
    decidedRef.current = true;
    clearTimers();
    setIsDismissed(true);
    setShowRejectSheet(false);
    stopSound();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (onReject) onReject(trip?.id, reason);
  };

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  if (!visible || !trip || isDismissed) return null;

  const isUrgent = countdown <= 10;
  const approachOnly = isApproachOnlyTrip(trip);
  const pickupResolved = resolveTripPickupCoords(trip);
  const destResolved = approachOnly ? resolveTripFinalDestCoords(trip) : null;
  const tripWaypoints = resolveTripWaypoints(trip);
  const pickupAddress = pickupResolved?.address || null;
  const destinationDisplayAddress = approachOnly
    ? (destResolved?.address || 'A definir al subir al pasajero')
    : (trip.destination_address || '—');
  const hasPreloadedDestination = Boolean(destResolved?.address);
  const hasKnownPassengerFare =
    hasPreloadedDestination
    && (trip.price != null || trip.distance_km != null);
  const cleanNotes = getCleanNotes(trip);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      {/* Dimmed backdrop — tap outside does nothing (driver must decide) */}
      <Animated.View entering={FadeIn.duration(200)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.72)', justifyContent: 'flex-end' }}>

        {/* ── Reject reason sheet (overlays card) ── */}
        {showRejectSheet && (
          <Animated.View
            entering={SlideInDown.duration(280).easing(Easing.out(Easing.cubic))}
            exiting={SlideOutDown.duration(200)}
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 40,
              elevation: 20,
              shadowColor: '#000',
              shadowOffset: { width: 0, height: -4 },
              shadowOpacity: 0.18,
              shadowRadius: 12,
            }}
          >
            {/* Handle */}
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <Text style={{ color: colors.text, fontSize: 16, fontFamily: 'Inter_700Bold' }}>
                Motivo del rechazo
              </Text>
              <TouchableOpacity
                onPress={() => setShowRejectSheet(false)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              >
                <MaterialCommunityIcons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>

            {CANCEL_REASONS.map((reason) => (
              <Pressable
                key={reason}
                onPress={() => handleRejectWithReason(reason)}
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingVertical: 13,
                  paddingHorizontal: 14,
                  borderRadius: 12,
                  marginBottom: 4,
                  backgroundColor: pressed ? `${colors.danger}12` : colors.background,
                })}
              >
                <MaterialCommunityIcons name="circle-small" size={20} color={colors.textMuted} />
                <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_500Medium', marginLeft: 6 }}>
                  {reason}
                </Text>
              </Pressable>
            ))}
          </Animated.View>
        )}

        {/* ── Main card ── */}
        {!showRejectSheet && (
          <Animated.View
            entering={FadeInDown.duration(400).easing(Easing.out(Easing.cubic))}
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              paddingTop: 12,
              paddingHorizontal: 20,
              paddingBottom: 36,
              maxHeight: '92%',
            }}
          >
            {/* Handle */}
            <View style={{ alignItems: 'center', marginBottom: 14 }}>
              <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
            </View>

            {/* Progress bar — más alta y visible */}
            <View style={{ height: 5, backgroundColor: colors.borderLight, borderRadius: 3, marginBottom: 20, overflow: 'hidden' }}>
              <Animated.View
                style={[{
                  height: '100%',
                  borderRadius: 3,
                  backgroundColor: isUrgent ? colors.danger : colors.success,
                }, progressStyle]}
              />
            </View>

            <ScrollView showsVerticalScrollIndicator={false} bounces={false}>
              {/* Header: WhatsApp badge + timer */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
                    Nuevo viaje
                  </Text>
                  {approachOnly && (
                    <View style={{
                      backgroundColor: '#25D36620',
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      borderRadius: 8,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 3,
                    }}>
                      <MaterialCommunityIcons name="whatsapp" size={13} color="#25D366" />
                      <Text style={{ color: '#25D366', fontSize: 11, fontFamily: 'Inter_600SemiBold' }}>WA</Text>
                    </View>
                  )}
                </View>
                {/* Countdown badge — urgente al llegar a 10s */}
                <View style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: isUrgent ? colors.dangerBg : colors.surfaceLight,
                  paddingHorizontal: 14, paddingVertical: 8,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: isUrgent ? `${colors.danger}30` : colors.borderLight,
                  gap: 5,
                }}>
                  <MaterialCommunityIcons
                    name="timer-outline"
                    size={17}
                    color={isUrgent ? colors.danger : colors.primary}
                  />
                  <Text style={{
                    color: isUrgent ? colors.danger : colors.primary,
                    fontSize: isUrgent ? 18 : 15,
                    fontFamily: 'Inter_700Bold',
                    fontVariant: ['tabular-nums'],
                  }}>
                    {countdown}s
                  </Text>
                </View>
              </View>

              {/* Passenger row */}
              <View style={{
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 18,
                paddingBottom: 16,
                borderBottomWidth: 1,
                borderBottomColor: `${colors.border}50`,
              }}>
                <View style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: `${colors.primary}15`,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <MaterialCommunityIcons name="account" size={22} color={colors.primary} />
                </View>
                <View style={{ marginLeft: 12, flex: 1 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.6 }}>
                    PASAJERO
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 1 }}>
                    {trip.passenger_name || 'Pasajero'}
                  </Text>
                </View>
                {/* Contact quick-actions */}
                {trip?.passenger_phone && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => Linking.openURL(`tel:${trip.passenger_phone}`)}
                      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: `${colors.success}18`, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <MaterialCommunityIcons name="phone" size={18} color={colors.success} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => Linking.openURL(`whatsapp://send?phone=${trip.passenger_phone.replace(/\D/g, '')}`)}
                      style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: '#25D36620', alignItems: 'center', justifyContent: 'center' }}
                    >
                      <MaterialCommunityIcons name="whatsapp" size={18} color="#25D366" />
                    </TouchableOpacity>
                  </View>
                )}
              </View>

              <View style={{ marginBottom: 14 }}>
                <TripRouteTimeline
                  pickupAddress={pickupAddress}
                  waypoints={tripWaypoints}
                  finalDestinationAddress={destinationDisplayAddress}
                />
                {tripWaypoints.length > 0 ? (
                  <Text style={{
                    color: colors.info,
                    fontSize: 11,
                    fontFamily: 'Inter_600SemiBold',
                    marginTop: 8,
                    marginLeft: 4,
                  }}>
                    {tripWaypoints.length} parada{tripWaypoints.length !== 1 ? 's' : ''} intermedia{tripWaypoints.length !== 1 ? 's' : ''}
                  </Text>
                ) : null}
                {approachOnly && hasPreloadedDestination && (
                  <Text style={{
                    color: colors.success,
                    fontSize: 11,
                    fontFamily: 'Inter_600SemiBold',
                    marginTop: 6,
                    marginLeft: 4,
                  }}>
                    Ruta precargada por pasajero
                  </Text>
                )}
              </View>

              {/* Stats pills */}
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
                <StatPill
                  icon="map-marker-distance"
                  value={trip.distance_km != null ? formatDistance(trip.distance_km) : '—'}
                  label="Distancia"
                />
                <StatPill
                  icon="clock-outline"
                  value={trip.duration_minutes != null ? formatDuration(trip.duration_minutes) : '—'}
                  label="Duración"
                />
                <StatPill
                  icon="cash"
                  value={trip.price != null ? formatPrice(trip.price) : 'A definir'}
                  label={trip.price != null ? (hasKnownPassengerFare ? 'Total' : 'Precio') : 'Al bajar'}
                  highlight
                />
              </View>

              {/* Clean user notes (no boilerplate) */}
              {cleanNotes && (
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'flex-start',
                  backgroundColor: `${colors.warning}12`,
                  padding: 12,
                  borderRadius: 12,
                  marginBottom: 14,
                  gap: 8,
                }}>
                  <MaterialCommunityIcons name="note-text-outline" size={16} color={colors.warning} style={{ marginTop: 1 }} />
                  <Text style={{ color: colors.warning, fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1, lineHeight: 18 }}>
                    {cleanNotes}
                  </Text>
                </View>
              )}
            </ScrollView>

            {/* ── CTA buttons ── */}
            <View style={{ marginTop: 6, gap: 10 }}>
              {/* Botón aceptar — gradiente verde impactante */}
              <Pressable
                onPress={handleAccept}
                disabled={isAccepting}
                style={({ pressed }) => ({
                  borderRadius: 18,
                  overflow: 'hidden',
                  opacity: isAccepting ? 0.80 : pressed ? 0.90 : 1,
                  boxShadow: '0 6px 20px rgba(22,199,132,0.40)',
                })}
              >
                <LinearGradient
                  colors={['#1AD98A', '#0DAA6E']}
                  start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                  style={{
                    paddingVertical: 18,
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'row',
                  }}
                >
                  {isAccepting ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <ActivityIndicator size="small" color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 17, fontFamily: 'Inter_700Bold' }}>Confirmando…</Text>
                    </View>
                  ) : (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                      <MaterialCommunityIcons name="check-circle" size={22} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 17, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 }}>
                        Aceptar viaje
                      </Text>
                    </View>
                  )}
                </LinearGradient>
              </Pressable>

              {/* Botón rechazar */}
              <Pressable
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowRejectSheet(true);
                }}
                disabled={isAccepting}
                style={({ pressed }) => ({
                  paddingVertical: 14,
                  alignItems: 'center',
                  borderRadius: 14,
                  backgroundColor: `${colors.danger}10`,
                  borderWidth: 1, borderColor: `${colors.danger}20`,
                  opacity: isAccepting ? 0.5 : pressed ? 0.75 : 1,
                })}
              >
                <Text style={{ color: colors.danger, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                  Rechazar viaje
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
      </Animated.View>
    </Modal>
  );
};

// ── Stat pill sub-component ──
function StatPill({ icon, value, label, highlight = false }) {
  if (highlight) {
    // Precio: tratamiento especial con gradiente
    return (
      <View style={{
        flex: 1, borderRadius: 16, overflow: 'hidden',
        boxShadow: '0 3px 10px rgba(22,199,132,0.25)',
      }}>
        <LinearGradient
          colors={['#1AD98A', '#0DAA6E']}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
          style={{ paddingVertical: 14, alignItems: 'center' }}
        >
          <MaterialCommunityIcons name={icon} size={18} color="rgba(255,255,255,0.85)" style={{ marginBottom: 4 }} />
          <Text style={{ color: '#FFFFFF', fontSize: 15, fontFamily: 'Inter_700Bold' }}>{value}</Text>
          <Text style={{ color: 'rgba(255,255,255,0.70)', fontSize: 10, fontFamily: 'Inter_600SemiBold', marginTop: 1 }}>{label}</Text>
        </LinearGradient>
      </View>
    );
  }
  return (
    <View style={{
      flex: 1,
      backgroundColor: colors.surface,
      borderRadius: 16,
      paddingVertical: 14,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.borderLight,
    }}>
      <MaterialCommunityIcons name={icon} size={18} color={colors.textMuted} style={{ marginBottom: 4 }} />
      <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_700Bold' }}>{value}</Text>
      <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 1 }}>{label}</Text>
    </View>
  );
}
