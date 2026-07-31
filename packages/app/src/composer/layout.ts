export function usesCompactNativeComposerLayout(
  nativePlatform: boolean,
  compactFormFactor: boolean,
): boolean {
  return nativePlatform && compactFormFactor;
}
