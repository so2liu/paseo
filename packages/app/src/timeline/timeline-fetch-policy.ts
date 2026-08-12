// Count is projected timeline items, not delta chunks. Fetch responses never return
// tool lifecycle deltas; `sourceSeqRanges` maps projected items back to source seqs.
export const TIMELINE_FETCH_PAGE_SIZE = 40;

/**
 * The first page after opening an agent. Incremental paging stays at
 * `TIMELINE_FETCH_PAGE_SIZE`, but the opening fetch decides how much of the conversation a
 * reader sees without scrolling — and with execution collapse a turn costs only a few visible
 * rows, so a bigger opening page buys several whole turns rather than more tool calls. The
 * daemon already serves 200 by default for tail fetches, so this asks for nothing new; it is
 * deliberately bounded rather than `0` (unbounded), which would push one huge frame over the
 * relay for very long conversations.
 */
export const TIMELINE_INITIAL_TAIL_PAGE_SIZE = 200;
