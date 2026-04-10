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
