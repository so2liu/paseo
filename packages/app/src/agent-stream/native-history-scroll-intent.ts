const NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX = 1;
const NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX = 4;

export interface NativeHistoryTouchState {
  startPageY: number | null;
  multiTouchBlocked: boolean;
}

export interface NativeHistoryTouchTransition {
  state: NativeHistoryTouchState;
  shouldArmPagination: boolean;
  shouldDisarmPagination: boolean;
  shouldResetPaginationBudget: boolean;
}

export function createNativeHistoryTouchState(): NativeHistoryTouchState {
  return { startPageY: null, multiTouchBlocked: false };
}

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

export function startNativeHistoryTouch(
  state: NativeHistoryTouchState,
  input: { touchCount: number; pageY: number },
): NativeHistoryTouchTransition {
  if (input.touchCount !== 1) {
    return {
      state: { startPageY: null, multiTouchBlocked: true },
      shouldArmPagination: false,
      shouldDisarmPagination: true,
      shouldResetPaginationBudget: false,
    };
  }
  if (state.multiTouchBlocked) {
    return {
      state,
      shouldArmPagination: false,
      shouldDisarmPagination: false,
      shouldResetPaginationBudget: false,
    };
  }
  return {
    state: { ...state, startPageY: input.pageY },
    shouldArmPagination: false,
    shouldDisarmPagination: false,
    shouldResetPaginationBudget: true,
  };
}

export function moveNativeHistoryTouch(
  state: NativeHistoryTouchState,
  input: { touchCount: number; pageY: number; paginationBudgetConsumed: boolean },
): NativeHistoryTouchTransition {
  if (state.multiTouchBlocked || input.touchCount !== 1) {
    return {
      state: input.touchCount === 1 ? state : { startPageY: null, multiTouchBlocked: true },
      shouldArmPagination: false,
      shouldDisarmPagination: input.touchCount !== 1,
      shouldResetPaginationBudget: false,
    };
  }
  return {
    state,
    shouldArmPagination:
      !input.paginationBudgetConsumed &&
      state.startPageY !== null &&
      hasNativeInvertedTouchMovedTowardHistoryStart(state.startPageY, input.pageY),
    shouldDisarmPagination: false,
    shouldResetPaginationBudget: false,
  };
}

export function endNativeHistoryTouch(
  state: NativeHistoryTouchState,
  input: { remainingTouchCount: number; isUserScrollActive: boolean },
): NativeHistoryTouchTransition {
  const wasMultiTouch = state.multiTouchBlocked || input.remainingTouchCount > 0;
  return {
    state: {
      startPageY: null,
      multiTouchBlocked:
        wasMultiTouch && (input.isUserScrollActive || input.remainingTouchCount > 0),
    },
    shouldArmPagination: false,
    shouldDisarmPagination: wasMultiTouch || !input.isUserScrollActive,
    shouldResetPaginationBudget: false,
  };
}

export function settleNativeHistoryTouch(): NativeHistoryTouchState {
  return createNativeHistoryTouchState();
}
