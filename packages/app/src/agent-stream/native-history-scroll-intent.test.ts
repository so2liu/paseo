import { describe, expect, it } from "vitest";
import {
  consumeNativeHistoryPagination,
  createNativeHistoryTouchState,
  endNativeHistoryTouch,
  hasNativeGestureMovedTowardHistoryStart,
  hasNativeInvertedTouchMovedTowardHistoryStart,
  moveNativeHistoryTouch,
  moveNativeHistoryOffset,
  settleNativeHistoryTouch,
  shouldSettleNativeHistoryTouchOnScrollEnd,
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
      }).shouldArmPagination,
    ).toBe(false);

    expect(settleNativeHistoryTouch()).toEqual({
      startPageY: null,
      activeTouchCount: 0,
      multiTouchBlocked: false,
      paginationArmed: false,
      paginationConsumed: false,
    });
  });

  it("disarms unused reverse movement without restoring a consumed budget", () => {
    let transition = startNativeHistoryTouch(createNativeHistoryTouchState(), {
      touchCount: 1,
      pageY: 200,
    });
    transition = moveNativeHistoryTouch(transition.state, { touchCount: 1, pageY: 220 });
    expect(transition).toMatchObject({
      shouldArmPagination: true,
      state: { paginationArmed: true, paginationConsumed: false },
    });

    transition = moveNativeHistoryTouch(transition.state, { touchCount: 1, pageY: 180 });
    expect(transition).toMatchObject({
      shouldDisarmPagination: true,
      state: { paginationArmed: false, paginationConsumed: false },
    });
    transition = moveNativeHistoryTouch(transition.state, { touchCount: 1, pageY: 220 });
    expect(transition.shouldArmPagination).toBe(true);

    const consumed = consumeNativeHistoryPagination(transition.state);
    const consumedReverse = moveNativeHistoryTouch(consumed, { touchCount: 1, pageY: 180 });
    expect(consumedReverse).toMatchObject({
      shouldDisarmPagination: true,
      state: { paginationArmed: true, paginationConsumed: true },
    });
    expect(
      moveNativeHistoryTouch(consumedReverse.state, { touchCount: 1, pageY: 220 })
        .shouldArmPagination,
    ).toBe(false);
  });

  it("applies the same reversal budget to native offset movement", () => {
    let transition = moveNativeHistoryOffset(createNativeHistoryTouchState(), {
      gestureStartOffsetY: 40,
      currentOffsetY: 60,
    });
    expect(transition.shouldArmPagination).toBe(true);
    transition = moveNativeHistoryOffset(transition.state, {
      gestureStartOffsetY: 40,
      currentOffsetY: 20,
    });
    expect(transition).toMatchObject({
      shouldDisarmPagination: true,
      state: { paginationArmed: false, paginationConsumed: false },
    });
  });

  it("does not let an old scroll settlement discard a newer active touch", () => {
    const activeTouch = startNativeHistoryTouch(createNativeHistoryTouchState(), {
      touchCount: 1,
      pageY: 200,
    });
    expect(shouldSettleNativeHistoryTouchOnScrollEnd(activeTouch.state)).toBe(false);

    const released = endNativeHistoryTouch(activeTouch.state, {
      remainingTouchCount: 0,
      isUserScrollActive: true,
    });
    expect(shouldSettleNativeHistoryTouchOnScrollEnd(released.state)).toBe(true);
  });
});
