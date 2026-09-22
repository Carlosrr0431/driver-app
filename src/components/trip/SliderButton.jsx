import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, Text } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { colors } from '../../theme/colors';
import {
  SLIDER_ACTIVE_OFFSET_X,
  SLIDER_CONFIRM_RATIO,
  SLIDER_FAIL_OFFSET_Y,
  SLIDER_MIN_TRACK,
  SLIDER_PAD,
  SLIDER_THUMB,
  shouldConfirmSlide,
  sliderMaxTravel,
  sliderProgress,
} from '../../utils/sliderConfirm';

const SLIDER_SPRING_RESET = { damping: 22, stiffness: 320, mass: 0.7 };

function buzzSuccess() {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}

export function SliderButton({
  onConfirm,
  label = 'Deslizá para confirmar',
  color,
  disabled = false,
  resetRef,
  onLock = null,
}) {
  const onConfirmRef = useRef(onConfirm);
  const onLockRef = useRef(onLock);
  const didTriggerRef = useRef(false);
  const translateX = useSharedValue(0);
  const trackWidth = useSharedValue(0);
  const startX = useSharedValue(0);
  const dragging = useSharedValue(0);
  const confirmed = useSharedValue(false);
  const disabledSV = useSharedValue(disabled);

  useEffect(() => { onConfirmRef.current = onConfirm; }, [onConfirm]);
  useEffect(() => { onLockRef.current = onLock; }, [onLock]);
  useEffect(() => { disabledSV.value = disabled; }, [disabled, disabledSV]);

  const maxTravel = useDerivedValue(() => sliderMaxTravel(trackWidth.value));

  const setLocked = useCallback((locked) => {
    onLockRef.current?.(locked);
  }, []);

  const resetSlider = useCallback(() => {
    didTriggerRef.current = false;
    confirmed.value = false;
    dragging.value = 0;
    translateX.value = withSpring(0, SLIDER_SPRING_RESET);
    setLocked(false);
  }, [confirmed, dragging, translateX, setLocked]);

  const triggerConfirm = useCallback(() => {
    if (didTriggerRef.current) return;
    didTriggerRef.current = true;
    const opened = onConfirmRef.current?.();
    if (opened === false) {
      resetSlider();
      return;
    }
    buzzSuccess();
  }, [resetSlider]);

  React.useImperativeHandle(resetRef, () => ({
    reset: resetSlider,
  }), [resetSlider]);

  const panGesture = useMemo(() => Gesture.Pan()
    .maxPointers(1)
    .activeOffsetX([-SLIDER_ACTIVE_OFFSET_X, SLIDER_ACTIVE_OFFSET_X])
    .failOffsetY([-SLIDER_FAIL_OFFSET_Y, SLIDER_FAIL_OFFSET_Y])
    .shouldCancelWhenOutside(false)
    .blocksExternalGesture()
    .onBegin(() => {
      if (disabledSV.value || confirmed.value) return;
      if (trackWidth.value < SLIDER_MIN_TRACK) return;
      dragging.value = 1;
      startX.value = translateX.value;
      runOnJS(setLocked)(true);
    })
    .onUpdate((e) => {
      if (disabledSV.value || confirmed.value) return;
      const max = maxTravel.value;
      if (max <= 0) return;
      translateX.value = Math.max(0, Math.min(startX.value + e.translationX, max));
    })
    .onEnd((e) => {
      dragging.value = 0;
      if (disabledSV.value || confirmed.value) return;
      const max = maxTravel.value;
      const progress = sliderProgress(translateX.value, max);
      if (shouldConfirmSlide(progress, e.velocityX)) {
        confirmed.value = true;
        translateX.value = withTiming(Math.max(max, 1), { duration: 90 });
        runOnJS(triggerConfirm)();
        return;
      }
      translateX.value = withSpring(0, SLIDER_SPRING_RESET);
      runOnJS(setLocked)(false);
    })
    .onFinalize((_e, success) => {
      dragging.value = 0;
      if (confirmed.value) return;
      if (!success || disabledSV.value) {
        translateX.value = withSpring(0, SLIDER_SPRING_RESET);
        runOnJS(setLocked)(false);
        return;
      }
      const max = maxTravel.value;
      const progress = sliderProgress(translateX.value, max);
      if (progress >= SLIDER_CONFIRM_RATIO) {
        confirmed.value = true;
        translateX.value = withTiming(Math.max(max, 1), { duration: 90 });
        runOnJS(triggerConfirm)();
        return;
      }
      translateX.value = withSpring(0, SLIDER_SPRING_RESET);
      runOnJS(setLocked)(false);
    }),
  [disabledSV, confirmed, dragging, maxTravel, startX, translateX, triggerConfirm, trackWidth, setLocked]);

  const btnColor = color || colors.danger;

  const trackStyle = useAnimatedStyle(() => ({
    opacity: disabledSV.value ? 0.45 : 1,
  }));

  const fillStyle = useAnimatedStyle(() => ({
    width: Math.max(trackWidth.value, 1),
    backgroundColor: btnColor,
    opacity: 0.32,
    transform: [{
      translateX: interpolate(
        translateX.value,
        [0, Math.max(maxTravel.value, 1)],
        [-Math.max(trackWidth.value, 1), 0],
        Extrapolation.CLAMP,
      ),
    }],
  }));

  const labelStyle = useAnimatedStyle(() => ({
    opacity: interpolate(
      translateX.value,
      [0, Math.max(maxTravel.value, 1) * 0.45],
      [1, 0],
      Extrapolation.CLAMP,
    ),
  }));

  const thumbStyle = useAnimatedStyle(() => ({
    backgroundColor: btnColor,
    transform: [
      { translateX: translateX.value },
      { scale: interpolate(dragging.value, [0, 1], [1, 1.06], Extrapolation.CLAMP) },
    ],
  }));

  return (
    <GestureDetector gesture={panGesture}>
      <Animated.View
        collapsable={false}
        onLayout={(e) => { trackWidth.value = e.nativeEvent.layout.width; }}
        style={[
          sliderS.track,
          { backgroundColor: `${btnColor}18`, borderColor: `${btnColor}45` },
          trackStyle,
        ]}
      >
        <Animated.View pointerEvents="none" style={[sliderS.fill, fillStyle]} />
        <Animated.View style={[sliderS.labelRow, labelStyle]} pointerEvents="none">
          <MaterialCommunityIcons name="chevron-double-right" size={16} color={btnColor} />
          <Text style={[sliderS.labelText, { color: btnColor }]}>{label}</Text>
          <MaterialCommunityIcons name="chevron-double-right" size={16} color={`${btnColor}55`} />
        </Animated.View>
        <Animated.View style={[sliderS.thumb, thumbStyle]} pointerEvents="none">
          <MaterialCommunityIcons name="flag-checkered" size={22} color="#fff" />
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

const sliderS = StyleSheet.create({
  track: {
    height: 60,
    borderRadius: 30,
    borderWidth: 1.5,
    marginBottom: 12,
    justifyContent: 'center',
    overflow: 'hidden',
    borderCurve: 'continuous',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    borderRadius: 30,
  },
  labelRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  labelText: { fontSize: 15, fontFamily: 'Inter_600SemiBold' },
  thumb: {
    width: SLIDER_THUMB,
    height: SLIDER_THUMB,
    borderRadius: SLIDER_THUMB / 2,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: SLIDER_PAD,
    elevation: 5,
    boxShadow: '0 2px 4px rgba(0,0,0,0.22)',
  },
});
