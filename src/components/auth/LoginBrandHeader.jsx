import React from 'react';
import { View, Text, Dimensions } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeIn } from 'react-native-reanimated';

const { width } = Dimensions.get('window');
export const LOGO_WIDTH = width * 0.52;
export const BRAND_BLUE = '#282e69';

export function LoginBrandHeader({ style }) {
  return (
    <Animated.View
      entering={FadeIn.delay(150).duration(500)}
      style={[{ alignItems: 'center', marginBottom: 28 }, style]}
    >
      <View style={{ width: LOGO_WIDTH, alignItems: 'center' }}>
        <Image
          source={require('../../../assets/logo.png')}
          style={{ width: LOGO_WIDTH, height: undefined, aspectRatio: 550 / 295 }}
          contentFit="contain"
        />
        <Text
          style={{
            marginTop: 10,
            width: LOGO_WIDTH,
            fontSize: 14,
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
