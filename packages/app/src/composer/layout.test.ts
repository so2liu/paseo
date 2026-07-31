import { describe, expect, it } from "vitest";
import { usesCompactNativeComposerLayout } from "@/composer/layout";

describe("usesCompactNativeComposerLayout", () => {
  it("uses the compact bar only on compact native screens", () => {
    expect(usesCompactNativeComposerLayout(true, true)).toBe(true);
    expect(usesCompactNativeComposerLayout(true, false)).toBe(false);
    expect(usesCompactNativeComposerLayout(false, true)).toBe(false);
    expect(usesCompactNativeComposerLayout(false, false)).toBe(false);
  });
});
