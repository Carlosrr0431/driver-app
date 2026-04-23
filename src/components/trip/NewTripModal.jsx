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
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
  FadeInDown,
  SlideInDown,
  SlideOutDown,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { colors } from '../../theme/colors';
import { formatPrice, formatDistance, formatDuration } from '../../utils/formatters';
import { TRIP_ACCEPT_TIMEOUT, CANCEL_REASONS } from '../../utils/constants';

// Helpers
const isApproachOnly = (trip) =>
  String(trip?.notes || '').toLowerCase().includes('[approach_only]');

// Pickup address = where the driver must go first
const getPickupAddress = (trip) =>
  isApproachOnly(trip) ? trip.destination_address : trip.origin_address;

// Clean notes: strip the [APPROACH_ONLY] tag and the boilerplate sentence
const getCleanNotes = (trip) => {
  if (!trip?.notes) return null;
  const cleaned = trip.notes
    .replace(/\[APPROACH_ONLY\]/gi, '')
    .replace(/Creado autom[aá]ticamente desde WhatsApp[^.]*\./gi, '')
    .replace(/chofer\s*->\s*retiro pasajero[^.]*\./gi, '')
    .replace(/Destino final:[^.]*\./gi, '')
    .trim();
  return cleaned || null;
};

export const NewTripModal = ({ visible, trip, onAccept, onReject }) => {
  const [countdown, setCountdown] = useState(TRIP_ACCEPT_TIMEOUT);
  const [showRejectSheet, setShowRejectSheet] = useState(false);
  const [isAccepting, setIsAccepting] = useState(false);
  const countdownRef = useRef(null);
  const soundRef = useRef(null);
  const progressWidth = useSharedValue(100);
  // Keep ref so handleTimeout closure always has latest trip
  const tripRef = useRef(trip);
  useEffect(() => { tripRef.current = trip; }, [trip]);
  // Prevents both timer-timeout and manual-accept from firing simultaneously
  const decidedRef = useRef(false);
  // Signals that the interval reached 0 so the effect below can fire onReject
  const timedOutRef = useRef(false);

  useEffect(() => {
    if (visible && trip) {
      decidedRef.current = false;
      timedOutRef.current = false;
      setCountdown(TRIP_ACCEPT_TIMEOUT);
      setShowRejectSheet(false);
      setIsAccepting(false);
      progressWidth.value = 100;
      playNotificationSound();
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            // Signal timeout — actual onReject call happens in the effect below
            // to keep the updater pure and avoid concurrent-mode double-invocation
            timedOutRef.current = true;
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      progressWidth.value = withTiming(0, { duration: TRIP_ACCEPT_TIMEOUT * 1000 });
    }

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      stopSound();
    };
  }, [visible, trip?.id]);

  // Handles the timeout side-effect outside of the setState updater
  useEffect(() => {
    if (countdown === 0 && timedOutRef.current && !decidedRef.current) {
      decidedRef.current = true;
      timedOutRef.current = false;
      stopSound();
      if (onReject) onReject(tripRef.current?.id, 'Tiempo agotado');
    }
  }, [countdown]);

  const playNotificationSound = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
        shouldDuckAndroid: false,
        playThroughEarpieceAndroid: false,
      });
      const { sound } = await Audio.Sound.createAsync(
        require('../../../assets/notification.wav'),
        { shouldPlay: true, isLooping: true, volume: 1.0 }
      );
      soundRef.current = sound;
    } catch {
      Vibration.vibrate([0, 300, 100, 300]);
    }
  };

  const stopSound = async () => {
    if (soundRef.current) {
      try {
        await soundRef.current.stopAsync();
        await soundRef.current.unloadAsync();
      } catch (_) {}
      soundRef.current = null;
    }
  };

  const handleAccept = async () => {
    if (isAccepting || decidedRef.current) return;
    decidedRef.current = true;
    if (countdownRef.current) clearInterval(countdownRef.current);
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
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowRejectSheet(false);
    stopSound();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (onReject) onReject(trip?.id, reason);
  };

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  if (!visible || !trip) return null;

  const isUrgent = countdown <= 10;
  const approachOnly = isApproachOnly(trip);
  const pickupAddress = getPickupAddress(trip);
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

            {/* Progress bar */}
            <View style={{ height: 3, backgroundColor: `${colors.border}60`, borderRadius: 2, marginBottom: 18, overflow: 'hidden' }}>
              <Animated.View
                style={[{ height: '100%', borderRadius: 2, backgroundColor: isUrgent ? '#EF4444' : colors.primary }, progressStyle]}
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
                {/* Countdown badge */}
                <View style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: isUrgent ? '#EF444418' : `${colors.primary}15`,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 20,
                }}>
                  <MaterialCommunityIcons name="timer-outline" size={16} color={isUrgent ? '#EF4444' : colors.primary} style={{ marginRight: 4 }} />
                  <Text style={{ color: isUrgent ? '#EF4444' : colors.primary, fontSize: 14, fontFamily: 'Inter_700Bold' }}>
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

              {/* Route */}
              <View style={{
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 14,
                marginBottom: 14,
                gap: 0,
              }}>
                {/* Pickup */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ width: 22, alignItems: 'center', paddingTop: 2 }}>
                    <View style={{ width: 11, height: 11, borderRadius: 6, backgroundColor: colors.success, borderWidth: 2, borderColor: `${colors.success}40` }} />
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, marginBottom: 2 }}>
                      RETIRO
                    </Text>
                    <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_500Medium', lineHeight: 19 }}>
                      {pickupAddress || '—'}
                    </Text>
                  </View>
                </View>

                {/* Connector */}
                <View style={{ marginLeft: 10, paddingVertical: 5 }}>
                  {[0, 1, 2, 3].map((i) => (
                    <View key={i} style={{ width: 2, height: 4, backgroundColor: `${colors.textMuted}35`, marginBottom: 2, borderRadius: 1, marginLeft: 1 }} />
                  ))}
                </View>

                {/* Destination */}
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <View style={{ width: 22, alignItems: 'center', paddingTop: 2 }}>
                    {approachOnly
                      ? <MaterialCommunityIcons name="help-circle-outline" size={13} color={colors.textMuted} />
                      : <View style={{ width: 11, height: 11, borderRadius: 3, backgroundColor: colors.primary }} />
                    }
                  </View>
                  <View style={{ marginLeft: 10, flex: 1 }}>
                    <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_700Bold', letterSpacing: 0.8, marginBottom: 2 }}>
                      DESTINO
                    </Text>
                    <Text style={{
                      color: approachOnly ? colors.textMuted : colors.text,
                      fontSize: 14,
                      fontFamily: approachOnly ? 'Inter_400Regular' : 'Inter_500Medium',
                      fontStyle: approachOnly ? 'italic' : 'normal',
                      lineHeight: 19,
                    }}>
                      {approachOnly ? 'A definir al subir al pasajero' : (trip.destination_address || '—')}
                    </Text>
                  </View>
                </View>
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
                  label={trip.price != null ? 'Precio' : 'Al bajar'}
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
            <View style={{ marginTop: 6 }}>
              <TouchableOpacity
                onPress={handleAccept}
                activeOpacity={0.82}
                disabled={isAccepting}
                style={{
                  backgroundColor: colors.success,
                  borderRadius: 16,
                  paddingVertical: 16,
                  alignItems: 'center',
                  justifyContent: 'center',
                  marginBottom: 10,
                  opacity: isAccepting ? 0.75 : 1,
                  elevation: 2,
                  shadowColor: colors.success,
                  shadowOffset: { width: 0, height: 3 },
                  shadowOpacity: 0.25,
                  shadowRadius: 6,
                }}
              >
                {isAccepting ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator size="small" color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold' }}>Confirmando…</Text>
                  </View>
                ) : (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <MaterialCommunityIcons name="check-circle-outline" size={20} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.2 }}>
                      Aceptar viaje
                    </Text>
                  </View>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setShowRejectSheet(true);
                }}
                activeOpacity={0.7}
                disabled={isAccepting}
                style={{
                  paddingVertical: 13,
                  alignItems: 'center',
                  borderRadius: 14,
                  backgroundColor: `${colors.danger}0E`,
                  opacity: isAccepting ? 0.5 : 1,
                }}
              >
                <Text style={{ color: '#EF4444', fontSize: 14, fontFamily: 'Inter_600SemiBold' }}>
                  Rechazar viaje
                </Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        )}
      </Animated.View>
    </Modal>
  );
};

// ── Stat pill sub-component ──
function StatPill({ icon, value, label, highlight = false }) {
  return (
    <View style={{
      flex: 1,
      backgroundColor: highlight ? `${colors.primary}10` : colors.surface,
      borderRadius: 14,
      paddingVertical: 12,
      alignItems: 'center',
      borderWidth: highlight ? 1 : 0,
      borderColor: highlight ? `${colors.primary}25` : 'transparent',
    }}>
      <MaterialCommunityIcons
        name={icon}
        size={18}
        color={highlight ? colors.primary : colors.textMuted}
        style={{ marginBottom: 4 }}
      />
      <Text style={{ color: highlight ? colors.primary : colors.text, fontSize: 14, fontFamily: 'Inter_700Bold' }}>
        {value}
      </Text>
      <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 1 }}>
        {label}
      </Text>
    </View>
  );
}
