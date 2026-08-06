import { describe, expect, it } from "vitest";
import { hasNativeGestureMovedTowardHistoryStart } from "./native-history-scroll-intent";

describe("native history scroll intent", () => {
  it("detects cumulative slow movement from the gesture start", () => {
    expect(hasNativeGestureMovedTowardHistoryStart(40, 40.6)).toBe(false);
    expect(hasNativeGestureMovedTowardHistoryStart(40, 41.2)).toBe(true);
  });

  it("does not arm for movement toward newer messages", () => {
    expect(hasNativeGestureMovedTowardHistoryStart(40, 20)).toBe(false);
  });
});
