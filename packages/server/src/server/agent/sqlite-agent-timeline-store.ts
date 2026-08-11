import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import type {
  AgentTimelineFetchDirection,
  AgentTimelineFetchOptions,
  AgentTimelineFetchResult,
  AgentTimelineRow,
  AgentTimelineStore,
  AgentTimelineWindow,
} from "./agent-timeline-store-types.js";

/**
 * Durable timeline rows in SQLite.
 *
 * The daemon used to hold committed rows in memory only, so reading an agent's
 * history after its runtime was collected meant resuming the provider session
 * and replaying its whole transcript first — seconds of latency for a pure read.
 *
 * Paging, atomic appends, crash-safe writes, and concurrent reader isolation are
 * exactly what a database provides, so this store owns none of them itself. It
 * reads only the rows a request asks for, which keeps a long conversation from
 * being materialized to answer a bounded page.
 */

const DEFAULT_FETCH_LIMIT = 200;

interface TimelineRowRecord {
  seq: number;
  timestamp: string;
  item: string;
}

interface WindowRecord {
  minSeq: number | null;
  maxSeq: number | null;
}

/** The parts of a fetch result that every direction shares. */
interface PageBase {
  epoch: string;
  direction: AgentTimelineFetchDirection;
  reset: boolean;
  staleCursor: boolean;
  gap: boolean;
  window: AgentTimelineWindow;
}

interface NormalizedFetch {
  direction: AgentTimelineFetchDirection;
  /** null means "every row in the selected window". */
  limit: number | null;
  cursor: AgentTimelineFetchOptions["cursor"];
}

function normalizeFetch(options: AgentTimelineFetchOptions | undefined): NormalizedFetch {
  const requested = options?.limit;
  const limit = requested === undefined ? DEFAULT_FETCH_LIMIT : Math.max(0, Math.floor(requested));
  return {
    direction: options?.direction ?? "tail",
    limit: limit === 0 ? null : limit,
    cursor: options?.cursor,
  };
}

function decodeRow(record: TimelineRowRecord): AgentTimelineRow {
  return {
    seq: record.seq,
    timestamp: record.timestamp,
    item: JSON.parse(record.item) as AgentTimelineItem,
  };
}

export interface SqliteAgentTimelineStoreOptions {
  /** Database file, e.g. `$PASEO_HOME/timelines.db`. Use `:memory:` in tests. */
  file: string;
  logger: pino.Logger;
}

export class SqliteAgentTimelineStore implements AgentTimelineStore {
  private readonly db: DatabaseSync;
  private readonly logger: pino.Logger;
  private closed = false;

  constructor(options: SqliteAgentTimelineStoreOptions) {
    this.logger = options.logger;
    if (options.file !== ":memory:") {
      mkdirSync(path.dirname(options.file), { recursive: true });
    }
    this.db = new DatabaseSync(options.file);
    // WAL lets a reader page through history while a running agent appends.
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_timelines (
        agent_id TEXT PRIMARY KEY,
        epoch TEXT NOT NULL,
        -- A timeline starts complete: a brand-new agent has no earlier history
        -- to be missing. Only a provider backfill can leave a truncated prefix,
        -- and it clears this for the duration of the stream.
        backfill_complete INTEGER NOT NULL DEFAULT 1
      );
      CREATE TABLE IF NOT EXISTS agent_timeline_rows (
        agent_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        timestamp TEXT NOT NULL,
        item TEXT NOT NULL,
        PRIMARY KEY (agent_id, seq)
      ) WITHOUT ROWID;
    `);
    // Databases created before the column existed. Adding it is idempotent
    // because the statement fails once the column is present.
    try {
      this.db.exec(
        "ALTER TABLE agent_timelines ADD COLUMN backfill_complete INTEGER NOT NULL DEFAULT 1",
      );
    } catch {
      // Column already present.
    }
  }

  async appendCommitted(
    agentId: string,
    item: AgentTimelineItem,
    options?: { timestamp?: string },
  ): Promise<AgentTimelineRow> {
    const row: AgentTimelineRow = {
      seq: (await this.getLatestCommittedSeq(agentId)) + 1,
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
    if (this.readEpoch(agentId) === null) {
      // `ensureEpoch` owns timeline creation. Without it there is no epoch for
      // these rows to belong to, and clients could not address them by cursor.
      throw new Error(`Refusing to append to agent '${agentId}' timeline before its epoch exists`);
    }

    // One transaction: a crash mid-batch commits all of it or none of it, so a
    // partially written page can never be read back as a complete one.
    // `OR IGNORE` makes provider history replay idempotent — re-streamed rows
    // collide on (agent_id, seq) and are dropped rather than duplicated.
    const insert = this.db.prepare(
      "INSERT OR IGNORE INTO agent_timeline_rows (agent_id, seq, timestamp, item) VALUES (?, ?, ?, ?)",
    );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      for (const row of rows) {
        insert.run(agentId, row.seq, row.timestamp, JSON.stringify(row.item));
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.logger.error({ err: error, agentId }, "Failed to commit agent timeline rows");
      throw error;
    }
  }

  /**
   * Replace one already-committed row in place.
   *
   * Enrichment arrives after the fact — a tool call gets its result, a message
   * its final text — and rewrites a row the client already holds a cursor for.
   * The seq stays put so those cursors stay valid; only the payload changes.
   * A row that is not there yet is a no-op rather than an insert: `bulkInsert`
   * owns creation, and inserting here would resurrect a row a backfill dropped.
   */
  async updateCommittedRow(agentId: string, row: AgentTimelineRow): Promise<void> {
    this.db
      .prepare(
        "UPDATE agent_timeline_rows SET timestamp = ?, item = ? WHERE agent_id = ? AND seq = ?",
      )
      .run(row.timestamp, JSON.stringify(row.item), agentId, row.seq);
  }

  async fetchCommitted(
    agentId: string,
    options?: AgentTimelineFetchOptions,
  ): Promise<AgentTimelineFetchResult> {
    const { direction, limit, cursor } = normalizeFetch(options);
    const epoch = this.readEpoch(agentId) ?? "";
    const window = this.readWindow(agentId);
    const empty = window.maxSeq === 0;
    const base: PageBase = {
      epoch,
      direction,
      reset: false,
      staleCursor: false,
      gap: false,
      window,
    };

    const staleCursor = cursor !== undefined && cursor.epoch !== epoch;
    const gap =
      !staleCursor &&
      direction === "after" &&
      cursor !== undefined &&
      !empty &&
      cursor.seq < window.minSeq - 1;
    if (staleCursor || gap) {
      return this.resetPage(agentId, base, limit, { staleCursor, gap });
    }
    if (empty) {
      return { ...base, hasOlder: false, hasNewer: false, rows: [] };
    }

    if (direction === "after") {
      return this.pageAfter(agentId, base, cursor?.seq ?? 0, limit);
    }
    if (direction === "before") {
      return this.pageBefore(agentId, base, cursor?.seq ?? window.nextSeq, limit);
    }
    return this.pageTail(agentId, base, limit);
  }

  private pageAfter(
    agentId: string,
    base: PageBase,
    from: number,
    limit: number | null,
  ): AgentTimelineFetchResult {
    const rows = this.selectRows(agentId, {
      where: "seq > ?",
      params: [from],
      order: "ASC",
      limit,
    });
    const last = rows.at(-1);
    return {
      ...base,
      hasOlder: rows.length === 0 ? from >= base.window.minSeq : rows[0].seq > base.window.minSeq,
      hasNewer: last !== undefined && last.seq < base.window.maxSeq,
      rows,
    };
  }

  private pageBefore(
    agentId: string,
    base: PageBase,
    before: number,
    limit: number | null,
  ): AgentTimelineFetchResult {
    const rows = this.selectRows(agentId, {
      where: "seq < ?",
      params: [before],
      order: "DESC",
      limit,
    }).toReversed();
    return {
      ...base,
      hasOlder: rows.length > 0 && this.countRows(agentId, "seq < ?", [rows[0].seq]) > 0,
      hasNewer: this.countRows(agentId, "seq >= ?", [before]) > 0,
      rows,
    };
  }

  private pageTail(
    agentId: string,
    base: PageBase,
    limit: number | null,
  ): AgentTimelineFetchResult {
    const rows = this.selectRows(agentId, {
      where: null,
      params: [],
      order: "DESC",
      limit,
    }).toReversed();
    return {
      ...base,
      hasOlder: rows.length > 0 && rows[0].seq > base.window.minSeq,
      hasNewer: false,
      rows,
    };
  }

  async getLatestCommittedSeq(agentId: string): Promise<number> {
    return this.readWindow(agentId).maxSeq;
  }

  async getCommittedRows(agentId: string): Promise<AgentTimelineRow[]> {
    return this.selectRows(agentId, { where: null, params: [], order: "ASC", limit: null });
  }

  async getLastItem(agentId: string): Promise<AgentTimelineItem | null> {
    const rows = this.selectRows(agentId, {
      where: null,
      params: [],
      order: "DESC",
      limit: 1,
    });
    return rows[0]?.item ?? null;
  }

  async getLastAssistantMessage(agentId: string): Promise<string | null> {
    // Walk backwards over the trailing assistant run only. Claude streams a
    // message as several rows, so the answer is their concatenation.
    const boundary = this.db
      .prepare(
        `SELECT MAX(seq) AS seq FROM agent_timeline_rows
         WHERE agent_id = ? AND json_extract(item, '$.type') <> 'assistant_message'`,
      )
      .get(agentId) as { seq: number | null } | undefined;
    const after = boundary?.seq ?? 0;
    const rows = this.selectRows(agentId, {
      where: "seq > ? AND json_extract(item, '$.type') = 'assistant_message'",
      params: [after],
      order: "ASC",
      limit: null,
    });
    if (rows.length === 0) {
      return null;
    }
    return rows.map((row) => (row.item.type === "assistant_message" ? row.item.text : "")).join("");
  }

  async getEpoch(agentId: string): Promise<string | null> {
    return this.readEpoch(agentId);
  }

  async ensureEpoch(agentId: string, epoch: string): Promise<void> {
    // Whoever wrote first owns the epoch: a restart must adopt the committed
    // one rather than minting a new value that invalidates client cursors.
    this.db
      .prepare("INSERT OR IGNORE INTO agent_timelines (agent_id, epoch) VALUES (?, ?)")
      .run(agentId, epoch);
  }

  async beginBackfill(agentId: string): Promise<void> {
    // Clearing and marking incomplete belong to the same instant: a crash
    // between them would leave rows that look authoritative but are about to be
    // replaced.
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ?").run(agentId);
      this.db
        .prepare("UPDATE agent_timelines SET backfill_complete = 0 WHERE agent_id = ?")
        .run(agentId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.logger.error({ err: error, agentId }, "Failed to start agent timeline backfill");
      throw error;
    }
  }

  async completeBackfill(agentId: string): Promise<void> {
    this.db
      .prepare("UPDATE agent_timelines SET backfill_complete = 1 WHERE agent_id = ?")
      .run(agentId);
  }

  async hasCommitted(agentId: string): Promise<boolean> {
    // Rows alone do not make a timeline usable: a backfill that died part-way
    // leaves a real prefix of a conversation whose remainder only the provider
    // can supply. Serving that as history would strand the agent on a truncated
    // transcript for good, so an unfinished backfill reports nothing committed
    // and the caller falls back to loading the agent and hydrating again.
    const record = this.db
      .prepare("SELECT backfill_complete AS complete FROM agent_timelines WHERE agent_id = ?")
      .get(agentId) as { complete: number } | undefined;
    if (record?.complete !== 1) {
      return false;
    }
    return this.countRows(agentId, null, []) > 0;
  }

  async deleteAgent(agentId: string): Promise<void> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM agent_timeline_rows WHERE agent_id = ?").run(agentId);
      this.db.prepare("DELETE FROM agent_timelines WHERE agent_id = ?").run(agentId);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async flush(): Promise<void> {
    // Every write already committed synchronously; nothing is buffered here.
  }

  /** Idempotent: shutdown and disposal can both reach this. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.db.close();
  }

  private readEpoch(agentId: string): string | null {
    const record = this.db
      .prepare("SELECT epoch FROM agent_timelines WHERE agent_id = ?")
      .get(agentId) as { epoch: string } | undefined;
    return record?.epoch ?? null;
  }

  private readWindow(agentId: string): AgentTimelineWindow {
    const record = this.db
      .prepare(
        "SELECT MIN(seq) AS minSeq, MAX(seq) AS maxSeq FROM agent_timeline_rows WHERE agent_id = ?",
      )
      .get(agentId) as WindowRecord | undefined;
    const minSeq = record?.minSeq ?? 0;
    const maxSeq = record?.maxSeq ?? 0;
    return { minSeq: minSeq ?? 0, maxSeq: maxSeq ?? 0, nextSeq: (maxSeq ?? 0) + 1 };
  }

  private countRows(agentId: string, where: string | null, params: number[]): number {
    const record = this.db
      .prepare(
        `SELECT COUNT(*) AS total FROM agent_timeline_rows WHERE agent_id = ?${
          where ? ` AND ${where}` : ""
        }`,
      )
      .get(agentId, ...params) as { total: number } | undefined;
    return record?.total ?? 0;
  }

  private selectRows(
    agentId: string,
    query: {
      where: string | null;
      params: number[];
      order: "ASC" | "DESC";
      limit: number | null;
    },
  ): AgentTimelineRow[] {
    const records = this.db
      .prepare(
        `SELECT seq, timestamp, item FROM agent_timeline_rows
         WHERE agent_id = ?${query.where ? ` AND ${query.where}` : ""}
         ORDER BY seq ${query.order}${query.limit === null ? "" : " LIMIT ?"}`,
      )
      .all(
        agentId,
        ...query.params,
        ...(query.limit === null ? [] : [query.limit]),
      ) as unknown as TimelineRowRecord[];
    return records.map(decodeRow);
  }

  private resetPage(
    agentId: string,
    base: PageBase,
    limit: number | null,
    flags: { staleCursor: boolean; gap: boolean },
  ): AgentTimelineFetchResult {
    const rows = this.selectRows(agentId, {
      where: null,
      params: [],
      order: "DESC",
      limit,
    }).toReversed();
    return {
      ...base,
      reset: true,
      staleCursor: flags.staleCursor,
      gap: flags.gap,
      hasOlder: rows.length > 0 && rows[0].seq > base.window.minSeq,
      hasNewer: false,
      rows,
    };
  }
}
