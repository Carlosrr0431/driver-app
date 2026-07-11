/**
 * Componente: Badge
 * Que hace: Muestra una etiqueta de estado con color y texto configurable para viajes u otros estados.
 */
import React, { useMemo } from 'react';
import { View, Text } from 'react-native';
import { TRIP_STATUS_LABELS, TRIP_STATUS_COLORS } from '../../utils/constants';
import { useResponsive } from '../../hooks/useResponsive';

export const Badge = ({ status, label, color, size = 'sm' }) => {
  const { s, fs } = useResponsive();
  const displayLabel = label || TRIP_STATUS_LABELS[status] || status;
  const bgColor = color || TRIP_STATUS_COLORS[status] || '#636E72';

  const sizeStyle = useMemo(() => {
    const sizes = {
      xs: { paddingH: s(6), paddingV: s(2), fontSize: fs(10) },
      sm: { paddingH: s(8), paddingV: s(4), fontSize: fs(11) },
      md: { paddingH: s(10), paddingV: s(6), fontSize: fs(13) },
    };
    return sizes[size] || sizes.sm;
  }, [s, fs, size]);

  return (
    <View
      style={{
        backgroundColor: `${bgColor}20`,
        paddingHorizontal: sizeStyle.paddingH,
        paddingVertical: sizeStyle.paddingV,
        borderRadius: s(8),
        borderWidth: 1,
        borderColor: `${bgColor}40`,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: bgColor,
          fontSize: sizeStyle.fontSize,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {displayLabel}
      </Text>
    </View>
  );
};
