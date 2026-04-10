import React, { useCallback } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withRepeat,
  withTiming,
  interpolateColor,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/colors';
import { supabase } from '../../services/supabase';
import { useAuthStore } from '../../stores/authStore';
import Toast from 'react-native-toast-message';

export const StatusToggle = ({ isOnline, onToggle }) => {
  const { driver, updateDriver } = useAuthStore();
  const toggleAnim = useSharedValue(isOnline ? 1 : 0);
  const pulseAnim = useSharedValue(1);

  React.useEffect(() => {
    toggleAnim.value = withSpring(isOnline ? 1 : 0);
    if (isOnline) {
      pulseAnim.value = withRepeat(
        withTiming(1.15, { duration: 1500 }),
        -1,
        true
      );
    } else {
      pulseAnim.value = withSpring(1);
    }
  }, [isOnline]);

  const containerStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      toggleAnim.value,
      [0, 1],
      [colors.surfaceLight, `${colors.success}15`]
    ),
    borderColor: interpolateColor(
      toggleAnim.value,
      [0, 1],
      [colors.border, colors.success]
    ),
  }));

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseAnim.value }],
    opacity: isOnline ? 0.3 : 0,
  }));

  const handleToggle = useCallback(async () => {
    if (!driver?.id) return;

    const newStatus = !isOnline;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    try {
      const { error } = await supabase
        .from('drivers')
        .update({ is_available: newStatus })
        .eq('id', driver.id);

      if (error) throw error;

      updateDriver({ is_available: newStatus });
      if (onToggle) onToggle(newStatus);

      Toast.show({
        type: 'success',
        text1: newStatus ? '🟢 Estás en línea' : '🌙 Estás fuera de línea',
        text2: newStatus
          ? 'Puedes recibir viajes asignados'
          : 'No recibirás nuevos viajes',
      });
    } catch (error) {
      Toast.show({
        type: 'error',
        text1: 'Error',
        text2: 'No se pudo cambiar el estado',
      });
    }
  }, [driver, isOnline]);

  return (
    <TouchableOpacity onPress={handleToggle} activeOpacity={0.8}>
      <Animated.View
        style={[
          {
            borderRadius: 20,
            padding: 20,
            borderWidth: 2,
            alignItems: 'center',
            position: 'relative',
            overflow: 'hidden',
          },
          containerStyle,
        ]}
      >
        {/* Pulse ring */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              width: 80,
              height: 80,
              borderRadius: 40,
              backgroundColor: colors.success,
            },
            pulseStyle,
          ]}
        />

        {/* Icon */}
        <View
          style={{
            width: 64,
            height: 64,
            borderRadius: 32,
            backgroundColor: isOnline ? `${colors.success}20` : `${colors.offline}20`,
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10,
          }}
        >
          <MaterialCommunityIcons
            name={isOnline ? 'car' : 'moon-waning-crescent'}
            size={32}
            color={isOnline ? colors.success : colors.offline}
          />
        </View>

        {/* Status Label */}
        <Text
          style={{
            color: isOnline ? colors.success : colors.offline,
            fontSize: 18,
            fontFamily: 'Inter_700Bold',
          }}
        >
          {isOnline ? 'EN LÍNEA' : 'FUERA DE LÍNEA'}
        </Text>
        <Text
          style={{
            color: colors.textMuted,
            fontSize: 12,
            fontFamily: 'Inter_400Regular',
            marginTop: 4,
          }}
        >
          {isOnline ? 'Toca para desconectarte' : 'Toca para conectarte'}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};
