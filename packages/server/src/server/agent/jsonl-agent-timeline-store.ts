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
  /**
   * False when the log exists but could not be read. An unreadable log is not
   * an absent one: treating it as empty would restart sequence numbering and
   * append rows that collide with the ones already committed on disk.
   */
  readable: boolean;
  /**
   * UTF-8 size of the log this was parsed from, used to bound the cache. String
   * length would undercount by up to 3x on non-Latin text, which is exactly the
   * content most likely to fill the budget.
   */
  bytes: number;
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
  /**
   * Total serialized bytes to keep parsed. Conversation length varies by orders
   * of magnitude, so an agent count alone does not bound memory: a single tool
   * result may reach 64 KiB, and browsing a handful of long conversations would
   * otherwise pin hundreds of megabytes.
   */
  cacheBytes?: number;
}

const DEFAULT_CACHE_SIZE = 16;
const DEFAULT_CACHE_BYTES = 32 * 1024 * 1024;

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
  private readonly cacheBytes: number;
  /** Parsed timelines, most-recently-used last. */
  private readonly cache = new Map<string, LoadedTimeline>();
  /** Per-agent write chain. Serializes appends so lines never interleave. */
  private readonly writeChains = new Map<string, Promise<void>>();
  /** Per-agent read in progress, so concurrent callers share one disk read. */
  private readonly inFlightLoads = new Map<string, Promise<LoadedTimeline>>();
  /**
   * Bumped whenever a log is invalidated. A read that started before the bump
   * describes a file that no longer exists, so its result must not be cached.
   */
  private readonly cacheGenerations = new Map<string, number>();

  constructor(options: JsonlAgentTimelineStoreOptions) {
    this.directory = options.directory;
    this.logger = options.logger;
    this.cacheSize = options.cacheSize ?? DEFAULT_CACHE_SIZE;
    this.cacheBytes = options.cacheBytes ?? DEFAULT_CACHE_BYTES;
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
    if (!loaded.readable) {
      throw new Error(
        `Refusing to append to an unreadable timeline log for agent '${agentId}': ` +
          "its committed sequence numbers are unknown",
      );
    }
    if (!loaded.epoch) {
      // Appending here would create a file whose first line is a row. Such a
      // log is rejected wholesale on the next start, so the rows would be lost
      // anyway — and silently. `ensureEpoch` owns log creation; until it has
      // run there is no log to append to.
      throw new Error(
        `Refusing to append to agent '${agentId}' timeline log before its header exists`,
      );
    }
    // Replaying an already-committed seq would duplicate rows on disk. This
    // happens when provider hydration re-streams history the cache already has.
    const lastSeq = loaded.rows.at(-1)?.seq ?? 0;
    const fresh = rows.filter((row) => row.seq > lastSeq);
    if (fresh.length === 0) {
      return;
    }
    const payload = fresh.map(serializeRow).join("");
    loaded.rows.push(...fresh.map(cloneRow));
    // Keep the size estimate current as the log grows, or a long-running agent
    // would stay counted at whatever it weighed when first read. Streaming
    // agents stay cache-resident, so this is the only place their growth is
    // ever observed — the budget has to be enforced here too.
    loaded.bytes += Buffer.byteLength(payload, "utf8");
    this.evictOverflow();
    await this.enqueueWrite(agentId, async () => {
      await fs.appendFile(this.filePath(agentId), payload, "utf8");
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
    const loaded = await this.load(agentId);
    if (loaded.epoch) {
      return;
    }
    if (!loaded.readable) {
      // The log is there but unreadable. Overwriting it would destroy committed
      // history, and adopting this epoch would restart sequence numbering.
      return;
    }
    let adopted = false;
    await this.enqueueWrite(agentId, async () => {
      // Re-check inside the chain: a concurrent ensureEpoch may have won.
      if (await this.readHeaderFromDisk(agentId)) {
        return;
      }
      const header: TimelineFileHeader = { v: TIMELINE_FILE_VERSION, agentId, epoch };
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(this.filePath(agentId), `${JSON.stringify(header)}\n`, "utf8");
      adopted = true;
    });
    if (!adopted) {
      // Someone else's header is on disk. Caching this epoch with no rows would
      // make the next append reuse sequence numbers that are already committed.
      this.invalidate(agentId);
      return;
    }
    // The file was just rewritten, so discard any read still in flight against
    // the old one before installing the fresh state.
    this.invalidate(agentId);
    this.cache.set(agentId, { epoch, rows: [], readable: true, bytes: 0 });
    this.evictOverflow();
  }

  async hasCommitted(agentId: string): Promise<boolean> {
    const loaded = await this.load(agentId);
    // An unreadable log cannot answer a history read, so the caller falls back
    // to loading the agent instead of being handed a silently empty timeline.
    return loaded.readable && loaded.rows.length > 0;
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.invalidate(agentId);
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

    // Appends are fire-and-forget, so a burst of rows arriving while this agent
    // is out of the LRU would otherwise each reparse the whole log. One read
    // per agent at a time; everyone else waits for it.
    const inFlight = this.inFlightLoads.get(agentId);
    if (inFlight) {
      return await inFlight;
    }

    const load = this.loadUncached(agentId);
    this.inFlightLoads.set(agentId, load);
    try {
      return await load;
    } finally {
      this.inFlightLoads.delete(agentId);
    }
  }

  private async loadUncached(agentId: string): Promise<LoadedTimeline> {
    const generation = this.cacheGenerations.get(agentId) ?? 0;
    // Rows appended while the agent was cached are written by a queued task. A
    // cold read must not observe the file before those land.
    await this.writeChains.get(agentId);

    const loaded = await this.readFromDisk(agentId);
    // Never cache a failed read: a transient error would otherwise stick around
    // as a fake empty timeline, and recovery would wait for LRU eviction.
    if (!loaded.readable) {
      return loaded;
    }
    // The log was invalidated while this read was in flight, so what came back
    // describes a file that is already gone. Caching it would resurrect the old
    // epoch and rows, and the next ensureEpoch would skip header creation.
    if ((this.cacheGenerations.get(agentId) ?? 0) !== generation) {
      return loaded;
    }
    this.cache.set(agentId, loaded);
    this.evictOverflow();
    return loaded;
  }

  /**
   * Drop cached state for an agent and make any in-flight read discard itself.
   * Every path that removes or replaces a log on disk must go through here.
   */
  private invalidate(agentId: string): void {
    this.cacheGenerations.set(agentId, (this.cacheGenerations.get(agentId) ?? 0) + 1);
    this.cache.delete(agentId);
  }

  private async readFromDisk(agentId: string): Promise<LoadedTimeline> {
    let contents: string;
    try {
      contents = await fs.readFile(this.filePath(agentId), "utf8");
    } catch (error) {
      if (isMissingFileError(error)) {
        return { epoch: "", rows: [], readable: true, bytes: 0 };
      }
      this.logger.error({ err: error, agentId }, "Failed to read durable agent timeline");
      return { epoch: "", rows: [], readable: false, bytes: 0 };
    }

    const lines = contents.split("\n");
    const header = lines.length > 0 ? parseHeader(lines[0]) : null;
    if (!header) {
      this.logger.warn({ agentId }, "Durable agent timeline has no readable header; ignoring file");
      // Readable, just not usable: the content is known-bad, so ensureEpoch is
      // free to rewrite the file from scratch. That is distinct from an I/O
      // error, where the real content is unknown and must not be clobbered.
      return { epoch: "", rows: [], readable: true, bytes: 0 };
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

    return {
      epoch: header.epoch,
      rows,
      readable: true,
      bytes: Buffer.byteLength(contents, "utf8"),
    };
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
    let bytes = 0;
    for (const entry of this.cache.values()) {
      bytes += entry.bytes;
    }
    // Keep the newest entry even when it alone exceeds the budget: the caller
    // is using it right now, and dropping it would force an immediate re-read.
    while (this.cache.size > 1 && (this.cache.size > this.cacheSize || bytes > this.cacheBytes)) {
      const oldest = this.cache.keys().next();
      if (oldest.done) {
        return;
      }
      bytes -= this.cache.get(oldest.value)?.bytes ?? 0;
      this.cache.delete(oldest.value);
    }
  }
}
