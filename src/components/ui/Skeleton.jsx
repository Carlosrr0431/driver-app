import React, { useEffect } from 'react';
import { View } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors } from '../../theme/colors';

const SkeletonBox = ({ width, height, style }) => {
  const opacity = useSharedValue(0.3);

  useEffect(() => {
    opacity.value = withRepeat(withTiming(0.7, { duration: 800 }), -1, true);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: 16,
          backgroundColor: colors.surfaceLight,
        },
        animatedStyle,
        style,
      ]}
    />
  );
};

export const Skeleton = ({ type = 'card' }) => {
  if (type === 'card') {
    return <SkeletonBox width="100%" height={120} style={{ marginBottom: 12 }} />;
  }

  if (type === 'stats') {
    return (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        {[1, 2, 3, 4].map((i) => (
          <SkeletonBox key={i} width="48%" height={90} style={{ marginBottom: 12 }} />
        ))}
      </View>
    );
  }

  if (type === 'list') {
    return (
      <View>
        {[1, 2, 3].map((i) => (
          <SkeletonBox key={i} width="100%" height={80} style={{ marginBottom: 12 }} />
        ))}
      </View>
    );
  }

  return null;
};
