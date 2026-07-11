/**
 * Componente: EmptyState
 * Que hace: Renderiza una vista de estado vacio con icono, titulo y mensaje para listas sin datos.
 */
import React from 'react';
import { View, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';

export const EmptyState = ({
  icon = 'car-off',
  title = 'Sin resultados',
  message = 'No hay datos para mostrar',
}) => {
  const { s, fs } = useResponsive();

  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: s(40),
        paddingVertical: s(60),
      }}
    >
      <MaterialCommunityIcons
        name={icon}
        size={s(80, { min: 48, max: 96 })}
        color={colors.textMuted}
        style={{ marginBottom: s(16), opacity: 0.5 }}
      />
      <Text
        style={{
          color: colors.text,
          fontSize: fs(20),
          fontFamily: 'Inter_600SemiBold',
          marginBottom: s(8),
          textAlign: 'center',
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.textMuted,
          fontSize: fs(14),
          fontFamily: 'Inter_400Regular',
          textAlign: 'center',
          lineHeight: fs(20),
        }}
      >
        {message}
      </Text>
    </View>
  );
};
