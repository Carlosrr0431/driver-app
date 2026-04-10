import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, Modal, Linking, Vibration } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withTiming,
  FadeIn,
  SlideInDown,
} from 'react-native-reanimated';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { colors } from '../../theme/colors';
import { formatPrice, formatDistance, formatDuration } from '../../utils/formatters';
import { TRIP_ACCEPT_TIMEOUT, CANCEL_REASONS } from '../../utils/constants';
import BottomSheet, { BottomSheetView } from '@gorhom/bottom-sheet';

export const NewTripModal = ({ visible, trip, onAccept, onReject }) => {
  const [countdown, setCountdown] = useState(TRIP_ACCEPT_TIMEOUT);
  const [showRejectSheet, setShowRejectSheet] = useState(false);
  const countdownRef = useRef(null);
  const soundRef = useRef(null);
  const bottomSheetRef = useRef(null);
  const progressWidth = useSharedValue(100);

  useEffect(() => {
    if (visible && trip) {
      setCountdown(TRIP_ACCEPT_TIMEOUT);
      progressWidth.value = 100;
      playNotificationSound();
      Vibration.vibrate([0, 500, 200, 500, 200, 500]);

      countdownRef.current = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            clearInterval(countdownRef.current);
            handleTimeout();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      progressWidth.value = withTiming(0, { duration: TRIP_ACCEPT_TIMEOUT * 1000 });
    }

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (soundRef.current) {
        soundRef.current.unloadAsync();
      }
    };
  }, [visible, trip]);

  const playNotificationSound = async () => {
    try {
      // Sound played via Vibration pattern as fallback in Expo Go
      Vibration.vibrate([0, 300, 100, 300]);
    } catch (error) {
      console.log('No se pudo reproducir el sonido:', error);
    }
  };

  const handleTimeout = () => {
    if (onReject) onReject(trip?.id, 'Tiempo agotado');
  };

  const handleAccept = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (onAccept) onAccept(trip?.id);
  };

  const handleReject = () => {
    setShowRejectSheet(true);
  };

  const handleRejectWithReason = (reason) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowRejectSheet(false);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    if (onReject) onReject(trip?.id, reason);
  };

  const callPassenger = () => {
    if (trip?.passenger_phone) {
      Linking.openURL(`tel:${trip.passenger_phone}`);
    }
  };

  const whatsappPassenger = () => {
    if (trip?.passenger_phone) {
      const phone = trip.passenger_phone.replace(/[^0-9]/g, '');
      Linking.openURL(`whatsapp://send?phone=${phone}`);
    }
  };

  const progressStyle = useAnimatedStyle(() => ({
    width: `${progressWidth.value}%`,
  }));

  if (!visible || !trip) return null;

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View
        entering={FadeIn.duration(300)}
        style={{
          flex: 1,
          backgroundColor: colors.overlay,
          justifyContent: 'flex-end',
        }}
      >
        <Animated.View entering={SlideInDown.springify().damping(15)}>
          <View
            style={{
              backgroundColor: colors.surface,
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 20,
              paddingBottom: 40,
            }}
          >
            {/* Progress Bar */}
            <View
              style={{
                height: 4,
                backgroundColor: colors.border,
                borderRadius: 2,
                marginBottom: 16,
                overflow: 'hidden',
              }}
            >
              <Animated.View
                style={[
                  {
                    height: '100%',
                    backgroundColor: countdown > 10 ? colors.success : colors.danger,
                    borderRadius: 2,
                  },
                  progressStyle,
                ]}
              />
            </View>

            {/* Timer */}
            <View style={{ alignItems: 'center', marginBottom: 12 }}>
              <Text
                style={{
                  color: countdown > 10 ? colors.warning : colors.danger,
                  fontSize: 15,
                  fontFamily: 'Inter_600SemiBold',
                }}
              >
                ⏱ {countdown}s para responder
              </Text>
            </View>

            {/* Title */}
            <Text
              style={{
                color: colors.text,
                fontSize: 22,
                fontFamily: 'Inter_700Bold',
                textAlign: 'center',
                marginBottom: 16,
              }}
            >
              🚖 Nuevo viaje asignado
            </Text>

            <Card style={{ marginBottom: 12 }}>
              {/* Passenger */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
                <MaterialCommunityIcons name="account" size={22} color={colors.primary} />
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 17,
                    fontFamily: 'Inter_600SemiBold',
                    marginLeft: 8,
                  }}
                >
                  {trip.passenger_name}
                </Text>
              </View>

              {/* Origin */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: `${colors.success}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="map-marker" size={18} color={colors.success} />
                </View>
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium' }}>
                    ORIGEN
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                    {trip.origin_address}
                  </Text>
                </View>
              </View>

              {/* Dotted line */}
              <View style={{ marginLeft: 14, marginBottom: 12 }}>
                {[1, 2, 3].map((i) => (
                  <View
                    key={i}
                    style={{
                      width: 2,
                      height: 4,
                      backgroundColor: colors.textMuted,
                      marginBottom: 3,
                      borderRadius: 1,
                    }}
                  />
                ))}
              </View>

              {/* Destination */}
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 }}>
                <View
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: `${colors.danger}20`,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <MaterialCommunityIcons name="flag-checkered" size={18} color={colors.danger} />
                </View>
                <View style={{ marginLeft: 10, flex: 1 }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium' }}>
                    DESTINO
                  </Text>
                  <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                    {trip.destination_address}
                  </Text>
                </View>
              </View>

              {/* Trip Info Row */}
              <View
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-around',
                  paddingVertical: 12,
                  borderTopWidth: 1,
                  borderTopColor: colors.border,
                }}
              >
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>📏 Distancia</Text>
                  <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                    {formatDistance(trip.distance_km)}
                  </Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>⏱ Tiempo</Text>
                  <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_600SemiBold' }}>
                    {formatDuration(trip.duration_minutes)}
                  </Text>
                </View>
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: colors.textMuted, fontSize: 11 }}>💰 Precio</Text>
                  <Text
                    style={{
                      color: colors.secondary,
                      fontSize: 20,
                      fontFamily: 'Inter_700Bold',
                    }}
                  >
                    {formatPrice(trip.price)}
                  </Text>
                </View>
              </View>

              {/* Notes */}
              {trip.notes && (
                <View
                  style={{
                    marginTop: 12,
                    padding: 12,
                    backgroundColor: `${colors.warning}10`,
                    borderRadius: 10,
                    borderWidth: 1,
                    borderColor: `${colors.warning}30`,
                  }}
                >
                  <Text style={{ color: colors.warning, fontSize: 12, fontFamily: 'Inter_500Medium' }}>
                    📝 {trip.notes}
                  </Text>
                </View>
              )}
            </Card>

            {/* Quick Actions */}
            <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 16, marginBottom: 16 }}>
              <Button
                title="📞 Llamar"
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={callPassenger}
              />
              <Button
                title="💬 WhatsApp"
                variant="outline"
                size="sm"
                fullWidth={false}
                onPress={whatsappPassenger}
              />
            </View>

            {/* Action Buttons */}
            <Button
              title="✅ ACEPTAR VIAJE"
              variant="success"
              size="xl"
              onPress={handleAccept}
              style={{ marginBottom: 10 }}
            />
            <Button
              title="❌ RECHAZAR"
              variant="outlineDanger"
              size="md"
              onPress={handleReject}
            />

            {/* Reject Reasons */}
            {showRejectSheet && (
              <View
                style={{
                  marginTop: 16,
                  padding: 16,
                  backgroundColor: colors.surfaceLight,
                  borderRadius: 16,
                }}
              >
                <Text
                  style={{
                    color: colors.text,
                    fontSize: 15,
                    fontFamily: 'Inter_600SemiBold',
                    marginBottom: 12,
                    textAlign: 'center',
                  }}
                >
                  Motivo del rechazo
                </Text>
                {CANCEL_REASONS.map((reason) => (
                  <Button
                    key={reason}
                    title={reason}
                    variant="ghost"
                    size="sm"
                    onPress={() => handleRejectWithReason(reason)}
                    style={{ marginBottom: 6 }}
                  />
                ))}
              </View>
            )}
          </View>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};
