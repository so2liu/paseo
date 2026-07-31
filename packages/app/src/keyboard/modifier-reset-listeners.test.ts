import { describe, expect, it, vi } from "vitest";
import { installModifierResetListeners } from "./modifier-reset-listeners";

describe("installModifierResetListeners", () => {
  it("resets when the window loses focus or the document visibility changes", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const resetModifiers = vi.fn();

    installModifierResetListeners({ windowTarget, documentTarget }, resetModifiers);

    windowTarget.dispatchEvent(new Event("blur"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(resetModifiers).toHaveBeenCalledTimes(2);
  });

  it("resets when dictation or an IME writes text without returning modifier keyup", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const resetModifiers = vi.fn();

    installModifierResetListeners({ windowTarget, documentTarget }, resetModifiers);

    windowTarget.dispatchEvent(new Event("compositionstart"));
    windowTarget.dispatchEvent(new Event("beforeinput"));
    windowTarget.dispatchEvent(new Event("input"));

    expect(resetModifiers).toHaveBeenCalledTimes(3);
  });

  it("removes every listener during cleanup", () => {
    const windowTarget = new EventTarget();
    const documentTarget = new EventTarget();
    const resetModifiers = vi.fn();
    const cleanup = installModifierResetListeners({ windowTarget, documentTarget }, resetModifiers);

    cleanup();
    windowTarget.dispatchEvent(new Event("blur"));
    windowTarget.dispatchEvent(new Event("compositionstart"));
    windowTarget.dispatchEvent(new Event("beforeinput"));
    windowTarget.dispatchEvent(new Event("input"));
    documentTarget.dispatchEvent(new Event("visibilitychange"));

    expect(resetModifiers).not.toHaveBeenCalled();
  });
});
