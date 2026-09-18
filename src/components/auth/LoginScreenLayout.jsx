import React, { useEffect, useState } from 'react';
import {
  View,
  ScrollView,
  StatusBar,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { LoginBrandHeader } from './LoginBrandHeader';
import { useResponsive } from '../../hooks/useResponsive';
import { CONTENT_MAX_WIDTH } from '../../utils/responsive';
import { colors } from '../../theme/colors';

const BRAND_BLUE = '#282e69';
const BRAND_BLUE_LIGHT = '#245f8d';

/**
 * Layout responsive del login. El header va dentro del ScrollView para que
 * el teclado no tape el input. Android usa adjustResize; iOS, KeyboardAvoidingView.
 */
export function LoginScreenLayout({
  children,
  topSlot = null,
  brandHeaderStyle,
  scrollRef,
}) {
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const { isLandscape, isTablet, isCompactHeight, screenPadding, s } = useResponsive();
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const sideBySide = isLandscape && windowWidth >= 740;
  const contentMax = isTablet || sideBySide
    ? CONTENT_MAX_WIDTH
    : undefined;
  const compactBrand = sideBySide || isCompactHeight || keyboardVisible;

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSub = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const form = (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1 }}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      bounces={false}
      keyboardDismissMode="on-drag"
      automaticallyAdjustKeyboardInsets
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{
        paddingBottom: s(keyboardVisible ? 28 : 20),
        flexGrow: sideBySide ? 1 : undefined,
        justifyContent: sideBySide ? 'center' : undefined,
      }}
    >
      {sideBySide ? null : (
        <LoginBrandHeader compact={compactBrand} style={brandHeaderStyle} />
      )}
      {children}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <StatusBar barStyle="dark-content" backgroundColor="transparent" translucent />

      <LinearGradient
        colors={[`${BRAND_BLUE}22`, `${BRAND_BLUE_LIGHT}10`, 'transparent']}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          height: windowHeight * (isLandscape ? 0.7 : 0.38),
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          top: -70,
          right: -40,
          width: 220,
          height: 220,
          borderRadius: 110,
          backgroundColor: `${BRAND_BLUE}12`,
        }}
      />
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          bottom: 80,
          left: -70,
          width: 180,
          height: 180,
          borderRadius: 90,
          backgroundColor: `${BRAND_BLUE_LIGHT}0D`,
        }}
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View
          style={{
            flex: 1,
            paddingTop: insets.top + s(sideBySide ? 6 : compactBrand ? 4 : 8),
            paddingHorizontal: Math.max(insets.left, insets.right, screenPadding),
            paddingBottom: keyboardVisible ? s(8) : insets.bottom,
            alignItems: contentMax && !sideBySide ? 'center' : undefined,
          }}
        >
          <View style={{
            flex: 1,
            width: '100%',
            maxWidth: sideBySide ? undefined : contentMax,
            flexDirection: sideBySide ? 'row' : 'column',
            alignItems: sideBySide ? 'center' : undefined,
            gap: sideBySide ? s(20) : 0,
          }}
          >
            {topSlot}

            {sideBySide ? (
              <View style={{ width: '38%', alignItems: 'center' }}>
                <LoginBrandHeader compact style={brandHeaderStyle} />
              </View>
            ) : null}

            {form}
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
