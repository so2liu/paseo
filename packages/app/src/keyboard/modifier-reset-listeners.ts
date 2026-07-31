interface ModifierResetListenerTargets {
  windowTarget: EventTarget;
  documentTarget: EventTarget;
}

/**
 * Clear held-modifier UI when the browser can no longer be trusted to deliver
 * the matching keyup. macOS dictation and IMEs can take over a modifier press
 * while leaving Electron focused, then write text without ever returning that
 * keyup to the renderer.
 */
export function installModifierResetListeners(
  targets: ModifierResetListenerTargets,
  resetModifiers: () => void,
): () => void {
  const reset = () => {
    resetModifiers();
  };
  const capturedWindowEvents = ["beforeinput", "compositionstart", "input"] as const;
  const captureOptions = { capture: true } as const;

  targets.windowTarget.addEventListener("blur", reset);
  targets.documentTarget.addEventListener("visibilitychange", reset);
  for (const eventName of capturedWindowEvents) {
    targets.windowTarget.addEventListener(eventName, reset, captureOptions);
  }

  return () => {
    targets.windowTarget.removeEventListener("blur", reset);
    targets.documentTarget.removeEventListener("visibilitychange", reset);
    for (const eventName of capturedWindowEvents) {
      targets.windowTarget.removeEventListener(eventName, reset, captureOptions);
    }
  };
}
