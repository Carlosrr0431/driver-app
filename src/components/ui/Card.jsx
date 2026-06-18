/**
 * Componente: Card
 * Que hace: Contenedor visual base para bloques de UI con borde, radio y sombra consistentes.
 * Usado por:
 * - driver-app/src/components/trip/TripCard.jsx -> import { Card } from '../ui/Card';
 * - driver-app/src/components/trip/TripSummary.jsx -> import { Card } from '../ui/Card';
 * - driver-app/src/screens/HomeScreen.old.jsx -> import { Card } from '../components/ui/Card';
 */
import React from 'react';
import { View } from 'react-native';
import { colors } from '../../theme/colors';
import { shadows } from '../../theme/spacing';

export const Card = ({
  children,
  style,
  padding = 16,
  marginBottom = 12,
}) => {
  return (
    <View
      style={[
        {
          backgroundColor: colors.surface,
          borderRadius: 16,
          padding,
          marginBottom,
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
