import { describe, expect, it } from "vitest";
import {
  createNativeHistoryTouchState,
  endNativeHistoryTouch,
  hasNativeGestureMovedTowardHistoryStart,
  hasNativeInvertedTouchMovedTowardHistoryStart,
  moveNativeHistoryTouch,
  settleNativeHistoryTouch,
  startNativeHistoryTouch,
} from "./native-history-scroll-intent";

describe("native history scroll intent", () => {
  it("detects cumulative slow movement from the gesture start", () => {
    expect(hasNativeGestureMovedTowardHistoryStart(40, 40.6)).toBe(false);
    expect(hasNativeGestureMovedTowardHistoryStart(40, 41.2)).toBe(true);
  });

  it("does not arm for movement toward newer messages", () => {
    expect(hasNativeGestureMovedTowardHistoryStart(40, 20)).toBe(false);
  });

  it("detects a history-directed touch even when the inverted list offset is clamped", () => {
    expect(hasNativeInvertedTouchMovedTowardHistoryStart(200, 203)).toBe(false);
    expect(hasNativeInvertedTouchMovedTowardHistoryStart(200, 205)).toBe(true);
  });

  it("does not arm for a touch toward newer messages", () => {
    expect(hasNativeInvertedTouchMovedTowardHistoryStart(200, 180)).toBe(false);
  });

  it("blocks multi-touch through the end of the native scroll gesture", () => {
    let transition = startNativeHistoryTouch(createNativeHistoryTouchState(), {
      touchCount: 1,
      pageY: 200,
    });
    expect(transition.shouldResetPaginationBudget).toBe(true);

    transition = startNativeHistoryTouch(transition.state, { touchCount: 2, pageY: 200 });
    expect(transition).toMatchObject({
      shouldDisarmPagination: true,
      shouldResetPaginationBudget: false,
      state: { multiTouchBlocked: true },
    });

    transition = moveNativeHistoryTouch(transition.state, {
      touchCount: 1,
      pageY: 220,
      paginationBudgetConsumed: false,
    });
    expect(transition.shouldArmPagination).toBe(false);

    transition = endNativeHistoryTouch(transition.state, {
      remainingTouchCount: 0,
      isUserScrollActive: true,
    });
    expect(transition.state.multiTouchBlocked).toBe(true);
    expect(
      moveNativeHistoryTouch(transition.state, {
        touchCount: 1,
        pageY: 240,
        paginationBudgetConsumed: false,
      }).shouldArmPagination,
    ).toBe(false);

    expect(settleNativeHistoryTouch()).toEqual({
      startPageY: null,
      multiTouchBlocked: false,
    });
  });
});
