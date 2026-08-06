export const HISTORY_START_THRESHOLD_PX = 96;

export interface HistoryStartPaginationState {
  requestedProgressKey: string | null;
  // Initial layout measurements can briefly look like the history edge before
  // the latest tail has been measured. Only a real upward gesture may arm
  // backward pagination, otherwise a long conversation drains every old page.
  userInitiated: boolean;
}

export function createHistoryStartPaginationState(): HistoryStartPaginationState {
  return { requestedProgressKey: null, userInitiated: false };
}

export function rearmHistoryStartPagination(
  state: HistoryStartPaginationState,
): HistoryStartPaginationState {
  return { ...state, requestedProgressKey: null, userInitiated: true };
}

export function evaluateHistoryStartPagination(
  state: HistoryStartPaginationState,
  input: {
    distanceFromHistoryStart: number;
    hasOlderHistory: boolean;
    isLoadingOlderHistory: boolean;
    isReady: boolean;
    progressKey: string | null;
  },
): { state: HistoryStartPaginationState; shouldLoad: boolean } {
  if (input.distanceFromHistoryStart > HISTORY_START_THRESHOLD_PX) {
    return {
      state: { ...state, requestedProgressKey: null },
      shouldLoad: false,
    };
  }
  if (
    !state.userInitiated ||
    !input.isReady ||
    !input.hasOlderHistory ||
    input.isLoadingOlderHistory ||
    input.progressKey === null
  ) {
    return { state, shouldLoad: false };
  }
  if (state.requestedProgressKey === input.progressKey) {
    return { state, shouldLoad: false };
  }
  return {
    state: { ...state, requestedProgressKey: input.progressKey },
    shouldLoad: true,
  };
}
