import React from 'react';
import { View, Text, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useResponsive } from '../../hooks/useResponsive';

export const BRAND_BLUE = '#282e69';
const LOGO_ASPECT = 813.3 / 436.7;

export function LoginBrandHeader({ style }) {
  const { width } = useWindowDimensions();
  const { isLandscape, isTablet, fs, s } = useResponsive();
  const logoWidth = Math.min(
    width * (isLandscape ? 0.28 : 0.46),
    isTablet ? 220 : 180,
  );

  return (
    <Animated.View
      entering={FadeIn.delay(150).duration(500)}
      style={[{ alignItems: 'center', marginBottom: s(isLandscape ? 12 : 28) }, style]}
    >
      <View style={{ width: logoWidth, alignItems: 'center' }}>
        <Image
          source={require('../../../assets/logo.png')}
          style={{ width: logoWidth, height: undefined, aspectRatio: LOGO_ASPECT }}
          contentFit="contain"
        />
        <Text
          style={{
            marginTop: s(10),
            width: logoWidth,
            fontSize: fs(14),
            fontFamily: 'Inter_600SemiBold',
            color: BRAND_BLUE,
            letterSpacing: 2,
            textAlign: 'center',
            textTransform: 'uppercase',
            includeFontPadding: false,
            transform: [{ translateX: -1 }],
          }}
        >
          Conductor
        </Text>
      </View>
    </Animated.View>
  );
}
