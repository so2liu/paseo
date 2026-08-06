const WEB_TOUCH_DIRECTION_THRESHOLD_PX = 1;

export type WebHistoryInputKind = "keyboard" | "pointer" | "touch" | "wheel";

export type WebHistoryPaginationCommand = "none" | "disarm" | "rearm";

export interface WebHistoryInputState {
  activeKind: WebHistoryInputKind | null;
  activeKeyboardKey: string | null;
  paginationArmed: boolean;
  paginationConsumed: boolean;
  touchStartClientY: number | null;
  multiTouchBlocked: boolean;
}

export interface WebHistoryInputTransition {
  state: WebHistoryInputState;
  paginationCommand: WebHistoryPaginationCommand;
}

export interface WebTouchMoveTransition extends WebHistoryInputTransition {
  direction: "none" | "toward-history" | "toward-newer";
}

export interface WebTouchEndTransition extends WebHistoryInputTransition {
  shouldSettle: boolean;
}

export interface WebKeyboardTransition extends WebHistoryInputTransition {
  ignored: boolean;
}

export interface WebWheelTransition extends WebHistoryInputTransition {
  direction: "none" | "toward-history" | "toward-newer";
  shouldSettle: boolean;
}

export function createWebHistoryInputState(): WebHistoryInputState {
  return {
    activeKind: null,
    activeKeyboardKey: null,
    paginationArmed: false,
    paginationConsumed: false,
    touchStartClientY: null,
    multiTouchBlocked: false,
  };
}

function resetActiveInput(state: WebHistoryInputState): WebHistoryInputState {
  return {
    ...state,
    activeKind: null,
    activeKeyboardKey: null,
    paginationArmed: false,
    paginationConsumed: false,
    touchStartClientY: null,
  };
}

export function disarmWebHistoryInput(
  state: WebHistoryInputState,
  kind?: WebHistoryInputKind,
): WebHistoryInputTransition {
  if (kind !== undefined && state.activeKind !== kind) {
    return { state, paginationCommand: "none" };
  }
  return {
    state: resetActiveInput(state),
    paginationCommand: "disarm",
  };
}

export function beginWebHistoryInput(
  state: WebHistoryInputState,
  input: {
    kind: WebHistoryInputKind;
    armPagination: boolean;
    forceNew?: boolean;
    isLoadingOlderHistory: boolean;
  },
): WebHistoryInputTransition {
  let nextState = input.forceNew ? resetActiveInput(state) : state;
  let paginationCommand: WebHistoryPaginationCommand = input.forceNew ? "disarm" : "none";
  if (nextState.activeKind !== input.kind) {
    nextState = {
      ...resetActiveInput(nextState),
      activeKind: input.kind,
    };
  }
  if (
    input.armPagination &&
    !nextState.paginationArmed &&
    !nextState.paginationConsumed &&
    !input.isLoadingOlderHistory
  ) {
    nextState = { ...nextState, paginationArmed: true };
    paginationCommand = "rearm";
  }
  return { state: nextState, paginationCommand };
}

export function consumeWebHistoryPagination(state: WebHistoryInputState): WebHistoryInputState {
  return { ...state, paginationConsumed: true };
}

export function reverseWebHistoryInput(state: WebHistoryInputState): WebHistoryInputTransition {
  return {
    state: {
      ...state,
      paginationArmed: state.paginationConsumed,
    },
    paginationCommand: "disarm",
  };
}

export function startWebTouchInput(
  state: WebHistoryInputState,
  clientYs: readonly number[],
  isLoadingOlderHistory: boolean,
): WebHistoryInputTransition {
  if (clientYs.length !== 1) {
    return {
      state: resetActiveInput({ ...state, multiTouchBlocked: true }),
      paginationCommand: "disarm",
    };
  }
  if (state.multiTouchBlocked) {
    return { state, paginationCommand: "none" };
  }
  const started = beginWebHistoryInput(state, {
    kind: "touch",
    armPagination: false,
    forceNew: true,
    isLoadingOlderHistory,
  });
  return {
    ...started,
    state: { ...started.state, touchStartClientY: clientYs[0] ?? null },
  };
}

export function moveWebTouchInput(
  state: WebHistoryInputState,
  clientYs: readonly number[],
  isLoadingOlderHistory: boolean,
): WebTouchMoveTransition {
  if (state.multiTouchBlocked || clientYs.length !== 1) {
    if (clientYs.length !== 1) {
      return {
        state: resetActiveInput({ ...state, multiTouchBlocked: true }),
        paginationCommand: "disarm",
        direction: "none",
      };
    }
    return { state, paginationCommand: "none", direction: "none" };
  }
  const clientY = clientYs[0];
  const touchStartClientY = state.touchStartClientY;
  if (clientY === undefined || touchStartClientY === null) {
    return { state, paginationCommand: "none", direction: "none" };
  }
  if (clientY > touchStartClientY + WEB_TOUCH_DIRECTION_THRESHOLD_PX) {
    const armed = beginWebHistoryInput(state, {
      kind: "touch",
      armPagination: true,
      isLoadingOlderHistory,
    });
    return { ...armed, direction: "toward-history" };
  }
  if (clientY < touchStartClientY - WEB_TOUCH_DIRECTION_THRESHOLD_PX) {
    return { ...reverseWebHistoryInput(state), direction: "toward-newer" };
  }
  return { state, paginationCommand: "none", direction: "none" };
}

export function endWebTouchInput(
  state: WebHistoryInputState,
  remainingTouchCount: number,
): WebTouchEndTransition {
  if (state.multiTouchBlocked || remainingTouchCount > 0) {
    return {
      state: resetActiveInput({
        ...state,
        multiTouchBlocked: remainingTouchCount > 0,
      }),
      paginationCommand: "disarm",
      shouldSettle: false,
    };
  }
  return {
    state: { ...state, touchStartClientY: null },
    paginationCommand: "none",
    shouldSettle: true,
  };
}

export function cancelWebTouchInput(state: WebHistoryInputState): WebHistoryInputTransition {
  return {
    state: resetActiveInput({ ...state, multiTouchBlocked: false }),
    paginationCommand: "disarm",
  };
}

export function beginWebKeyboardInput(
  state: WebHistoryInputState,
  key: string,
  isLoadingOlderHistory: boolean,
): WebKeyboardTransition {
  if (state.activeKind === "keyboard" && state.activeKeyboardKey !== key) {
    return { state, paginationCommand: "none", ignored: true };
  }
  const started = beginWebHistoryInput(state, {
    kind: "keyboard",
    armPagination: true,
    isLoadingOlderHistory,
  });
  return {
    ...started,
    state: { ...started.state, activeKeyboardKey: key },
    ignored: false,
  };
}

export function endWebKeyboardInput(
  state: WebHistoryInputState,
  key: string,
): WebKeyboardTransition {
  if (state.activeKeyboardKey !== key) {
    return { state, paginationCommand: "none", ignored: true };
  }
  return { ...disarmWebHistoryInput(state, "keyboard"), ignored: false };
}

export function updateWebWheelInput(
  state: WebHistoryInputState,
  input: { deltaY: number; isLoadingOlderHistory: boolean; isZoomGesture: boolean },
): WebWheelTransition {
  if (input.isZoomGesture || input.deltaY === 0) {
    return {
      state,
      paginationCommand: "none",
      direction: "none",
      shouldSettle: false,
    };
  }
  if (input.deltaY < 0) {
    const armed = beginWebHistoryInput(state, {
      kind: "wheel",
      armPagination: true,
      isLoadingOlderHistory: input.isLoadingOlderHistory,
    });
    return {
      ...armed,
      direction: "toward-history",
      shouldSettle: true,
    };
  }
  if (state.activeKind === "wheel") {
    return {
      ...reverseWebHistoryInput(state),
      direction: "toward-newer",
      shouldSettle: true,
    };
  }
  return {
    ...disarmWebHistoryInput(state),
    direction: "toward-newer",
    shouldSettle: false,
  };
}

export function shouldHandleWebHistoryKey(input: {
  key: string;
  shiftKey: boolean;
  defaultPrevented: boolean;
  isInteractiveTarget: boolean;
}): boolean {
  if (input.defaultPrevented || input.isInteractiveTarget) {
    return false;
  }
  return (
    input.key === "ArrowUp" ||
    input.key === "PageUp" ||
    input.key === "Home" ||
    (input.key === " " && input.shiftKey)
  );
}
