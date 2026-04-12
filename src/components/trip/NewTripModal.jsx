import React, { useEffect, useState, useRef } from 'react';
import { View, Text, Modal, Linking, Vibration, TouchableOpacity, Pressable, Dimensions } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Audio } from 'expo-av';
import { colors } from '../../theme/colors';
import { formatPrice, formatDistance, formatDuration } from '../../utils/formatters';
import { TRIP_ACCEPT_TIMEOUT, CANCEL_REASONS } from '../../utils/constants';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

export const NewTripModal = ({ visible, trip, onAccept, onReject }) => {
  const [countdown, setCountdown] = useState(TRIP_ACCEPT_TIMEOUT);
  const [showRejectSheet, setShowRejectSheet] = useState(false);
  const countdownRef = useRef(null);
  const soundRef = useRef(null);
  const progressWidth = useSharedValue(100);

  useEffect(() => {
    if (visible && trip) {
      setCountdown(TRIP_ACCEPT_TIMEOUT);
      setShowRejectSheet(false);
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
      stopSound();
    };
  }, [visible, trip]);

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
    } catch (error) {
      console.log('No se pudo reproducir el sonido:', error);
      Vibration.vibrate([0, 300, 100, 300]);
    }
  };

  const stopSound = async () => {
    if (soundRef.current) {
      try { await soundRef.current.stopAsync(); await soundRef.current.unloadAsync(); } catch (_) {}
      soundRef.current = null;
    }
  };

  const handleTimeout = () => {
    stopSound();
    if (onReject) onReject(trip?.id, 'Tiempo agotado');
  };

  const handleAccept = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    stopSound();
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    if (onAccept) onAccept(trip?.id);
  };

  const handleReject = () => {
    setShowRejectSheet(true);
  };

  const handleRejectWithReason = (reason) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setShowRejectSheet(false);
    stopSound();
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

  const isUrgent = countdown <= 10;

  if (!visible || !trip) return null;

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent>
      <Animated.View
        entering={FadeIn.duration(250)}
        style={{
          flex: 1,
          backgroundColor: 'rgba(0,0,0,0.7)',
          justifyContent: 'flex-end',
        }}
      >
        {/* Main card — smooth slide, no bounce */}
        <Animated.View
          entering={FadeInDown.duration(450).easing(Easing.out(Easing.cubic))}
          style={{
            backgroundColor: colors.background,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            paddingTop: 12,
            paddingHorizontal: 20,
            paddingBottom: 36,
          }}
        >
          {/* Handle */}
          <View style={{ alignItems: 'center', marginBottom: 16 }}>
            <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
          </View>

          {/* Progress bar */}
          <View
            style={{
              height: 3,
              backgroundColor: `${colors.border}60`,
              borderRadius: 2,
              marginBottom: 20,
              overflow: 'hidden',
            }}
          >
            <Animated.View
              style={[
                {
                  height: '100%',
                  borderRadius: 2,
                  backgroundColor: isUrgent ? colors.danger : colors.primary,
                },
                progressStyle,
              ]}
            />
          </View>

          {/* Header: title + timer */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
            <Text style={{ color: colors.text, fontSize: 20, fontFamily: 'Inter_700Bold' }}>
              Nuevo viaje
            </Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                backgroundColor: isUrgent ? `${colors.danger}18` : `${colors.primary}15`,
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 20,
              }}
            >
              <MaterialCommunityIcons
                name="timer-outline"
                size={16}
                color={isUrgent ? colors.danger : colors.primary}
                style={{ marginRight: 4 }}
              />
              <Text
                style={{
                  color: isUrgent ? colors.danger : colors.primary,
                  fontSize: 14,
                  fontFamily: 'Inter_700Bold',
                }}
              >
                {countdown}s
              </Text>
            </View>
          </View>

          {/* Passenger */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              marginBottom: 18,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderBottomColor: `${colors.border}50`,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                backgroundColor: `${colors.primary}15`,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialCommunityIcons name="account" size={22} color={colors.primary} />
            </View>
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: 'Inter_500Medium', letterSpacing: 0.5 }}>
                PASAJERO
              </Text>
              <Text style={{ color: colors.text, fontSize: 16, fontFamily: 'Inter_600SemiBold', marginTop: 1 }}>
                {trip.passenger_name}
              </Text>
            </View>
            {/* Quick contact icons */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {trip?.passenger_phone && (
                <>
                  <TouchableOpacity
                    onPress={callPassenger}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: `${colors.success}15`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="phone" size={18} color={colors.success} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={whatsappPassenger}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: `${colors.success}15`,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <MaterialCommunityIcons name="whatsapp" size={18} color={colors.success} />
                  </TouchableOpacity>
                </>
              )}
            </View>
          </View>

          {/* Route */}
          <View style={{ marginBottom: 18 }}>
            {/* Origin */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ alignItems: 'center', width: 24 }}>
                <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: colors.success }} />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 }}>
                  ORIGEN
                </Text>
                <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                  {trip.origin_address}
                </Text>
              </View>
            </View>

            {/* Dotted connector */}
            <View style={{ marginLeft: 11, paddingVertical: 4 }}>
              {[1, 2, 3].map((i) => (
                <View
                  key={i}
                  style={{
                    width: 2,
                    height: 4,
                    backgroundColor: `${colors.textMuted}50`,
                    marginBottom: 2,
                    borderRadius: 1,
                  }}
                />
              ))}
            </View>

            {/* Destination */}
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ alignItems: 'center', width: 24 }}>
                <View style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: colors.primary }} />
              </View>
              <View style={{ marginLeft: 10, flex: 1 }}>
                <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_600SemiBold', letterSpacing: 0.8 }}>
                  DESTINO
                </Text>
                <Text style={{ color: colors.text, fontSize: 14, fontFamily: 'Inter_500Medium', marginTop: 2 }}>
                  {trip.destination_address}
                </Text>
              </View>
            </View>
          </View>

          {/* Trip stats pills */}
          <View
            style={{
              flexDirection: 'row',
              gap: 8,
              marginBottom: 18,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderRadius: 14,
                paddingVertical: 12,
                alignItems: 'center',
              }}
            >
              <MaterialCommunityIcons name="map-marker-distance" size={18} color={colors.textMuted} style={{ marginBottom: 4 }} />
              <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' }}>
                {formatDistance(trip.distance_km)}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 1 }}>
                Distancia
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: colors.surface,
                borderRadius: 14,
                paddingVertical: 12,
                alignItems: 'center',
              }}
            >
              <MaterialCommunityIcons name="clock-outline" size={18} color={colors.textMuted} style={{ marginBottom: 4 }} />
              <Text style={{ color: colors.text, fontSize: 15, fontFamily: 'Inter_700Bold' }}>
                {formatDuration(trip.duration_minutes)}
              </Text>
              <Text style={{ color: colors.textMuted, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 1 }}>
                Duración
              </Text>
            </View>
            <View
              style={{
                flex: 1,
                backgroundColor: `${colors.secondary}12`,
                borderRadius: 14,
                paddingVertical: 12,
                alignItems: 'center',
                borderWidth: 1,
                borderColor: `${colors.secondary}25`,
              }}
            >
              <MaterialCommunityIcons name="cash" size={18} color={colors.secondary} style={{ marginBottom: 4 }} />
              <Text style={{ color: colors.secondary, fontSize: 17, fontFamily: 'Inter_700Bold' }}>
                {formatPrice(trip.price)}
              </Text>
              <Text style={{ color: colors.secondary, fontSize: 10, fontFamily: 'Inter_500Medium', marginTop: 1, opacity: 0.7 }}>
                Precio
              </Text>
            </View>
          </View>

          {/* Notes */}
          {trip.notes && (
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'flex-start',
                backgroundColor: `${colors.warning}0D`,
                padding: 12,
                borderRadius: 12,
                marginBottom: 18,
                gap: 8,
              }}
            >
              <MaterialCommunityIcons name="note-text-outline" size={16} color={colors.warning} style={{ marginTop: 1 }} />
              <Text style={{ color: colors.warning, fontSize: 13, fontFamily: 'Inter_500Medium', flex: 1 }}>
                {trip.notes}
              </Text>
            </View>
          )}

          {/* Accept button */}
          <TouchableOpacity
            onPress={handleAccept}
            activeOpacity={0.8}
            style={{
              backgroundColor: colors.success,
              borderRadius: 16,
              paddingVertical: 16,
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 10,
            }}
          >
            <Text style={{ color: '#fff', fontSize: 16, fontFamily: 'Inter_700Bold', letterSpacing: 0.3 }}>
              Aceptar viaje
            </Text>
          </TouchableOpacity>

          {/* Reject button */}
          {!showRejectSheet ? (
            <TouchableOpacity
              onPress={handleReject}
              activeOpacity={0.7}
              style={{
                paddingVertical: 12,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                Rechazar
              </Text>
            </TouchableOpacity>
          ) : (
            <Animated.View
              entering={FadeIn.duration(200)}
              style={{
                marginTop: 8,
                backgroundColor: colors.surface,
                borderRadius: 16,
                padding: 16,
              }}
            >
              <Text
                style={{
                  color: colors.text,
                  fontSize: 14,
                  fontFamily: 'Inter_600SemiBold',
                  marginBottom: 12,
                  textAlign: 'center',
                }}
              >
                Motivo del rechazo
              </Text>
              {CANCEL_REASONS.map((reason) => (
                <Pressable
                  key={reason}
                  onPress={() => handleRejectWithReason(reason)}
                  style={({ pressed }) => ({
                    paddingVertical: 11,
                    paddingHorizontal: 14,
                    borderRadius: 10,
                    marginBottom: 4,
                    backgroundColor: pressed ? `${colors.primary}15` : 'transparent',
                  })}
                >
                  <Text style={{ color: colors.textMuted, fontSize: 14, fontFamily: 'Inter_500Medium' }}>
                    {reason}
                  </Text>
                </Pressable>
              ))}
            </Animated.View>
          )}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
};
