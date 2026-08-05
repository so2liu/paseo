import { describe, expect, it } from "vitest";
import { createNativeHistoryLayoutInvalidationController } from "./native-history-layout-invalidation";

describe("native history layout invalidation", () => {
  it("records the initial width without invalidating rows that already mounted at that width", () => {
    const controller = createNativeHistoryLayoutInvalidationController();

    expect(controller.observeViewportWidth(0, 512)).toBe(false);

    expect(controller.settle()).toBe(false);
  });

  it("coalesces continuous sidebar resizing into one invalidation at the settled width", () => {
    const controller = createNativeHistoryLayoutInvalidationController();
    controller.observeViewportWidth(0, 512);

    controller.observeViewportWidth(512, 640);
    controller.observeViewportWidth(640, 768);
    controller.observeViewportWidth(768, 1024);

    expect(controller.settle()).toBe(true);
    expect(controller.settle()).toBe(false);
  });

  it("skips invalidation when a transient resize returns to the committed width", () => {
    const controller = createNativeHistoryLayoutInvalidationController();
    controller.observeViewportWidth(0, 512);

    controller.observeViewportWidth(512, 768);
    controller.observeViewportWidth(768, 512);

    expect(controller.settle()).toBe(false);
  });

  it("invalidates retained rows when a zero-width panel becomes visible again", () => {
    const controller = createNativeHistoryLayoutInvalidationController();
    controller.observeViewportWidth(0, 512);

    controller.observeViewportWidth(512, 0);
    expect(controller.settle()).toBe(false);
    controller.observeViewportWidth(0, 512);

    expect(controller.settle()).toBe(true);
  });

  it("invalidates rows when a retained panel starts hidden before its initial reveal", () => {
    const controller = createNativeHistoryLayoutInvalidationController();

    expect(controller.observeViewportWidth(0, 0)).toBe(false);
    expect(controller.observeViewportWidth(0, 512)).toBe(true);

    expect(controller.settle()).toBe(true);
  });

  it("invalidates once at the final width after a retained panel is revealed and resized", () => {
    const controller = createNativeHistoryLayoutInvalidationController();
    controller.observeViewportWidth(0, 512);
    controller.observeViewportWidth(512, 0);
    controller.observeViewportWidth(0, 640);
    controller.observeViewportWidth(640, 768);

    expect(controller.settle()).toBe(true);
    expect(controller.settle()).toBe(false);
  });
});
