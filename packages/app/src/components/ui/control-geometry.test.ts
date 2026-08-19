import { describe, expect, it } from "vitest";
import {
  buttonControlHeight,
  createControlGeometry,
  getControlInteractionPhase,
} from "@/components/ui/control-geometry";
import type { Theme } from "@/styles/theme";

const theme = {
  borderRadius: {
    md: 6,
    lg: 8,
    xl: 12,
    full: 9999,
  },
  borderWidth: {
    1: 1,
  },
  colors: {
    accent: "#20744A",
    borderAccent: "#2F3534",
  },
  controlHeight: {
    tight: 28,
    compact: 32,
    field: 44,
  },
  fontSize: {
    xs: 10,
    sm: 12,
    base: 14,
  },
  iconSize: {
    xs: 12,
    sm: 14,
    md: 16,
    lg: 20,
  },
  opacity: {
    50: 0.5,
  },
  spacing: {
    0: 0,
    2: 8,
    3: 12,
    4: 16,
    6: 24,
  },
} as unknown as Theme;

describe("control geometry", () => {
  it("keeps resting control borders transparent while preserving border geometry", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlRest).toMatchObject({
      borderWidth: 1,
      borderColor: "transparent",
      outlineColor: "transparent",
      outlineWidth: 0,
    });
  });

  it("uses the shared hover border and active focus ring values", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.controlHover).toEqual({
      borderColor: "#2F3534",
    });
    expect(geometry.controlActive).toEqual({
      borderColor: "#2F3534",
      outlineColor: "#20744A",
      outlineOffset: 1,
      outlineStyle: "solid",
      outlineWidth: 2,
    });
  });

  it("resolves disabled, focus, open, pressed, and hover into one interaction phase", () => {
    expect(getControlInteractionPhase({ disabled: true, focused: true })).toBe("rest");
    expect(getControlInteractionPhase({ focused: true })).toBe("active");
    expect(getControlInteractionPhase({ open: true })).toBe("active");
    expect(getControlInteractionPhase({ pressed: true })).toBe("active");
    expect(getControlInteractionPhase({ hovered: true })).toBe("hover");
    expect(getControlInteractionPhase({})).toBe("rest");
  });

  it("keeps field text sizing tied to control size", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldTextSm.fontSize).toBe(14);
    expect(geometry.fieldTextSm.lineHeight).toBe(20);
    expect(geometry.fieldTextMd.fontSize).toBe(14);
    expect(geometry.fieldTextMd.lineHeight).toBe(20);
    expect(geometry.formTextInputSm.fontSize).toBe(14);
    expect(geometry.formTextInputSm.lineHeight).toBe(20);
    expect(geometry.formTextInputMd.fontSize).toBe(14);
    expect(geometry.formTextInputMd.lineHeight).toBe(20);
  });

  it("derives field padding from line height without changing the control height", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.fieldControlSm.minHeight).toBe(32);
    expect(geometry.fieldControlSm.paddingVertical).toBe(6);
    expect(geometry.fieldTextSm.lineHeight + geometry.fieldControlSm.paddingVertical * 2).toBe(
      geometry.fieldControlSm.minHeight,
    );

    expect(geometry.fieldControlMd.minHeight).toBe(44);
    expect(geometry.fieldControlMd.paddingVertical).toBe(12);
    expect(geometry.fieldTextMd.lineHeight + geometry.fieldControlMd.paddingVertical * 2).toBe(
      geometry.fieldControlMd.minHeight,
    );

    expect(geometry.formTextInputSm.paddingVertical).toBe(6);
    expect(geometry.formTextInputMd.paddingVertical).toBe(12);
  });

  it("keeps segmented controls ghost with button-radius segments in a button-sized track", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.segmentedContainerXs.padding).toBe(0);
    expect(geometry.segmentedContainerSm.padding).toBe(0);
    expect(geometry.segmentedContainerMd.padding).toBe(0);
    expect(geometry.segmentedSegmentXs.borderRadius).toBe(geometry.buttonXs.borderRadius);
    expect(geometry.segmentedSegmentSm.borderRadius).toBe(geometry.buttonSm.borderRadius);
    expect(geometry.segmentedSegmentMd.borderRadius).toBe(geometry.buttonMd.borderRadius);
    expect(geometry.segmentedContainerXs.minHeight).toBe(geometry.buttonXs.minHeight);
    expect(geometry.segmentedContainerSm.minHeight).toBe(geometry.buttonSm.minHeight);
    expect(geometry.segmentedContainerMd.minHeight).toBe(geometry.buttonMd.minHeight);
    expect(geometry.segmentedSegmentXs.minHeight).toBe(24);
    expect(geometry.segmentedSegmentSm.minHeight).toBe(28);
    expect(geometry.segmentedSegmentMd.minHeight).toBe(38);
  });

  it("keeps one size contract across buttons and segmented controls", () => {
    const geometry = createControlGeometry(theme);

    // xs is a genuinely smaller tier, not sm with a different font.
    expect(geometry.buttonXs.minHeight).toBe(28);
    expect(geometry.buttonSm.minHeight).toBe(32);
    expect(geometry.buttonMd.minHeight).toBe(44);
    expect(geometry.buttonXs.minHeight).toBe(buttonControlHeight.xs);
    expect(geometry.buttonSm.minHeight).toBe(buttonControlHeight.sm);
    expect(geometry.buttonMd.minHeight).toBe(buttonControlHeight.md);

    // Same size name means the same label size on every control kind.
    expect(geometry.segmentedLabelXs.fontSize).toBe(12);
    expect(geometry.segmentedLabelXs.fontSize).toBe(geometry.buttonTextXs.fontSize);
    expect(geometry.segmentedLabelSm.fontSize).toBe(14);
    expect(geometry.segmentedLabelSm.fontSize).toBe(geometry.buttonText.fontSize);
    expect(geometry.segmentedLabelMd.fontSize).toBe(geometry.buttonText.fontSize);

    // Segments sit inside a track, so they run one padding step tighter than a
    // standalone button of the same size — the gap between segments reads as the padding.
    expect(geometry.segmentedSegmentXs.paddingHorizontal).toBeLessThan(
      geometry.buttonXs.paddingHorizontal,
    );
    expect(geometry.segmentedSegmentSm.paddingHorizontal).toBeLessThan(
      geometry.buttonSm.paddingHorizontal,
    );
    expect(geometry.segmentedSegmentMd.paddingHorizontal).toBeLessThan(
      geometry.buttonMd.paddingHorizontal,
    );
  });

  it("derives control geometry from the active theme", () => {
    const scaledTheme = {
      ...theme,
      controlHeight: { tight: 56, compact: 64, field: 88 },
      iconSize: { xs: 24, sm: 28, md: 32, lg: 40 },
    } as Theme;
    const geometry = createControlGeometry(scaledTheme);

    expect(geometry.buttonXs.minHeight).toBe(56);
    expect(geometry.buttonSm.minHeight).toBe(64);
    expect(geometry.buttonMd.minHeight).toBe(88);
    expect(geometry.switchGeometry).toEqual({
      trackWidth: 68,
      trackHeight: 40,
      thumbSize: 32,
      thumbTravel: 28,
    });
  });

  it("preserves the authored switch geometry at the default UI size", () => {
    const geometry = createControlGeometry(theme);

    expect(geometry.switchGeometry).toEqual({
      trackWidth: 34,
      trackHeight: 20,
      thumbSize: 16,
      thumbTravel: 14,
    });
  });
});
