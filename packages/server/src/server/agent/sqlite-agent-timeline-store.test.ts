import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import { InMemoryAgentTimelineStore } from "./agent-timeline-store.js";
import type { AgentTimelineFetchOptions, AgentTimelineRow } from "./agent-timeline-store-types.js";
import { SqliteAgentTimelineStore } from "./sqlite-agent-timeline-store.js";

const AGENT = "agent-1";
const EPOCH = "epoch-1";

function row(seq: number, text: string): AgentTimelineRow {
  return {
    seq,
    timestamp: `2026-01-01T00:00:${String(seq % 60).padStart(2, "0")}.000Z`,
    item: { type: "assistant_message", text },
  };
}

describe("SqliteAgentTimelineStore", () => {
  let directory: string;
  let stores: SqliteAgentTimelineStore[];

  function createStore(file?: string): SqliteAgentTimelineStore {
    const store = new SqliteAgentTimelineStore({
      file: file ?? path.join(directory, "timelines.db"),
      logger: createTestLogger(),
    });
    stores.push(store);
    return store;
  }

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "paseo-sqlite-timeline-"));
    stores = [];
  });

  afterEach(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("serves committed rows to a store that never saw them written", async () => {
    const writer = createStore();
    await writer.ensureEpoch(AGENT, EPOCH);
    await writer.bulkInsert(AGENT, [row(1, "one"), row(2, "two"), row(3, "three")]);
    writer.close();

    // A fresh connection stands in for the next daemon process.
    const reader = createStore();
    const result = await reader.fetchCommitted(AGENT, { direction: "tail", limit: 2 });

    expect(result.epoch).toBe(EPOCH);
    expect(result.rows.map((entry) => entry.item)).toEqual([
      { type: "assistant_message", text: "two" },
      { type: "assistant_message", text: "three" },
    ]);
    expect(result.hasOlder).toBe(true);
    expect(result.hasNewer).toBe(false);
    expect(result.window).toEqual({ minSeq: 1, maxSeq: 3, nextSeq: 4 });
  });

  it("keeps the epoch stable across restarts so existing cursors stay valid", async () => {
    const writer = createStore();
    await writer.ensureEpoch(AGENT, EPOCH);
    await writer.bulkInsert(AGENT, [row(1, "one")]);
    writer.close();

    const reader = createStore();
    // A restart re-offers a freshly minted epoch; the committed one wins.
    await reader.ensureEpoch(AGENT, "epoch-2");
    expect(await reader.getEpoch(AGENT)).toBe(EPOCH);
  });

  it("ignores rows whose seq was already committed", async () => {
    const store = createStore();
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, [row(1, "one"), row(2, "two")]);
    // Provider hydration can re-stream history the log already holds.
    await store.bulkInsert(AGENT, [row(1, "one"), row(2, "two"), row(3, "three")]);

    expect((await store.getCommittedRows(AGENT)).map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("refuses to append before an epoch exists", async () => {
    const store = createStore();
    // `ensureEpoch` owns creation; rows with no epoch cannot be addressed by cursor.
    await expect(store.bulkInsert(AGENT, [row(1, "one")])).rejects.toThrow(/epoch/);
    expect(await store.hasCommitted(AGENT)).toBe(false);
  });

  it("commits a batch atomically", async () => {
    const store = createStore();
    await store.ensureEpoch(AGENT, EPOCH);
    await expect(
      store.bulkInsert(AGENT, [
        row(1, "one"),
        { seq: 2, timestamp: "t", item: undefined as never },
      ]),
    ).rejects.toThrow();

    // The valid row from the failed batch must not survive on its own.
    expect(await store.getCommittedRows(AGENT)).toEqual([]);
  });

  it("reports no committed timeline for an agent that has never been written", async () => {
    const store = createStore();
    expect(await store.hasCommitted("agent-unknown")).toBe(false);
    expect(await store.getEpoch("agent-unknown")).toBeNull();
    expect(await store.getLatestCommittedSeq("agent-unknown")).toBe(0);
  });

  it("drops the timeline when the agent is deleted", async () => {
    const store = createStore();
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, [row(1, "one")]);
    await store.deleteAgent(AGENT);

    expect(await store.hasCommitted(AGENT)).toBe(false);
    expect(await store.getEpoch(AGENT)).toBeNull();
  });

  it("reconstructs the last assistant message from committed chunks", async () => {
    const store = createStore();
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, [
      row(1, "ignored"),
      { seq: 2, timestamp: "t", item: { type: "user_message", text: "hi" } },
      row(3, "hello "),
      row(4, "world"),
    ]);

    expect(await store.getLastAssistantMessage(AGENT)).toBe("hello world");
  });

  it("returns null for a last assistant message when the tail is not assistant text", async () => {
    const store = createStore();
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, [
      row(1, "answer"),
      { seq: 2, timestamp: "t", item: { type: "user_message", text: "later question" } },
    ]);

    expect(await store.getLastAssistantMessage(AGENT)).toBeNull();
  });

  it("treats an unfinished backfill as no committed timeline", async () => {
    const writer = createStore();
    await writer.ensureEpoch(AGENT, EPOCH);
    await writer.setBackfillComplete(AGENT, false);
    await writer.bulkInsert(AGENT, [row(1, "first half")]);
    writer.close();

    // A crash mid-backfill leaves real rows that are only a prefix. Serving
    // them would strand the agent on a truncated transcript, so a restart must
    // see nothing committed and hydrate from the provider again.
    const restarted = createStore();
    expect(await restarted.hasCommitted(AGENT)).toBe(false);
    expect(await restarted.getEpoch(AGENT)).toBe(EPOCH);
    expect(await restarted.getCommittedRows(AGENT)).toHaveLength(1);

    await restarted.setBackfillComplete(AGENT, true);
    expect(await restarted.hasCommitted(AGENT)).toBe(true);
  });

  it("counts a never-backfilled timeline as complete", async () => {
    const store = createStore();
    // A brand-new agent has no earlier history that could be missing, so its
    // rows are usable immediately without waiting for a backfill to finish.
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, [row(1, "live row")]);

    expect(await store.hasCommitted(AGENT)).toBe(true);
  });

  it("reads only the requested page instead of the whole conversation", async () => {
    const store = createStore();
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(
      AGENT,
      Array.from({ length: 500 }, (_, index) => row(index + 1, `row ${index}`)),
    );

    // The point of paging in SQL: a bounded page must not materialize 500 rows.
    const page = await store.fetchCommitted(AGENT, { direction: "tail", limit: 10 });
    expect(page.rows).toHaveLength(10);
    expect(page.rows[0].seq).toBe(491);
    expect(page.window).toEqual({ minSeq: 1, maxSeq: 500, nextSeq: 501 });
  });
});

/**
 * The app's paging, cursor, and gap handling were written against the in-memory
 * store. Swapping the durable backend must not change any of that, so rather
 * than restating the expected flags by hand, every request shape is run through
 * both stores and the results compared.
 */
describe("SqliteAgentTimelineStore matches the in-memory store", () => {
  let directory: string;
  let store: SqliteAgentTimelineStore;
  let reference: InMemoryAgentTimelineStore;

  const rows = [row(1, "one"), row(2, "two"), row(3, "three"), row(4, "four"), row(5, "five")];

  beforeEach(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "paseo-sqlite-parity-"));
    store = new SqliteAgentTimelineStore({
      file: path.join(directory, "timelines.db"),
      logger: createTestLogger(),
    });
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, rows);

    reference = new InMemoryAgentTimelineStore();
    reference.initialize(AGENT, { epoch: EPOCH, rows, nextSeq: 6 });
  });

  afterEach(async () => {
    store.close();
    await rm(directory, { recursive: true, force: true });
  });

  const requests: Array<{ name: string; options: AgentTimelineFetchOptions }> = [
    { name: "tail default limit", options: { direction: "tail" } },
    { name: "tail limit 2", options: { direction: "tail", limit: 2 } },
    { name: "tail limit 0 (all)", options: { direction: "tail", limit: 0 } },
    { name: "tail limit beyond size", options: { direction: "tail", limit: 99 } },
    { name: "after seq 0", options: { direction: "after", cursor: { epoch: EPOCH, seq: 0 } } },
    {
      name: "after seq 2 limit 2",
      options: { direction: "after", cursor: { epoch: EPOCH, seq: 2 }, limit: 2 },
    },
    {
      name: "after last seq",
      options: { direction: "after", cursor: { epoch: EPOCH, seq: 5 }, limit: 2 },
    },
    { name: "before without cursor", options: { direction: "before", limit: 2 } },
    {
      name: "before seq 4 limit 2",
      options: { direction: "before", cursor: { epoch: EPOCH, seq: 4 }, limit: 2 },
    },
    {
      name: "before seq 1",
      options: { direction: "before", cursor: { epoch: EPOCH, seq: 1 }, limit: 2 },
    },
    {
      name: "stale cursor epoch",
      options: { direction: "after", cursor: { epoch: "other-epoch", seq: 2 }, limit: 2 },
    },
  ];

  for (const request of requests) {
    it(`agrees on ${request.name}`, async () => {
      expect(await store.fetchCommitted(AGENT, request.options)).toEqual(
        reference.fetch(AGENT, request.options),
      );
    });
  }

  it("agrees on a cursor behind retained history", async () => {
    // History that no longer starts at seq 1: an `after` cursor older than the
    // retained window has to raise `gap`, which the app uses to resynchronize.
    const trimmed = [row(5, "five"), row(6, "six"), row(7, "seven")];
    await store.deleteAgent(AGENT);
    await store.ensureEpoch(AGENT, EPOCH);
    await store.bulkInsert(AGENT, trimmed);

    const trimmedReference = new InMemoryAgentTimelineStore();
    trimmedReference.initialize(AGENT, { epoch: EPOCH, rows: trimmed, nextSeq: 8 });

    const options: AgentTimelineFetchOptions = {
      direction: "after",
      cursor: { epoch: EPOCH, seq: 1 },
      limit: 1,
    };
    const actual = await store.fetchCommitted(AGENT, options);
    expect(actual.gap).toBe(true);
    expect(actual).toEqual(trimmedReference.fetch(AGENT, options));
  });
});
