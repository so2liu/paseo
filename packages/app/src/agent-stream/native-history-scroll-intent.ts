const NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX = 1;
const NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX = 4;

export interface NativeHistoryTouchState {
  startPageY: number | null;
  peakPageY: number | null;
  offsetDirectionAnchorY: number | null;
  offsetPeakY: number | null;
  activeTouchCount: number;
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
    peakPageY: null,
    offsetDirectionAnchorY: null,
    offsetPeakY: null,
    activeTouchCount: 0,
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

export function moveNativeHistoryOffset(
  state: NativeHistoryTouchState,
  input: { gestureStartOffsetY: number; currentOffsetY: number },
): NativeHistoryTouchTransition {
  if (state.multiTouchBlocked) {
    return transitionNativeHistoryDirection(state, "none");
  }
  const directionAnchorY = state.offsetDirectionAnchorY ?? input.gestureStartOffsetY;
  const peakY = state.offsetPeakY ?? directionAnchorY;
  if (input.currentOffsetY < peakY - NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX) {
    return transitionNativeHistoryDirection(
      {
        ...state,
        offsetDirectionAnchorY: input.currentOffsetY,
        offsetPeakY: input.currentOffsetY,
      },
      "toward-newer",
    );
  }
  const nextState = {
    ...state,
    offsetDirectionAnchorY: directionAnchorY,
    offsetPeakY: Math.max(peakY, input.currentOffsetY),
  };
  const direction =
    input.currentOffsetY > directionAnchorY + NATIVE_HISTORY_SCROLL_INTENT_THRESHOLD_PX
      ? "toward-history"
      : "none";
  return transitionNativeHistoryDirection(nextState, direction);
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
      state: {
        ...state,
        startPageY: null,
        peakPageY: null,
        activeTouchCount: input.touchCount,
        multiTouchBlocked: true,
      },
      shouldArmPagination: false,
      shouldDisarmPagination: true,
      shouldResetPaginationBudget: false,
    };
  }
  if (state.multiTouchBlocked) {
    return {
      state: { ...state, activeTouchCount: input.touchCount },
      shouldArmPagination: false,
      shouldDisarmPagination: false,
      shouldResetPaginationBudget: false,
    };
  }
  return {
    state: {
      ...state,
      startPageY: input.pageY,
      peakPageY: input.pageY,
      offsetDirectionAnchorY: null,
      offsetPeakY: null,
      activeTouchCount: input.touchCount,
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
        input.touchCount === 1
          ? { ...state, activeTouchCount: input.touchCount }
          : {
              ...state,
              startPageY: null,
              peakPageY: null,
              activeTouchCount: input.touchCount,
              multiTouchBlocked: true,
            },
      shouldArmPagination: false,
      shouldDisarmPagination: input.touchCount !== 1,
      shouldResetPaginationBudget: false,
    };
  }
  if (state.startPageY === null) {
    return transitionNativeHistoryDirection(state, "none");
  }
  const peakPageY = state.peakPageY ?? state.startPageY;
  if (input.pageY < peakPageY - NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX) {
    return transitionNativeHistoryDirection(
      {
        ...state,
        startPageY: input.pageY,
        peakPageY: input.pageY,
        activeTouchCount: input.touchCount,
      },
      "toward-newer",
    );
  }
  const nextState = {
    ...state,
    peakPageY: Math.max(peakPageY, input.pageY),
    activeTouchCount: input.touchCount,
  };
  const direction =
    input.pageY > state.startPageY + NATIVE_INVERTED_HISTORY_TOUCH_INTENT_THRESHOLD_PX
      ? "toward-history"
      : "none";
  return transitionNativeHistoryDirection(nextState, direction);
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
      peakPageY: null,
      activeTouchCount: input.remainingTouchCount,
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

export function cancelNativeHistoryTouch(
  state: NativeHistoryTouchState,
  isUserScrollActive: boolean,
): NativeHistoryTouchTransition {
  return {
    state: isUserScrollActive
      ? {
          ...state,
          startPageY: null,
          peakPageY: null,
          activeTouchCount: 0,
          multiTouchBlocked: true,
        }
      : createNativeHistoryTouchState(),
    shouldArmPagination: false,
    shouldDisarmPagination: true,
    shouldResetPaginationBudget: false,
  };
}

export function shouldSettleNativeHistoryTouchOnScrollEnd(
  state: NativeHistoryTouchState,
  input: { settlingGestureGeneration: number; currentGestureGeneration: number },
): boolean {
  return (
    state.activeTouchCount === 0 &&
    input.settlingGestureGeneration === input.currentGestureGeneration
  );
}
