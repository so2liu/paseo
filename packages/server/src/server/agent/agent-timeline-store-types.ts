import type { AgentTimelineItem } from "./agent-sdk-types.js";

export interface AgentTimelineRow {
  seq: number;
  timestamp: string;
  item: AgentTimelineItem;
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
   * Record whether the committed rows are the whole conversation.
   *
   * Provider backfill streams rows one at a time, so a crash part-way leaves a
   * real but truncated prefix. Without this the next start would mistake that
   * prefix for the entire history and never ask the provider again.
   */
  setBackfillComplete(agentId: string, complete: boolean): Promise<void>;
  /** Wait for every queued write to reach disk. */
  flush(): Promise<void>;
}
