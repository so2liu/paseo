import { MAX_CONTENT_WIDTH } from "@/constants/layout";
import { isNative } from "@/constants/platform";

// Native ticks are a touch scrubber and web ticks are a hover column, so the two rails are
// not the same size. Both are declared here rather than in their own stylesheets: the
// transcript's gutter is derived from them below, and a rail that widened on its own would
// silently start overlapping text again.
export const CHAT_OUTLINE_RAIL_WIDTH = isNative ? 28 : 36;
export const CHAT_OUTLINE_RAIL_OFFSET = isNative ? 4 : 8;
const RAIL_CLEARANCE = isNative ? 4 : 5;

/**
 * The transcript has to keep this much of its left edge free for the rail, which floats
 * above it. A wide panel does that on its own: the content is capped at `MAX_CONTENT_WIDTH`
 * and centred, so the leftover margin swallows the rail. Below that the margin runs out and
 * the rail would sit on top of assistant text, eating taps and text selection — which is
 * why upstream hid it there. We keep it mounted and pad the transcript instead.
 */
export const CHAT_OUTLINE_RAIL_GUTTER =
  CHAT_OUTLINE_RAIL_OFFSET + CHAT_OUTLINE_RAIL_WIDTH + RAIL_CLEARANCE;

/**
 * The panel width at which the centred content stops leaving room on its own. Above it the
 * transcript needs no padding and the layout matches upstream exactly — on web this works
 * out to upstream's own 918px threshold, which is where that number came from.
 */
export const CHAT_OUTLINE_NATURAL_GUTTER_WIDTH = MAX_CONTENT_WIDTH + CHAT_OUTLINE_RAIL_GUTTER * 2;
