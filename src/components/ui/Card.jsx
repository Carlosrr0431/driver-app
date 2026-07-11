/**
 * Componente: Card
 * Que hace: Contenedor visual base para bloques de UI con borde, radio y sombra consistentes.
 */
import React from 'react';
import { View } from 'react-native';
import { colors } from '../../theme/colors';
import { shadows } from '../../theme/spacing';
import { useResponsive } from '../../hooks/useResponsive';

export const Card = ({
  children,
  style,
  padding,
  marginBottom,
}) => {
  const { s } = useResponsive();
  const pad = padding ?? s(16);
  const mb = marginBottom ?? s(12);

  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: s(16),
          padding: pad,
          marginBottom: mb,
          borderWidth: 1,
          borderColor: colors.border,
          ...shadows.card,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
};
