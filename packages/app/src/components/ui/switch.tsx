import { useCallback, useMemo } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import Animated, {
  Easing,
  interpolateColor,
  useAnimatedStyle,
  useDerivedValue,
  withTiming,
} from "react-native-reanimated";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { createControlGeometry } from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

interface SwitchProps {
  value: boolean;
  onValueChange?: (value: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
}

const TIMING = { duration: 180, easing: Easing.inOut(Easing.ease) };

interface SwitchTrackProps {
  value: boolean;
  trackOffColor: string;
  trackOnColor: string;
  thumbOffColor: string;
  thumbOnColor: string;
  thumbTravel: number;
}

function SwitchTrack({
  value,
  trackOffColor,
  trackOnColor,
  thumbOffColor,
  thumbOnColor,
  thumbTravel,
}: SwitchTrackProps) {
  const progress = useDerivedValue(() => withTiming(value ? 1 : 0, TIMING));

  const trackAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [trackOffColor, trackOnColor]),
  }));

  const thumbAnimatedStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(progress.value, [0, 1], [thumbOffColor, thumbOnColor]),
    transform: [{ translateX: progress.value * thumbTravel }],
  }));

  const trackStyle = useMemo(() => [styles.switchTrack, trackAnimatedStyle], [trackAnimatedStyle]);
  const thumbStyle = useMemo(
    () => [styles.switchThumb, styles.thumb, thumbAnimatedStyle],
    [thumbAnimatedStyle],
  );

  return (
    <Animated.View style={trackStyle}>
      <Animated.View style={thumbStyle} />
    </Animated.View>
  );
}

const ThemedSwitchTrack = withUnistyles(SwitchTrack, (theme: Theme) => ({
  trackOffColor: theme.colors.surface3,
  trackOnColor: theme.colors.accent,
  thumbOffColor: theme.colors.palette.white,
  thumbOnColor: theme.colors.accentForeground,
  thumbTravel: createControlGeometry(theme).switchGeometry.thumbTravel,
}));

export function Switch({
  value,
  onValueChange,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}: SwitchProps) {
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (disabled) return;
      onValueChange?.(!value);
    },
    [disabled, onValueChange, value],
  );

  const accessibilityState = useMemo(() => ({ checked: value, disabled }), [value, disabled]);
  const pressableStyle = useMemo(
    () => [styles.switchControl, disabled ? styles.disabled : null, style],
    [disabled, style],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel}
      aria-checked={value}
      testID={testID}
      style={pressableStyle}
    >
      <ThemedSwitchTrack value={value} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => {
  const geometry = createControlGeometry(theme);

  return {
    switchControl: {
      ...geometry.switchControl,
    },
    switchTrack: {
      width: geometry.switchGeometry.trackWidth,
      height: geometry.switchGeometry.trackHeight,
      borderRadius: geometry.switchGeometry.trackHeight / 2,
      padding: (geometry.switchGeometry.trackHeight - geometry.switchGeometry.thumbSize) / 2,
      justifyContent: "center",
    },
    switchThumb: {
      width: geometry.switchGeometry.thumbSize,
      height: geometry.switchGeometry.thumbSize,
      borderRadius: geometry.switchGeometry.thumbSize / 2,
    },
    thumb: {
      shadowColor: "rgba(0, 0, 0, 0.25)",
      shadowOffset: { width: 0, height: 1 },
      shadowRadius: 2,
      shadowOpacity: 1,
      elevation: 2,
    },
    disabled: {
      opacity: theme.opacity[50],
    },
  };
});
