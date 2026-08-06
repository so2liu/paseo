import { describe, expect, it } from "vitest";
import {
  beginWebKeyboardInput,
  consumeWebHistoryPagination,
  createWebHistoryInputState,
  disarmWebHistoryInput,
  endWebKeyboardInput,
  endWebTouchInput,
  moveWebTouchInput,
  shouldHandleWebHistoryKey,
  startWebTouchInput,
  updateWebWheelInput,
} from "./web-history-input";

describe("web history input", () => {
  it("keeps one wheel pagination budget across frames and direction reversals", () => {
    let state = createWebHistoryInputState();
    const firstUp = updateWebWheelInput(state, {
      deltaY: -1,
      isLoadingOlderHistory: false,
      isZoomGesture: false,
    });
    expect(firstUp.paginationCommand).toBe("rearm");
    state = consumeWebHistoryPagination(firstUp.state);

    const reverse = updateWebWheelInput(state, {
      deltaY: 1,
      isLoadingOlderHistory: false,
      isZoomGesture: false,
    });
    expect(reverse).toMatchObject({
      paginationCommand: "disarm",
      direction: "toward-newer",
      shouldSettle: true,
      state: { activeKind: "wheel", paginationConsumed: true },
    });

    const sameBurstUp = updateWebWheelInput(reverse.state, {
      deltaY: -1,
      isLoadingOlderHistory: false,
      isZoomGesture: false,
    });
    expect(sameBurstUp.paginationCommand).toBe("none");

    const settled = disarmWebHistoryInput(sameBurstUp.state, "wheel");
    const nextBurstUp = updateWebWheelInput(settled.state, {
      deltaY: -1,
      isLoadingOlderHistory: false,
      isZoomGesture: false,
    });
    expect(nextBurstUp.paginationCommand).toBe("rearm");
  });

  it("ignores browser zoom wheel events", () => {
    const state = createWebHistoryInputState();
    expect(
      updateWebWheelInput(state, {
        deltaY: -10,
        isLoadingOlderHistory: false,
        isZoomGesture: true,
      }),
    ).toEqual({
      state,
      paginationCommand: "none",
      direction: "none",
      shouldSettle: false,
    });
  });

  it("accumulates slow touch movement from the gesture start", () => {
    let transition = startWebTouchInput(createWebHistoryInputState(), [100], false);
    transition = moveWebTouchInput(transition.state, [100.6], false);
    expect(transition.paginationCommand).toBe("none");
    transition = moveWebTouchInput(transition.state, [101.2], false);
    expect(transition).toMatchObject({
      paginationCommand: "rearm",
      direction: "toward-history",
    });
  });

  it("rearms an unused reversed touch but preserves a consumed touch budget", () => {
    let transition = startWebTouchInput(createWebHistoryInputState(), [100], false);
    transition = moveWebTouchInput(transition.state, [120], false);
    transition = moveWebTouchInput(transition.state, [90], false);
    expect(transition).toMatchObject({
      paginationCommand: "disarm",
      state: { paginationArmed: false, paginationConsumed: false },
    });
    transition = moveWebTouchInput(transition.state, [140], false);
    expect(transition.paginationCommand).toBe("rearm");

    const consumed = consumeWebHistoryPagination(transition.state);
    const consumedReverse = moveWebTouchInput(consumed, [90], false);
    const consumedUp = moveWebTouchInput(consumedReverse.state, [140], false);
    expect(consumedUp.paginationCommand).toBe("none");
    expect(consumedUp.state.paginationConsumed).toBe(true);
  });

  it("keeps touch input active through inertia until settling", () => {
    let transition = startWebTouchInput(createWebHistoryInputState(), [100], false);
    transition = moveWebTouchInput(transition.state, [120], false);
    const ended = endWebTouchInput(consumeWebHistoryPagination(transition.state), 0);
    expect(ended).toMatchObject({
      shouldSettle: true,
      paginationCommand: "none",
      state: { activeKind: "touch", paginationConsumed: true, touchStartClientY: null },
    });
  });

  it("blocks multi-touch until every finger leaves", () => {
    let transition = startWebTouchInput(createWebHistoryInputState(), [100], false);
    transition = moveWebTouchInput(transition.state, [120], false);
    const consumed = consumeWebHistoryPagination(transition.state);

    const secondFinger = startWebTouchInput(consumed, [120, 200], false);
    expect(secondFinger).toMatchObject({
      paginationCommand: "disarm",
      state: { activeKind: null, multiTouchBlocked: true },
    });
    const oneFingerRemains = endWebTouchInput(secondFinger.state, 1);
    const blockedMove = moveWebTouchInput(oneFingerRemains.state, [160], false);
    expect(blockedMove).toMatchObject({
      paginationCommand: "none",
      direction: "none",
      state: { multiTouchBlocked: true },
    });

    const allFingersLeft = endWebTouchInput(blockedMove.state, 0);
    const freshTouch = startWebTouchInput(allFingersLeft.state, [100], false);
    const freshMove = moveWebTouchInput(freshTouch.state, [120], false);
    expect(freshMove.paginationCommand).toBe("rearm");
  });

  it("ends keyboard pagination only when the initiating key is released", () => {
    let transition = beginWebKeyboardInput(createWebHistoryInputState(), "PageUp", false);
    let state = consumeWebHistoryPagination(transition.state);

    const unrelatedUp = endWebKeyboardInput(state, "Shift");
    expect(unrelatedUp.ignored).toBe(true);
    transition = beginWebKeyboardInput(unrelatedUp.state, "PageUp", false);
    expect(transition.paginationCommand).toBe("none");

    const matchingUp = endWebKeyboardInput(transition.state, "PageUp");
    expect(matchingUp).toMatchObject({
      ignored: false,
      paginationCommand: "disarm",
      state: { activeKind: null },
    });
    state = matchingUp.state;
    expect(beginWebKeyboardInput(state, "PageUp", false).paginationCommand).toBe("rearm");
  });

  it("ignores navigation keys owned by interactive controls", () => {
    expect(
      shouldHandleWebHistoryKey({
        key: "PageUp",
        shiftKey: false,
        defaultPrevented: false,
        isInteractiveTarget: true,
      }),
    ).toBe(false);
    expect(
      shouldHandleWebHistoryKey({
        key: "PageUp",
        shiftKey: false,
        defaultPrevented: true,
        isInteractiveTarget: false,
      }),
    ).toBe(false);
    expect(
      shouldHandleWebHistoryKey({
        key: "PageUp",
        shiftKey: false,
        defaultPrevented: false,
        isInteractiveTarget: false,
      }),
    ).toBe(true);
  });
});
