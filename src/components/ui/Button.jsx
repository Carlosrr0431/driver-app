import React from 'react';
import { TouchableOpacity, Text, ActivityIndicator, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { colors } from '../../theme/colors';

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

const SIZES = {
  sm: { paddingVertical: 8, paddingHorizontal: 16, fontSize: 13 },
  md: { paddingVertical: 12, paddingHorizontal: 20, fontSize: 15 },
  lg: { paddingVertical: 16, paddingHorizontal: 24, fontSize: 17 },
  xl: { paddingVertical: 20, paddingHorizontal: 28, fontSize: 20 },
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
  const scale = useSharedValue(1);
  const variantStyle = VARIANTS[variant] || VARIANTS.primary;
  const sizeStyle = SIZES[size] || SIZES.md;

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
      }}
    >
      {loading ? (
        <ActivityIndicator color={variantStyle.textColor} size="small" />
      ) : (
        <>
          {icon && <View style={{ marginRight: 8 }}>{icon}</View>}
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
          borderRadius: 12,
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
          style={{ borderRadius: 12 }}
        >
          {content}
        </LinearGradient>
      ) : (
        content
      )}
    </AnimatedTouchable>
  );
};
