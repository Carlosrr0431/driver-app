import React from 'react';
import { View, Text } from 'react-native';
import { TRIP_STATUS_LABELS, TRIP_STATUS_COLORS } from '../../utils/constants';

export const Badge = ({ status, label, color, size = 'sm' }) => {
  const displayLabel = label || TRIP_STATUS_LABELS[status] || status;
  const bgColor = color || TRIP_STATUS_COLORS[status] || '#636E72';

  const sizes = {
    xs: { paddingH: 6, paddingV: 2, fontSize: 10 },
    sm: { paddingH: 8, paddingV: 4, fontSize: 11 },
    md: { paddingH: 10, paddingV: 6, fontSize: 13 },
  };

  const s = sizes[size] || sizes.sm;

  return (
    <View
      style={{
        backgroundColor: `${bgColor}20`,
        paddingHorizontal: s.paddingH,
        paddingVertical: s.paddingV,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: `${bgColor}40`,
        alignSelf: 'flex-start',
      }}
    >
      <Text
        style={{
          color: bgColor,
          fontSize: s.fontSize,
          fontFamily: 'Inter_600SemiBold',
        }}
      >
        {displayLabel}
      </Text>
    </View>
  );
};
