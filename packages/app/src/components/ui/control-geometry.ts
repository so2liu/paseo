import type { StyleProp, ViewStyle } from "react-native";
import { CONTROL_HEIGHT, type Theme } from "@/styles/theme";

export type ButtonControlSize = "xs" | "sm" | "md" | "lg";
export type FieldControlSize = "sm" | "md";
export type SegmentedControlSize = "xs" | "sm" | "md";
export type ControlInteractionPhase = "rest" | "hover" | "active";

export interface ControlInteractionState {
  hovered?: boolean;
  focused?: boolean;
  pressed?: boolean;
  open?: boolean;
  active?: boolean;
  disabled?: boolean;
}

export interface ControlInteractionStyleMap {
  controlRest: StyleProp<ViewStyle>;
  controlHover: StyleProp<ViewStyle>;
  controlActive: StyleProp<ViewStyle>;
  controlDisabled?: StyleProp<ViewStyle>;
}

const SEGMENTED_TIGHT_INSET = 2;
const SEGMENTED_COMPACT_INSET = 2;
const SEGMENTED_FIELD_INSET = 3;
const SWITCH_TRACK_WIDTH = 34;
const SWITCH_TRACK_HEIGHT = 20;
const SWITCH_THUMB_SIZE = 16;
const CONTROL_FOCUS_RING_WIDTH = 2;
const CONTROL_FOCUS_RING_OFFSET = 1;
const CONTROL_CENTER_JUSTIFY_CONTENT = "center";
const FIELD_TEXT_LINE_HEIGHT_RATIO = 1.4;

/**
 * The three control heights every button, field, and segmented control is built from.
 * Exported so a row that hosts one of those controls can size itself from the same
 * numbers instead of guessing a height the control then outgrows.
 */
export const CONTROL_HEIGHTS = {
  tight: CONTROL_HEIGHT.tight,
  compact: CONTROL_HEIGHT.compact,
  field: CONTROL_HEIGHT.field,
};

export const buttonControlHeight: Record<ButtonControlSize, number> = {
  xs: CONTROL_HEIGHTS.tight,
  sm: CONTROL_HEIGHTS.compact,
  md: CONTROL_HEIGHTS.field,
  lg: CONTROL_HEIGHTS.field,
};

function fieldLineHeight(fontSize: number): number {
  return Math.round(fontSize * FIELD_TEXT_LINE_HEIGHT_RATIO);
}

function fieldVerticalPadding(controlHeight: number, lineHeight: number): number {
  return (controlHeight - lineHeight) / 2;
}

export function getControlInteractionPhase(
  state: ControlInteractionState,
): ControlInteractionPhase {
  if (state.disabled) {
    return "rest";
  }
  if (state.active || state.focused || state.open || state.pressed) {
    return "active";
  }
  if (state.hovered) {
    return "hover";
  }
  return "rest";
}

export function resolveControlInteractionStyles(
  styles: ControlInteractionStyleMap,
  state: ControlInteractionState,
): StyleProp<ViewStyle> {
  const phase = getControlInteractionPhase(state);
  return [
    styles.controlRest,
    phase === "hover" ? styles.controlHover : null,
    phase === "active" ? styles.controlActive : null,
    state.disabled ? styles.controlDisabled : null,
  ];
}

export function createControlGeometry(theme: Theme) {
  // Fork: control heights scale with the UI font size, so they come off the theme
  // rather than the module-level ramp the static exports above expose.
  const controlHeights = theme.controlHeight;
  const switchScale = theme.iconSize.md / SWITCH_THUMB_SIZE;
  const switchTrackWidth = SWITCH_TRACK_WIDTH * switchScale;
  const switchTrackHeight = SWITCH_TRACK_HEIGHT * switchScale;
  const switchThumbSize = SWITCH_THUMB_SIZE * switchScale;
  const switchTrackInset = (switchTrackHeight - switchThumbSize) / 2;
  const switchGeometry = {
    trackWidth: switchTrackWidth,
    trackHeight: switchTrackHeight,
    thumbSize: switchThumbSize,
    thumbTravel: switchTrackWidth - switchThumbSize - switchTrackInset * 2,
  };
  const fieldTextSmLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldTextMdLineHeight = fieldLineHeight(theme.fontSize.base);
  const fieldControlSm = {
    minHeight: controlHeights.compact,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: fieldVerticalPadding(controlHeights.compact, fieldTextSmLineHeight),
    borderRadius: theme.borderRadius.md,
  };
  const fieldControlMd = {
    minHeight: controlHeights.field,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: fieldVerticalPadding(controlHeights.field, fieldTextMdLineHeight),
    borderRadius: theme.borderRadius.lg,
  };
  const fieldTextSm = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextSmLineHeight,
  };
  const fieldTextMd = {
    fontSize: theme.fontSize.base,
    lineHeight: fieldTextMdLineHeight,
  };
  const switchControl = {
    minHeight: controlHeights.compact,
    justifyContent: CONTROL_CENTER_JUSTIFY_CONTENT,
  } satisfies { minHeight: number; justifyContent: "center" };

  return {
    buttonXs: {
      minHeight: controlHeights.tight,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    buttonSm: {
      minHeight: controlHeights.compact,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.md,
    },
    buttonMd: {
      minHeight: controlHeights.field,
      paddingHorizontal: theme.spacing[4],
      borderRadius: theme.borderRadius.lg,
    },
    buttonLg: {
      minHeight: controlHeights.field,
      paddingHorizontal: theme.spacing[6],
      borderRadius: theme.borderRadius.xl,
    },
    buttonText: {
      fontSize: theme.fontSize.base,
    },
    buttonTextXs: {
      fontSize: theme.fontSize.sm,
    },
    formTextInputSm: {
      ...fieldControlSm,
      ...fieldTextSm,
    },
    formTextInputMd: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    formTextInput: {
      ...fieldControlMd,
      ...fieldTextMd,
    },
    fieldControlSm,
    fieldControlMd,
    fieldTextSm,
    fieldTextMd,
    controlRest: {
      borderWidth: theme.borderWidth[1],
      borderColor: "transparent",
      outlineWidth: 0,
      outlineColor: "transparent",
    },
    controlHover: {
      borderColor: theme.colors.borderAccent,
    },
    controlActive: {
      borderColor: theme.colors.borderAccent,
      outlineColor: theme.colors.accent,
      outlineOffset: CONTROL_FOCUS_RING_OFFSET,
      outlineStyle: "solid" as const,
      outlineWidth: CONTROL_FOCUS_RING_WIDTH,
    },
    controlFocusRingColor: {
      outlineColor: theme.colors.accent,
    },
    controlDisabled: {
      opacity: theme.opacity[50],
    },
    switchControl,
    switchGeometry,
    segmentedContainerXs: {
      minHeight: controlHeights.tight,
      padding: 0,
    },
    segmentedContainerSm: {
      minHeight: controlHeights.compact,
      padding: 0,
    },
    segmentedContainerMd: {
      minHeight: controlHeights.field,
      padding: 0,
    },
    segmentedSegmentXs: {
      minHeight: controlHeights.tight - SEGMENTED_TIGHT_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
    },
    segmentedSegmentSm: {
      minHeight: controlHeights.compact - SEGMENTED_COMPACT_INSET * 2,
      paddingHorizontal: theme.spacing[2],
      borderRadius: theme.borderRadius.md,
    },
    segmentedSegmentMd: {
      minHeight: controlHeights.field - SEGMENTED_FIELD_INSET * 2,
      paddingHorizontal: theme.spacing[3],
      borderRadius: theme.borderRadius.lg,
    },
    segmentedLabelXs: {
      fontSize: theme.fontSize.sm,
    },
    segmentedLabelSm: {
      fontSize: theme.fontSize.base,
    },
    segmentedLabelMd: {
      fontSize: theme.fontSize.base,
    },
  };
}
