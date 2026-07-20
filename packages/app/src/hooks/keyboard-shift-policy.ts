export const DEFAULT_IOS_KEYBOARD_INSET_MIN_HEIGHT = 120;

export function resolveKeyboardShift(input: {
  rawKeyboardHeight: number;
  keyboardProgress: number;
  bottomInset: number;
  isIos: boolean;
  iosMinHeight: number;
}): number {
  "worklet";

  if (!(input.rawKeyboardHeight > 0)) {
    return 0;
  }

  // iOS can report a small accessory/prediction bar height during touch focus.
  // Treat that as non-keyboard so layouts don't "bounce" while interacting.
  if (input.isIos && input.rawKeyboardHeight < input.iosMinHeight) {
    return 0;
  }

  // Android can retain the previous keyboard height after the keyboard closes,
  // so progress remains the visibility signal there. On iOS, native hide events
  // explicitly report height 0; requiring progress as well makes transient zero
  // progress samples drop the composer while the keyboard is still visible.
  if (!input.isIos && !(input.keyboardProgress > 0)) {
    return 0;
  }

  return Math.max(0, input.rawKeyboardHeight - input.bottomInset);
}
