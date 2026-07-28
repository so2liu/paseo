import { promises as fs } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import { fetchTimelineFromState, type AgentTimelineState } from "./agent-timeline-store.js";
import type {
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
} from "./agent-timeline-store-types.js";

/**
 * Durable timeline rows, one append-only JSONL file per agent.
 *
 * The daemon used to hold committed timeline rows in memory only, so reading an
 * agent's history after its runtime was collected meant resuming the provider
 * session and replaying its whole transcript first — seconds of latency for a
 * pure read. Rows are immutable and seq-ordered, so an append-only log is the
 * exact shape of the data: every write is one `appendFile`, and no row is ever
 * rewritten.
 *
 * File layout:
 *
 *     {"v":1,"agentId":"...","epoch":"..."}      <- header, always line 1
 *     {"seq":1,"timestamp":"...","item":{...}}
 *     {"seq":2,"timestamp":"...","item":{...}}
 */

const TIMELINE_FILE_VERSION = 1;

interface TimelineFileHeader {
  v: number;
  agentId: string;
  epoch: string;
}

interface LoadedTimeline {
  epoch: string;
  rows: AgentTimelineRow[];
}

export interface JsonlAgentTimelineStoreOptions {
  /** Directory holding the per-agent JSONL files, e.g. `$PASEO_HOME/timelines`. */
  directory: string;
  logger: pino.Logger;
  /**
   * How many agents' parsed rows to keep in memory. Reads for a live agent are
   * answered from `AgentManager`'s in-memory store, so this cache only backs
   * history browsing of collected agents.
   */
  cacheSize?: number;
}

const DEFAULT_CACHE_SIZE = 16;

function isMissingFileError(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

function parseHeader(line: string): TimelineFileHeader | null {
  try {
    const parsed = JSON.parse(line) as Partial<TimelineFileHeader>;
    if (typeof parsed?.epoch !== "string" || typeof parsed.agentId !== "string") {
      return null;
    }
    return { v: parsed.v ?? TIMELINE_FILE_VERSION, agentId: parsed.agentId, epoch: parsed.epoch };
  } catch {
    return null;
  }
}

function parseRow(line: string): AgentTimelineRow | null {
  try {
    const parsed = JSON.parse(line) as Partial<AgentTimelineRow>;
    if (typeof parsed?.seq !== "number" || typeof parsed.timestamp !== "string" || !parsed.item) {
      return null;
    }
    return { seq: parsed.seq, timestamp: parsed.timestamp, item: parsed.item };
  } catch {
    return null;
  }
}

/** Rows handed out to callers are copies so nobody can mutate the cache in place. */
function cloneRow(row: AgentTimelineRow): AgentTimelineRow {
  return { ...row };
}

function serializeRow(row: AgentTimelineRow): string {
  return `${JSON.stringify({ seq: row.seq, timestamp: row.timestamp, item: row.item })}\n`;
}

export class JsonlAgentTimelineStore implements AgentTimelineStore {
  private readonly directory: string;
  private readonly logger: pino.Logger;
  private readonly cacheSize: number;
  /** Parsed timelines, most-recently-used last. */
  private readonly cache = new Map<string, LoadedTimeline>();
  /** Per-agent write chain. Serializes appends so lines never interleave. */
  private readonly writeChains = new Map<string, Promise<void>>();

  constructor(options: JsonlAgentTimelineStoreOptions) {
    this.directory = options.directory;
    this.logger = options.logger;
    this.cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
  }

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    const loaded = await this.load(agentId);
    const lastSeq = loaded.rows.at(-1)?.seq ?? 0;
    const row: AgentTimelineRow = {
      seq: lastSeq + 1,
      timestamp: options?.timestamp ?? new Date().toISOString(),
      item,
    };
    await this.bulkInsert(agentId, [row]);
    return row;
  }

  async bulkInsert(agentId: string, rows: readonly AgentTimelineRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }
    const loaded = await this.load(agentId);
    // Replaying an already-committed seq would duplicate rows on disk. This
    // happens when provider hydration re-streams history the cache already has.
    const lastSeq = loaded.rows.at(-1)?.seq ?? 0;
    const fresh = rows.filter((row) => row.seq > lastSeq);
    if (fresh.length === 0) {
      return;
    }
    loaded.rows.push(...fresh.map(cloneRow));
    await this.enqueueWrite(agentId, async () => {
      await fs.appendFile(this.filePath(agentId), fresh.map(serializeRow).join(""), "utf8");
    });
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const loaded = await this.load(agentId);
    const state: AgentTimelineState = {
      epoch: loaded.epoch,
      rows: loaded.rows,
      nextSeq: (loaded.rows.at(-1)?.seq ?? 0) + 1,
    };
    return fetchTimelineFromState(state, options);
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    const loaded = await this.load(agentId);
    return loaded.rows.at(-1)?.seq ?? 0;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    const loaded = await this.load(agentId);
    return loaded.rows.map(cloneRow);
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    const loaded = await this.load(agentId);
    return loaded.rows.at(-1)?.item ?? null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    const { rows } = await this.load(agentId);
    const chunks: string[] = [];
    for (let i = rows.length - 1; i >= 0; i -= 1) {
      const item = rows[i].item;
      if (item.type !== "assistant_message") {
        if (chunks.length > 0) {
          break;
        }
        continue;
      }
      chunks.push(item.text);
    }
    return chunks.length === 0 ? null : chunks.toReversed().join("");
  }

  async getEpoch(agentId: string): Promise<string | null> {
    const header = await this.readHeader(agentId);
    return header?.epoch ?? null;
  }

  async ensureEpoch(agentId: string, epoch: string): Promise<void> {
    if (await this.readHeader(agentId)) {
      return;
    }
    await this.enqueueWrite(agentId, async () => {
      // Re-check inside the chain: a concurrent ensureEpoch may have won.
      if (await this.readHeaderFromDisk(agentId)) {
        return;
      }
      const header: TimelineFileHeader = { v: TIMELINE_FILE_VERSION, agentId, epoch };
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(this.filePath(agentId), `${JSON.stringify(header)}\n`, "utf8");
    });
    this.cache.set(agentId, { epoch, rows: [] });
    this.evictOverflow();
  }

  async hasCommitted(agentId: string): Promise<boolean> {
    const loaded = await this.load(agentId);
    return loaded.rows.length > 0;
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.cache.delete(agentId);
    await this.enqueueWrite(agentId, async () => {
      await fs.rm(this.filePath(agentId), { force: true });
    });
  }

  async flush(): Promise<void> {
    await Promise.allSettled(this.writeChains.values());
  }

  private filePath(agentId: string): string {
    // Agent IDs are UUIDs, but a traversal-shaped id must never escape the
    // timelines directory.
    return path.join(this.directory, `${path.basename(agentId)}.jsonl`);
  }

  /**
   * Serializes work per agent. Every disk mutation goes through here so appends,
   * header creation, and deletion cannot race each other for the same file.
   */
  private enqueueWrite(agentId: string, work: () => Promise<void>): Promise<void> {
    const previous = this.writeChains.get(agentId) ?? Promise.resolve();
    const next = previous.then(work).catch((error: unknown) => {
      this.logger.error({ err: error, agentId }, "Failed to write durable agent timeline");
    });
    this.writeChains.set(agentId, next);
    void next.finally(() => {
      if (this.writeChains.get(agentId) === next) {
        this.writeChains.delete(agentId);
      }
    });
    return next;
  }

  private async load(agentId: string): Promise<LoadedTimeline> {
    const cached = this.cache.get(agentId);
    if (cached) {
      // Refresh recency.
      this.cache.delete(agentId);
      this.cache.set(agentId, cached);
      return cached;
    }

    // Rows appended while the agent was cached are written by a queued task. A
    // cold read must not observe the file before those land.
    await this.writeChains.get(agentId);

    const loaded = await this.readFromDisk(agentId);
    // A concurrent load may have populated the cache while this one was
    // reading; that entry may already carry appended rows, so keep it.
    const raced = this.cache.get(agentId);
    if (raced) {
      return raced;
    }
    this.cache.set(agentId, loaded);
    this.evictOverflow();
    return loaded;
  }

  private async readFromDisk(agentId: string): Promise<LoadedTimeline> {
    let contents: string;
    try {
      contents = await fs.readFile(this.filePath(agentId), "utf8");
    } catch (error) {
      if (!isMissingFileError(error)) {
        this.logger.error({ err: error, agentId }, "Failed to read durable agent timeline");
      }
      return { epoch: "", rows: [] };
    }

    const lines = contents.split("\n");
    const header = lines.length > 0 ? parseHeader(lines[0]) : null;
    if (!header) {
      this.logger.warn({ agentId }, "Durable agent timeline has no readable header; ignoring file");
      return { epoch: "", rows: [] };
    }

    const rows: AgentTimelineRow[] = [];
    let skipped = 0;
    for (let i = 1; i < lines.length; i += 1) {
      const line = lines[i];
      if (!line) {
        continue;
      }
      const row = parseRow(line);
      // A torn final line from a crash mid-append is expected; drop it rather
      // than failing the whole read.
      if (!row) {
        skipped += 1;
        continue;
      }
      rows.push(row);
    }
    if (skipped > 0) {
      this.logger.warn({ agentId, skipped }, "Skipped unreadable durable timeline rows");
    }

    return { epoch: header.epoch, rows };
  }

  private async readHeader(agentId: string): Promise<TimelineFileHeader | null> {
    const cached = this.cache.get(agentId);
    if (cached?.epoch) {
      return { v: TIMELINE_FILE_VERSION, agentId, epoch: cached.epoch };
    }
    const loaded = await this.load(agentId);
    return loaded.epoch ? { v: TIMELINE_FILE_VERSION, agentId, epoch: loaded.epoch } : null;
  }

  private async readHeaderFromDisk(agentId: string): Promise<TimelineFileHeader | null> {
    try {
      const contents = await fs.readFile(this.filePath(agentId), "utf8");
      return parseHeader(contents.split("\n")[0] ?? "");
    } catch (error) {
      if (!isMissingFileError(error)) {
        throw error;
      }
      return null;
    }
  }

  private evictOverflow(): void {
    while (this.cache.size > this.cacheSize) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        return;
      }
      this.cache.delete(oldest.value);
    }
  }
}
