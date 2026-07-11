/**
 * Componente: StatsCard
 * Que hace: Renderiza una tarjeta estadistica animada para mostrar metricas rapidas del conductor.
 */
import React from 'react';
import { Text } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { colors } from '../../theme/colors';
import { shadows } from '../../theme/spacing';
import { useResponsive } from '../../hooks/useResponsive';

export const StatsCard = ({ icon, label, value, color, index = 0 }) => {
  const { s, fs } = useResponsive();

  return (
    <Animated.View
      entering={FadeInUp.delay(index * 100).springify()}
      style={{
        width: '48%',
        backgroundColor: colors.surface,
        borderRadius: s(16),
        padding: s(16),
        marginBottom: s(12),
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.card,
      }}
    >
      <Text style={{ fontSize: fs(24), marginBottom: s(6) }}>{icon}</Text>
      <Text
        style={{
          color: color || colors.text,
          fontSize: fs(22),
          fontFamily: 'Inter_700Bold',
          marginBottom: 2,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fs(12),
          fontFamily: 'Inter_500Medium',
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
};
