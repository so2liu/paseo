import { memo, useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  View,
  Text,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type AccessibilityActionEvent,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";
import { resolvePromptIndexAtOffset, type ChatOutlineRailProps } from "./model";
import { CHAT_OUTLINE_RAIL_OFFSET, CHAT_OUTLINE_RAIL_WIDTH } from "./layout";

// Native has no hover, and a long conversation squeezes the slots well below a tap-sized
// target, so the rail is a scrubber rather than a column of buttons: press anywhere on it
// to preview the prompt under your finger, slide to hunt, lift to jump. Tapping is the
// degenerate case of the same gesture, so a confident tap still lands in one touch.
const RAIL_WIDTH = CHAT_OUTLINE_RAIL_WIDTH;
const SLOT_HEIGHT = 8;
const RESTING_PILL_HEIGHT = 2;
const RESTING_PILL_WIDTH = 10;
const ACTIVE_PILL_WIDTH = 18;
const SCRUBBED_PILL_WIDTH = 24;
const SCRUBBED_PILL_HEIGHT = 4;
const PREVIEW_WIDTH = 220;

export const ChatOutlineRail = memo(function ChatOutlineRail({
  prompts,
  activePrompt,
  onJumpToPrompt,
}: ChatOutlineRailProps) {
  const activeSeq = useSyncExternalStore(activePrompt.subscribe, activePrompt.getActiveSeq);
  const [scrubbedIndex, setScrubbedIndex] = useState<number | null>(null);
  // The native transcript does not report a reading position, so nothing publishes an
  // active prompt here. Remembering the last jump keeps assistive stepping moving forward
  // instead of restarting from the first prompt every time. It is stored by sequence, not
  // by index, so switching agents or timeline epochs drops it instead of pointing the mark
  // and the accessibility value at an unrelated prompt in the new conversation.
  const [steppedSeq, setSteppedSeq] = useState<number | null>(null);
  const railHeightRef = useRef(0);

  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    railHeightRef.current = event.nativeEvent.layout.height;
  }, []);

  const resolveIndex = useCallback(
    (event: GestureResponderEvent) =>
      resolvePromptIndexAtOffset({
        offsetY: event.nativeEvent.locationY,
        railHeight: railHeightRef.current,
        promptCount: prompts.length,
      }),
    [prompts.length],
  );

  const claimResponder = useCallback(() => true, []);
  const handleResponderMove = useCallback(
    (event: GestureResponderEvent) => setScrubbedIndex(resolveIndex(event)),
    [resolveIndex],
  );
  const handleResponderRelease = useCallback(
    (event: GestureResponderEvent) => {
      const index = resolveIndex(event);
      setScrubbedIndex(null);
      const prompt = index === null ? undefined : prompts[index];
      if (prompt) {
        setSteppedSeq(prompt.seq);
        onJumpToPrompt(prompt.seq);
      }
    },
    [onJumpToPrompt, prompts, resolveIndex],
  );
  const handleResponderTerminate = useCallback(() => setScrubbedIndex(null), []);

  const activeIndex = useMemo(
    () => prompts.findIndex((prompt) => prompt.seq === activeSeq),
    [activeSeq, prompts],
  );
  const steppedIndex = useMemo(
    () => prompts.findIndex((prompt) => prompt.seq === steppedSeq),
    [prompts, steppedSeq],
  );
  const resolvedIndex = activeIndex === -1 ? steppedIndex : activeIndex;
  const cursorIndex = resolvedIndex === -1 ? null : resolvedIndex;
  // VoiceOver cannot scrub, so the rail exposes the same navigation as an adjustable
  // control: swipe up/down steps one prompt at a time from wherever the reader is.
  const handleAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      const step = event.nativeEvent.actionName === "increment" ? 1 : -1;
      const from = cursorIndex ?? (step === 1 ? -1 : prompts.length);
      const nextIndex = Math.min(prompts.length - 1, Math.max(0, from + step));
      const prompt = prompts[nextIndex];
      if (prompt) {
        setSteppedSeq(prompt.seq);
        onJumpToPrompt(prompt.seq);
      }
    },
    [cursorIndex, onJumpToPrompt, prompts],
  );

  const accessibilityValue = useMemo(
    () =>
      cursorIndex === null ? undefined : { now: cursorIndex + 1, min: 1, max: prompts.length },
    [cursorIndex, prompts.length],
  );

  if (prompts.length < 2) {
    return null;
  }

  return (
    <View
      style={styles.rail}
      testID="chat-outline-rail"
      onLayout={handleLayout}
      onStartShouldSetResponder={claimResponder}
      onMoveShouldSetResponder={claimResponder}
      onResponderGrant={handleResponderMove}
      onResponderMove={handleResponderMove}
      onResponderRelease={handleResponderRelease}
      onResponderTerminate={handleResponderTerminate}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Chat outline"
      accessibilityValue={accessibilityValue}
      accessibilityActions={ACCESSIBILITY_ACTIONS}
      onAccessibilityAction={handleAccessibilityAction}
    >
      {prompts.map((prompt, index) => (
        <ChatOutlineTick
          key={prompt.seq}
          seq={prompt.seq}
          preview={prompt.preview}
          isActive={index === cursorIndex}
          isScrubbed={index === scrubbedIndex}
        />
      ))}
    </View>
  );
});

function resolvePillWidth(input: { isScrubbed: boolean; isActive: boolean }): number {
  if (input.isScrubbed) {
    return SCRUBBED_PILL_WIDTH;
  }
  return input.isActive ? ACTIVE_PILL_WIDTH : RESTING_PILL_WIDTH;
}

const ChatOutlineTick = memo(function ChatOutlineTick({
  seq,
  preview,
  isActive,
  isScrubbed,
}: {
  seq: number;
  preview: string;
  isActive: boolean;
  isScrubbed: boolean;
}) {
  const pillStyle = useMemo(
    () => [
      styles.pill,
      isActive && styles.pillActive,
      isScrubbed && styles.pillScrubbed,
      inlineUnistylesStyle({
        width: resolvePillWidth({ isScrubbed, isActive }),
        height: isScrubbed ? SCRUBBED_PILL_HEIGHT : RESTING_PILL_HEIGHT,
      }),
    ],
    [isActive, isScrubbed],
  );
  return (
    <View style={styles.slot}>
      <View style={pillStyle} testID={`chat-outline-tick-${seq}`} />
      {isScrubbed ? (
        <View style={styles.preview} pointerEvents="none" testID="chat-outline-preview">
          <Text style={styles.previewText} numberOfLines={2}>
            {preview}
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const ACCESSIBILITY_ACTIONS = [{ name: "increment" as const }, { name: "decrement" as const }];

const PREVIEW_LINE_HEIGHT_RATIO = 1.4;
const PREVIEW_LINES = 2;

function previewLineHeight(fontSize: number): number {
  return Math.round(fontSize * PREVIEW_LINE_HEIGHT_RATIO);
}

function previewHeight(fontSize: number, verticalPadding: number): number {
  return previewLineHeight(fontSize) * PREVIEW_LINES + verticalPadding * 2;
}

const styles = StyleSheet.create((theme) => ({
  // The rail stays mounted at every width. A phone is exactly where scrolling a long
  // transcript hurts most, so this is not a wide-layout-only affordance.
  rail: {
    position: "absolute",
    left: CHAT_OUTLINE_RAIL_OFFSET,
    top: "10%",
    bottom: "10%",
    width: RAIL_WIDTH,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  // The slots tile the whole rail — `flexGrow` as well as `flexShrink` — so the band a
  // touch lands in is exactly the band `resolvePromptIndexAtOffset` computes. Without the
  // growth a short conversation would draw its ticks bunched in the middle while the scrub
  // still divided the full height, and touching a tick would jump somewhere else.
  slot: {
    width: RAIL_WIDTH,
    flexBasis: SLOT_HEIGHT,
    flexGrow: 1,
    flexShrink: 1,
    alignItems: "flex-start",
    justifyContent: "center",
    paddingLeft: theme.spacing[1],
  },
  pill: {
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.borderAccent,
  },
  pillActive: {
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  pillScrubbed: {
    backgroundColor: theme.colors.foreground,
  },
  // Sized from the rendered text rather than a fixed box: the appearance setting scales
  // `fontSize.xs` (12 at the default interface size, 24 at the largest), and a fixed height
  // would clip the second preview line exactly where large text matters most.
  preview: {
    position: "absolute",
    left: RAIL_WIDTH,
    top: "50%",
    marginTop: -previewHeight(theme.fontSize.xs, theme.spacing[2]) / 2,
    width: PREVIEW_WIDTH,
    height: previewHeight(theme.fontSize.xs, theme.spacing[2]),
    justifyContent: "center",
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    ...theme.shadow.md,
  },
  previewText: {
    fontSize: theme.fontSize.xs,
    lineHeight: previewLineHeight(theme.fontSize.xs),
    color: theme.colors.foreground,
  },
}));
