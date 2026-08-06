import { describe, expect, it } from "vitest";
import {
  createHistoryStartPaginationState,
  disarmHistoryStartPagination,
  evaluateHistoryStartPagination,
  rearmHistoryStartPagination,
} from "./history-start-pagination";

const visibleHistoryStart = {
  distanceFromHistoryStart: 0,
  hasOlderHistory: true,
  isLoadingOlderHistory: false,
  isReady: true,
  progressKey: "epoch-1:20",
};

describe("history start pagination", () => {
  it("does not load older pages from stale initial geometry without user intent", () => {
    const initial = createHistoryStartPaginationState();
    const evaluated = evaluateHistoryStartPagination(initial, visibleHistoryStart);
    const nextCursor = evaluateHistoryStartPagination(evaluated.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });

    expect([evaluated.shouldLoad, nextCursor.shouldLoad]).toEqual([false, false]);
  });

  it("loads at most one page for each explicit user gesture", () => {
    const initial = rearmHistoryStartPagination(createHistoryStartPaginationState());
    const first = evaluateHistoryStartPagination(initial, visibleHistoryStart);
    const duplicate = evaluateHistoryStartPagination(first.state, visibleHistoryStart);
    const nextPage = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      progressKey: "epoch-1:10",
    });
    const nextGesture = evaluateHistoryStartPagination(
      rearmHistoryStartPagination(nextPage.state),
      { ...visibleHistoryStart, progressKey: "epoch-1:10" },
    );

    expect([
      first.shouldLoad,
      duplicate.shouldLoad,
      nextPage.shouldLoad,
      nextGesture.shouldLoad,
    ]).toEqual([true, false, false, true]);
  });

  it("clears consumed intent after the user leaves the history edge", () => {
    const first = evaluateHistoryStartPagination(
      rearmHistoryStartPagination(createHistoryStartPaginationState()),
      visibleHistoryStart,
    );
    const away = evaluateHistoryStartPagination(first.state, {
      ...visibleHistoryStart,
      distanceFromHistoryStart: 200,
    });
    const returned = evaluateHistoryStartPagination(away.state, visibleHistoryStart);

    expect([first.shouldLoad, away.shouldLoad, returned.shouldLoad]).toEqual([true, false, false]);
    expect(returned.state.userInitiated).toBe(false);
  });

  it("re-arms the same cursor when the user makes another upward edge gesture", () => {
    const first = evaluateHistoryStartPagination(
      rearmHistoryStartPagination(createHistoryStartPaginationState()),
      visibleHistoryStart,
    );
    const retried = evaluateHistoryStartPagination(
      rearmHistoryStartPagination(first.state),
      visibleHistoryStart,
    );

    expect([first.shouldLoad, retried.shouldLoad]).toEqual([true, true]);
  });

  it("clears an unused gesture when scrolling ends away from the history edge", () => {
    const armed = rearmHistoryStartPagination(createHistoryStartPaginationState());

    expect(disarmHistoryStartPagination(armed)).toEqual({
      requestedProgressKey: null,
      userInitiated: false,
    });
  });

  it("waits while history loading is unavailable or already active", () => {
    const state = rearmHistoryStartPagination(createHistoryStartPaginationState());

    expect([
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, isReady: false }).shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, hasOlderHistory: false })
        .shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, isLoadingOlderHistory: true })
        .shouldLoad,
      evaluateHistoryStartPagination(state, { ...visibleHistoryStart, progressKey: null })
        .shouldLoad,
    ]).toEqual([false, false, false, false]);
  });
});
