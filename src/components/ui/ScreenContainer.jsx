import React from 'react';
import { View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useResponsive } from '../../hooks/useResponsive';
import { CONTENT_MAX_WIDTH } from '../../utils/responsive';

/**
 * Contenedor de pantalla: padding horizontal adaptativo + ancho máximo en tablet/landscape.
 * No altera la lógica; solo el layout visual.
 */
export function ScreenContainer({
  children,
  style,
  contentStyle,
  padded = true,
  centered = true,
  maxWidth = CONTENT_MAX_WIDTH,
  edges = { top: false, bottom: false, left: true, right: true },
  backgroundColor,
}) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { screenPadding, isTablet, isLandscape } = useResponsive();

  const padX = padded ? screenPadding : 0;
  const useMaxWidth = centered && (isTablet || (isLandscape && width >= 700));

  return (
    <View
      style={[
        {
          flex: 1,
          backgroundColor,
          paddingTop: edges.top ? insets.top : 0,
          paddingBottom: edges.bottom ? insets.bottom : 0,
          paddingLeft: edges.left ? Math.max(insets.left, padX) : 0,
          paddingRight: edges.right ? Math.max(insets.right, padX) : 0,
          alignItems: useMaxWidth ? 'center' : undefined,
        },
        style,
      ]}
    >
      <View
        style={[
          {
            flex: 1,
            width: '100%',
            maxWidth: useMaxWidth ? maxWidth : undefined,
          },
          contentStyle,
        ]}
      >
        {children}
      </View>
    </View>
  );
}
