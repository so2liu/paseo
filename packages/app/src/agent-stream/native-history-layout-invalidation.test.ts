import { describe, expect, it } from "vitest";
import { createNativeHistoryLayoutInvalidationController } from "./native-history-layout-invalidation";

describe("native history layout invalidation", () => {
  it("records the initial width without invalidating rows that already mounted at that width", () => {
    const controller = createNativeHistoryLayoutInvalidationController();

    controller.observeViewportWidth(0, 512);

    expect(controller.settle()).toBeNull();
  });

  it("coalesces continuous sidebar resizing into one invalidation at the settled width", () => {
    const controller = createNativeHistoryLayoutInvalidationController();
    controller.observeViewportWidth(0, 512);

    controller.observeViewportWidth(512, 640);
    controller.observeViewportWidth(640, 768);
    controller.observeViewportWidth(768, 1024);

    expect(controller.settle()).toBe(1024);
    expect(controller.settle()).toBeNull();
  });

  it("skips invalidation when a transient resize returns to the committed width", () => {
    const controller = createNativeHistoryLayoutInvalidationController();
    controller.observeViewportWidth(0, 512);

    controller.observeViewportWidth(512, 768);
    controller.observeViewportWidth(768, 512);

    expect(controller.settle()).toBeNull();
  });
});
