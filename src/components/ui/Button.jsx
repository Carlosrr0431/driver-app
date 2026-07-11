/**
 * Componente: Button
 * Que hace: Boton reutilizable con variantes visuales, estado de carga y animacion tactil con haptics.
 * Usado por:
 * - Sin imports directos detectados en driver-app (componente disponible para reutilizacion).
 */
import React, { useMemo } from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors } from '../../theme/colors';
import { useResponsive } from '../../hooks/useResponsive';

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

const VARIANTS = {
  primary: {
    gradient: colors.gradient.primary,
    textColor: '#FFFFFF',
  },
  success: {
    gradient: colors.gradient.success,
    textColor: '#FFFFFF',
  },
  danger: {
    gradient: colors.gradient.danger,
    textColor: '#FFFFFF',
  },
  outline: {
    gradient: null,
    textColor: colors.primary,
    borderColor: colors.primary,
  },
  outlineDanger: {
    gradient: null,
    textColor: colors.danger,
    borderColor: colors.danger,
  },
  ghost: {
    gradient: null,
    textColor: colors.textMuted,
  },
};

export const Button = ({
  title,
  onPress,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  icon,
  fullWidth = true,
  style,
}) => {
  const { s, fs } = useResponsive();
  const scale = useSharedValue(1);
  const variantStyle = VARIANTS[variant] || VARIANTS.primary;

  const sizeStyle = useMemo(() => {
    const sizes = {
      sm: { paddingVertical: s(8), paddingHorizontal: s(16), fontSize: fs(13) },
      md: { paddingVertical: s(12), paddingHorizontal: s(20), fontSize: fs(15) },
      lg: { paddingVertical: s(16), paddingHorizontal: s(24), fontSize: fs(17) },
      xl: { paddingVertical: s(20), paddingHorizontal: s(28), fontSize: fs(20) },
    };
    return sizes[size] || sizes.md;
  }, [s, fs, size]);

  const radius = s(12);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePressIn = () => {
    scale.value = withSpring(0.96);
  };

  const handlePressOut = () => {
    scale.value = withSpring(1);
  };

  const handlePress = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (onPress) onPress();
  };

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: sizeStyle.paddingVertical,
        paddingHorizontal: sizeStyle.paddingHorizontal,
        minHeight: s(44, { min: 40 }),
      }}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.textColor} size="small" />
      ) : (
        <>
          {icon ? <View style={{ marginRight: s(8) }}>{icon}</View> : null}
          <Text
            style={{
              color: variantStyle.textColor,
              fontSize: sizeStyle.fontSize,
              fontFamily: 'Inter_600SemiBold',
              textAlign: 'center',
            }}
          >
            {title}
          </Text>
        </>
      )}
    </View>
  );

  return (
    <AnimatedTouchable
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        animatedStyle,
        {
          borderRadius: radius,
          overflow: 'hidden',
          opacity: disabled ? 0.5 : 1,
          width: fullWidth ? '100%' : undefined,
        },
        !variantStyle.gradient && {
          borderWidth: variantStyle.borderColor ? 2 : 0,
          borderColor: variantStyle.borderColor,
          backgroundColor: 'transparent',
        },
        style,
      ]}
    >
      {variantStyle.gradient ? (
        <LinearGradient
          colors={variantStyle.gradient}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          style={{ borderRadius: radius }}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </AnimatedTouchable>
  );
};
