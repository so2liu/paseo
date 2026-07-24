import { isNative } from "@/constants/platform";

/**
 * The native app is a lightweight companion: conversations, host state,
 * messaging, notifications, and on-demand file links. Desktop and browser
 * keep the full workspace surface.
 */
export const isMobileLiteMode = isNative;

/** Four visible text updates per second keeps streaming readable without token-level churn. */
export const MOBILE_LITE_STREAM_FLUSH_DELAY_MS = 250;
