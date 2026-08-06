const NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX = 1;

export function hasNativeGestureMovedTowardHistoryStart(
  gestureStartOffsetY: number,
  currentOffsetY: number,
): boolean {
  return currentOffsetY > gestureStartOffsetY + NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX;
}
