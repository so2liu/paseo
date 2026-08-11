import type { AgentTimelineItem } from "./agent-sdk-types.js";

export interface AgentTimelineRow {
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
  readonly providerMessageId?: string;
}

export interface AgentTimelineCursor {
  epoch: string;
  seq: number;
}

export type AgentTimelineFetchDirection = "tail" | "before" | "after";

export interface AgentTimelineFetchOptions {
  direction?: AgentTimelineFetchDirection;
  cursor?: AgentTimelineCursor;
  /**
   * Number of canonical rows to return.
   * - undefined: store default
   * - 0: all rows in the selected window
   */
  limit?: number;
}

export interface AgentTimelineWindow {
  minSeq: number;
  maxSeq: number;
  nextSeq: number;
}

export interface AgentTimelineFetchResult {
  epoch: string;
  direction: AgentTimelineFetchDirection;
  reset: boolean;
  staleCursor: boolean;
  gap: boolean;
  window: AgentTimelineWindow;
  hasOlder: boolean;
  hasNewer: boolean;
  rows: AgentTimelineRow[];
}

export interface AgentTimelineStore {
  appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow>;
  fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult>;
  getLatestCommittedSeq(agentId: string): Promise<number>;
  getCommittedRows(agentId: string): Promise<AgentTimelineRow[]>;
  getLastItem(agentId: string): Promise<AgentTimelineItem | null>;
  getLastAssistantMessage(agentId: string): Promise<string | null>;
  deleteAgent(agentId: string): Promise<void>;
  bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void>;
  /**
   * The durable store owns the timeline epoch whenever one is configured, so a
   * daemon restart resumes the epoch clients already hold cursors against
   * instead of minting a new one and forcing a full reset.
   *
   * Returns null when nothing has been committed for the agent yet.
   */
  getEpoch(agentId: string): Promise<string | null>;
  /** Adopt `epoch` for an agent that has no committed timeline yet. */
  ensureEpoch(agentId: string, epoch: string): Promise<void>;
  /** True when the agent has a committed timeline that can be served without a provider process. */
  hasCommitted(agentId: string): Promise<boolean>;
  /**
   * Start a provider backfill: drop every committed row and mark the timeline
   * incomplete, keeping the epoch.
   *
   * Replay assigns sequence numbers from 1, so it must never land on top of
   * rows that are already there. Those can be a truncated prefix from an
   * earlier failed backfill, or live rows the agent committed afterwards —
   * either way the replayed and retained rows would claim the same slots and
   * the result would be an interleaved timeline marked authoritative. The
   * provider transcript is a superset of what is dropped here.
   */
  beginBackfill(agentId: string): Promise<void>;
  /**
   * Mark the committed rows as the whole conversation. Until this lands, a
   * crash part-way leaves a real but truncated prefix that the next start must
   * not mistake for the entire history.
   */
  completeBackfill(agentId: string): Promise<void>;
  /** Wait for every queued write to reach disk. */
  flush(): Promise<void>;
  updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void>;
}
