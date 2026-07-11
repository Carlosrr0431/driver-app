import React from 'react';
import {
  View,
  ScrollView,
  StatusBar,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { LoginBrandHeader } from './LoginBrandHeader';
import { useResponsive } from '../../hooks/useResponsive';
import { CONTENT_MAX_WIDTH } from '../../utils/responsive';

const BRAND_BLUE = '#282e69';
const BRAND_BLUE_LIGHT = '#245f8d';

/**
 * Layout responsive del login. El teclado lo maneja adjustResize (Android)
 * y automaticallyAdjustKeyboardInsets en el ScrollView, sin saltos bruscos.
 */
export function LoginScreenLayout({
  children,
  topSlot = null,
  brandHeaderStyle,
  scrollRef,
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { isLandscape, isTablet, screenPadding, s } = useResponsive();
  const spacerHeight = isLandscape
    ? s(12)
    : Math.max(s(32), Math.round(windowHeight * 0.10));
  const contentMax = isTablet || (isLandscape && windowWidth >= 700)
    ? CONTENT_MAX_WIDTH
    : undefined;

  return (
    <View style={{ flex: 1, backgroundColor: '#FFFFFF' }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={[`${BRAND_BLUE}18`, `${BRAND_BLUE_LIGHT}0C`, 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: windowHeight * (isLandscape ? 0.55 : 0.42),
        }}
      />

      <View
        style={{
          flex: 1,
          paddingTop: insets.top + s(8),
          paddingHorizontal: Math.max(insets.left, insets.right, screenPadding + 4),
          alignItems: contentMax ? 'center' : undefined,
        }}
      >
        <View style={{ flex: 1, width: '100%', maxWidth: contentMax }}>
          {topSlot}

          <LoginBrandHeader style={brandHeaderStyle} />

          <View style={{ height: spacerHeight }} />

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
            keyboardDismissMode="on-drag"
            automaticallyAdjustKeyboardInsets
            contentContainerStyle={{ paddingBottom: insets.bottom + s(24) }}
          >
            {children}
          </ScrollView>
        </View>
      </View>
    </View>
  );
}
