import React from 'react';
import { View, Text } from 'react-native';
import Animated, { FadeInUp } from 'react-native-reanimated';
import { colors } from '../../theme/colors';
import { shadows } from '../../theme/spacing';

export const StatsCard = ({ icon, label, value, color, index = 0 }) => {
  return (
    <Animated.View
      entering={FadeInUp.delay(index * 100).springify()}
      style={{
        width: '48%',
        backgroundColor: colors.surface,
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: colors.border,
        ...shadows.card,
      }}
    >
      <Text style={{ fontSize: 24, marginBottom: 6 }}>{icon}</Text>
      <Text
        style={{
          color: color || colors.text,
          fontSize: 22,
          fontFamily: 'Inter_700Bold',
          marginBottom: 2,
        }}
      >
        {value}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 12,
          fontFamily: 'Inter_500Medium',
        }}
      >
        {label}
      </Text>
    </Animated.View>
  );
};
