import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';

export const EmptyState = ({
  icon = 'car-off',
  title = 'Sin resultados',
  message = 'No hay datos para mostrar',
}) => {
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 40,
        paddingVertical: 60,
      }}
    >
      <MaterialCommunityIcons
        name={icon}
        size={80}
        color={colors.textMuted}
        style={{ marginBottom: 16, opacity: 0.5 }}
      />
      <Text
        style={{
          color: colors.text,
          fontSize: 20,
          fontFamily: 'Inter_600SemiBold',
          marginBottom: 8,
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: 14,
          fontFamily: 'Inter_400Regular',
          textAlign: 'center',
          lineHeight: 20,
        }}
      >
        {message}
      </Text>
    </View>
  );
};
