import React, { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';
import { CONTENT_MAX_WIDTH } from '../../utils/responsive';

function PulseBlock({ style, animatedStyle }) {
  return <Animated.View style={[styles.block, style, animatedStyle]} />;
}

export function AppResumeSkeleton({ visible }) {
  const insets = useSafeAreaInsets();
  const { s, vs, isLandscape, isTablet, isCompactHeight, screenPadding } = useResponsive();
  const opacity = useSharedValue(0.42);

  useEffect(() => {
    if (!visible) return undefined;
    opacity.value = withRepeat(withTiming(0.9, { duration: 760 }), -1, true);
    return undefined;
  }, [visible, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  if (!visible) return null;

  const padX = Math.max(screenPadding, s(16));
  const chipH = s(36, { min: 32, max: 42 });
  const sheetWidth = isLandscape
    ? Math.min(s(340, { max: 400 }), Math.round(CONTENT_MAX_WIDTH * 0.72))
    : undefined;
  const sheetMaxH = isCompactHeight
    ? vs(220, { min: 168, max: 260 })
    : isLandscape
      ? undefined
      : vs(280, { min: 220, max: 340 });

  return (
    <View
      accessibilityLabel="Actualizando estado"
      accessibilityRole="progressbar"
      accessibilityState={{ busy: true }}
      pointerEvents="auto"
      style={styles.overlay}
    >
      <View
        style={[
          styles.frame,
          isLandscape && styles.frameRow,
          isTablet && styles.frameTablet,
          {
            paddingTop: Math.max(insets.top, 10),
            paddingBottom: Math.max(insets.bottom, 12),
            paddingHorizontal: padX,
            maxWidth: isTablet ? CONTENT_MAX_WIDTH + 48 : undefined,
          },
        ]}
      >
        <View style={[styles.main, isLandscape && styles.mainRow]}>
          <PulseBlock
            animatedStyle={animatedStyle}
            style={[
              styles.hero,
              {
                minHeight: isCompactHeight ? vs(120, { min: 96 }) : vs(180, { min: 140 }),
                borderRadius: s(22, { min: 18, max: 28 }),
              },
            ]}
          />
          <View
            style={[
              styles.sheet,
              {
                width: sheetWidth,
                maxHeight: sheetMaxH,
                marginTop: isLandscape ? 0 : 12,
                paddingHorizontal: s(20, { min: 16, max: 24 }),
                paddingTop: s(14),
                paddingBottom: s(16),
                borderTopLeftRadius: isLandscape ? s(24) : s(28),
                borderTopRightRadius: s(28),
                borderBottomLeftRadius: isLandscape ? s(24) : 0,
                borderBottomRightRadius: isLandscape ? s(24) : 0,
                gap: s(10, { min: 8, max: 14 }),
              },
            ]}
          >
            <PulseBlock
              animatedStyle={animatedStyle}
              style={[styles.handle, { width: s(36), height: 4 }]}
            />
            <PulseBlock
              animatedStyle={animatedStyle}
              style={[styles.title, { width: '58%', height: s(18, { min: 14, max: 22 }) }]}
            />
            <PulseBlock
              animatedStyle={animatedStyle}
              style={[styles.line, { height: s(12, { min: 10, max: 14 }) }]}
            />
            <PulseBlock
              animatedStyle={animatedStyle}
              style={[styles.line, { width: '78%', height: s(12, { min: 10, max: 14 }) }]}
            />
            {isCompactHeight ? null : (
              <PulseBlock
                animatedStyle={animatedStyle}
                style={[styles.rowCard, { height: s(52, { min: 44, max: 60 }) }]}
              />
            )}
            <PulseBlock
              animatedStyle={animatedStyle}
              style={[styles.cta, { height: s(50, { min: 44, max: 56 }) }]}
            />
          </View>
        </View>
        <View style={[styles.topBar, { height: chipH }]}>
          <PulseBlock
            animatedStyle={animatedStyle}
            style={[styles.chip, { width: s(128, { min: 96, max: 160 }), height: chipH }]}
          />
          <PulseBlock
            animatedStyle={animatedStyle}
            style={[styles.chipRound, { width: chipH, height: chipH }]}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 998,
    elevation: 998,
    backgroundColor: colors.background,
    alignItems: 'center',
  },
  frame: {
    flex: 1,
    width: '100%',
    position: 'relative',
  },
  frameRow: {
    justifyContent: 'center',
  },
  frameTablet: {
    alignSelf: 'center',
  },
  main: {
    flex: 1,
    minHeight: 0,
  },
  mainRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 12,
  },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    pointerEvents: 'none',
  },
  block: {
    backgroundColor: colors.surfaceLight,
    borderCurve: 'continuous',
  },
  hero: {
    flex: 1,
    minWidth: 0,
  },
  sheet: {
    marginTop: 12,
    backgroundColor: colors.surface,
    overflow: 'hidden',
  },
  handle: {
    alignSelf: 'center',
    borderRadius: 2,
  },
  title: {
    borderRadius: 8,
  },
  line: {
    width: '100%',
    borderRadius: 8,
  },
  rowCard: {
    width: '100%',
    borderRadius: 14,
  },
  cta: {
    width: '100%',
    borderRadius: 16,
    marginTop: 4,
  },
  chip: {
    borderRadius: 18,
  },
  chipRound: {
    borderRadius: 18,
  },
});
