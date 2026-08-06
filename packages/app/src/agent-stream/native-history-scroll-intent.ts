const NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX = 1;
const NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX = 4;

export function hasNativeGestureMovedTowardHistoryStart(
  gestureStartOffsetY: number,
  currentOffsetY: number,
): boolean {
  return currentOffsetY > gestureStartOffsetY + NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX;
}

export function hasNativeInvertedTouchMovedTowardHistoryStart(
  touchStartPageY: number,
  currentPageY: number,
): boolean {
  return currentPageY > touchStartPageY + NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX;
}
