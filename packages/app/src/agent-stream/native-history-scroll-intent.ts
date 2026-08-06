const NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX = 1;
const NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX = 4;

export interface NativeHistoryTouchState {
  startPageY: number | null;
  multiTouchBlocked: boolean;
  paginationArmed: boolean;
  paginationConsumed: boolean;
}

export interface NativeHistoryTouchTransition {
  state: NativeHistoryTouchState;
  shouldArmPagination: boolean;
  shouldDisarmPagination: boolean;
  shouldResetPaginationBudget: boolean;
}

type NativeHistoryDirection = "none" | "toward-history" | "toward-newer";

export function createNativeHistoryTouchState(): NativeHistoryTouchState {
  return {
    startPageY: null,
    multiTouchBlocked: false,
    paginationArmed: false,
    paginationConsumed: false,
  };
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

function transitionNativeHistoryDirection(
  state: NativeHistoryTouchState,
  direction: NativeHistoryDirection,
): NativeHistoryTouchTransition {
  if (direction === "toward-history") {
    const shouldArmPagination = !state.paginationArmed && !state.paginationConsumed;
    return {
      state: shouldArmPagination ? { ...state, paginationArmed: true } : state,
      shouldArmPagination,
      shouldDisarmPagination: false,
      shouldResetPaginationBudget: false,
    };
  }
  if (direction === "toward-newer") {
    return {
      state: { ...state, paginationArmed: state.paginationConsumed },
      shouldArmPagination: false,
      shouldDisarmPagination: true,
      shouldResetPaginationBudget: false,
    };
  }
  return {
    state,
    shouldArmPagination: false,
    shouldDisarmPagination: false,
    shouldResetPaginationBudget: false,
  };
}

function resolveNativeHistoryDirection(delta: number, threshold: number): NativeHistoryDirection {
  if (delta > threshold) return "toward-history";
  if (delta < -threshold) return "toward-newer";
  return "none";
}

export function moveNativeHistoryOffset(
  state: NativeHistoryTouchState,
  input: { gestureStartOffsetY: number; currentOffsetY: number },
): NativeHistoryTouchTransition {
  if (state.multiTouchBlocked) {
    return transitionNativeHistoryDirection(state, "none");
  }
  const delta = input.currentOffsetY - input.gestureStartOffsetY;
  const direction = resolveNativeHistoryDirection(delta, NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX);
  return transitionNativeHistoryDirection(state, direction);
}

export function consumeNativeHistoryPagination(
  state: NativeHistoryTouchState,
): NativeHistoryTouchState {
  return { ...state, paginationArmed: true, paginationConsumed: true };
}

export function startNativeHistoryTouch(
  state: NativeHistoryTouchState,
  input: { touchCount: number; pageY: number },
): NativeHistoryTouchTransition {
  if (input.touchCount !== 1) {
    return {
      state: { ...state, startPageY: null, multiTouchBlocked: true },
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
    state: {
      ...state,
      startPageY: input.pageY,
      paginationArmed: false,
      paginationConsumed: false,
    },
    shouldArmPagination: false,
    shouldDisarmPagination: false,
    shouldResetPaginationBudget: true,
  };
}

export function moveNativeHistoryTouch(
  state: NativeHistoryTouchState,
  input: { touchCount: number; pageY: number },
): NativeHistoryTouchTransition {
  if (state.multiTouchBlocked || input.touchCount !== 1) {
    return {
      state:
        input.touchCount === 1 ? state : { ...state, startPageY: null, multiTouchBlocked: true },
      shouldArmPagination: false,
      shouldDisarmPagination: input.touchCount !== 1,
      shouldResetPaginationBudget: false,
    };
  }
  if (state.startPageY === null) {
    return transitionNativeHistoryDirection(state, "none");
  }
  const delta = input.pageY - state.startPageY;
  const direction = resolveNativeHistoryDirection(
    delta,
    NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX,
  );
  return transitionNativeHistoryDirection(state, direction);
}

export function endNativeHistoryTouch(
  state: NativeHistoryTouchState,
  input: { remainingTouchCount: number; isUserScrollActive: boolean },
): NativeHistoryTouchTransition {
  const wasMultiTouch = state.multiTouchBlocked || input.remainingTouchCount > 0;
  return {
    state: {
      ...state,
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
