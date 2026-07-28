import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentTimelineRow } from "./agent-timeline-store-types.js";
import { JsonlAgentTimelineStore } from "./jsonl-agent-timeline-store.js";

function row(seq: number, text: string): AgentTimelineRow {
  return {
    seq,
    timestamp: `2026-01-01T00:00:0${seq % 10}.000Z`,
    item: { type: "assistant_message", text },
  };
}

describe("JsonlAgentTimelineStore", () => {
  let directory: string;

  function createStore(): JsonlAgentTimelineStore {
    return new JsonlAgentTimelineStore({ directory, logger: createTestLogger() });
  }

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "paseo-timeline-store-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("serves committed rows to a store that never saw them written", async () => {
    const writer = createStore();
    await writer.ensureEpoch("agent-1", "epoch-1");
    await writer.bulkInsert("agent-1", [row(1, "one"), row(2, "two"), row(3, "three")]);
    await writer.flush();

    // A fresh instance stands in for the next daemon process: it has no memory
    // of the agent and must reconstruct the timeline from disk alone.
    const reader = createStore();
    const result = await reader.fetchCommitted("agent-1", { direction: "tail", limit: 2 });

    expect(result.epoch).toBe("epoch-1");
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
    await writer.ensureEpoch("agent-1", "epoch-1");
    await writer.bulkInsert("agent-1", [row(1, "one")]);
    await writer.flush();

    const reader = createStore();
    // A restart re-offers a freshly minted epoch; the committed one wins.
    await reader.ensureEpoch("agent-1", "epoch-2");

    expect(await reader.getEpoch("agent-1")).toBe("epoch-1");
    const result = await reader.fetchCommitted("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
    });
    expect(result.staleCursor).toBe(false);
    expect(result.reset).toBe(false);
  });

  it("pages forward from a cursor", async () => {
    const store = createStore();
    await store.ensureEpoch("agent-1", "epoch-1");
    await store.bulkInsert("agent-1", [row(1, "one"), row(2, "two"), row(3, "three")]);

    const result = await store.fetchCommitted("agent-1", {
      direction: "after",
      cursor: { epoch: "epoch-1", seq: 1 },
      limit: 1,
    });

    expect(result.rows.map((entry) => entry.seq)).toEqual([2]);
    expect(result.hasNewer).toBe(true);
  });

  it("ignores rows whose seq was already committed", async () => {
    const store = createStore();
    await store.ensureEpoch("agent-1", "epoch-1");
    await store.bulkInsert("agent-1", [row(1, "one"), row(2, "two")]);
    // Provider hydration can re-stream history the log already holds.
    await store.bulkInsert("agent-1", [row(1, "one"), row(2, "two"), row(3, "three")]);
    await store.flush();

    const reader = createStore();
    const rows = await reader.getCommittedRows("agent-1");
    expect(rows.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("reports no committed timeline for an agent that has never been written", async () => {
    const store = createStore();
    expect(await store.hasCommitted("agent-unknown")).toBe(false);
    expect(await store.getEpoch("agent-unknown")).toBeNull();
    expect(await store.getLatestCommittedSeq("agent-unknown")).toBe(0);
  });

  it("recovers every intact row when a crash left a torn final line", async () => {
    const store = createStore();
    await store.ensureEpoch("agent-1", "epoch-1");
    await store.bulkInsert("agent-1", [row(1, "one"), row(2, "two")]);
    await store.flush();

    const filePath = path.join(directory, "agent-1.jsonl");
    await fs.appendFile(filePath, '{"seq":3,"timestamp":"2026-01', "utf8");

    const reader = createStore();
    const rows = await reader.getCommittedRows("agent-1");
    expect(rows.map((entry) => entry.seq)).toEqual([1, 2]);
  });

  it("drops the log when the agent is deleted", async () => {
    const store = createStore();
    await store.ensureEpoch("agent-1", "epoch-1");
    await store.bulkInsert("agent-1", [row(1, "one")]);
    await store.deleteAgent("agent-1");
    await store.flush();

    expect(await store.hasCommitted("agent-1")).toBe(false);
    await expect(fs.access(path.join(directory, "agent-1.jsonl"))).rejects.toThrow();
  });

  it("reconstructs the last assistant message from committed chunks", async () => {
    const store = createStore();
    await store.ensureEpoch("agent-1", "epoch-1");
    await store.bulkInsert("agent-1", [
      row(1, "ignored"),
      { seq: 2, timestamp: "2026-01-01T00:00:02.000Z", item: { type: "user_message", text: "hi" } },
      row(3, "hello "),
      row(4, "world"),
    ]);
    await store.flush();

    const reader = createStore();
    expect(await reader.getLastAssistantMessage("agent-1")).toBe("hello world");
  });

  it("keeps appends ordered when writes are issued concurrently", async () => {
    const store = createStore();
    await store.ensureEpoch("agent-1", "epoch-1");

    await Promise.all([
      store.bulkInsert("agent-1", [row(1, "one")]),
      store.bulkInsert("agent-1", [row(2, "two")]),
      store.bulkInsert("agent-1", [row(3, "three")]),
    ]);
    await store.flush();

    const reader = createStore();
    const rows = await reader.getCommittedRows("agent-1");
    expect(rows.map((entry) => entry.seq)).toEqual([1, 2, 3]);
  });

  it("never renumbers rows after a transient read failure", async () => {
    const writer = createStore();
    await writer.ensureEpoch("agent-1", "epoch-1");
    await writer.bulkInsert("agent-1", [row(1, "one"), row(2, "two")]);
    await writer.flush();

    const filePath = path.join(directory, "agent-1.jsonl");
    await fs.chmod(filePath, 0o000);

    // A daemon that cannot read the log must not conclude the agent has none:
    // adopting a fresh epoch and restarting at seq 1 would append rows that
    // collide with the committed ones, corrupting history permanently.
    const store = createStore();
    expect(await store.hasCommitted("agent-1")).toBe(false);
    await store.ensureEpoch("agent-1", "epoch-2");
    await expect(store.bulkInsert("agent-1", [row(1, "replayed")])).rejects.toThrow(/unreadable/);
    await store.flush();

    await fs.chmod(filePath, 0o644);
    const contents = await fs.readFile(filePath, "utf8");
    const lines = contents.split("\n").filter(Boolean);
    expect(JSON.parse(lines[0]).epoch).toBe("epoch-1");
    expect(lines.slice(1).map((line) => JSON.parse(line).seq)).toEqual([1, 2]);

    // Once the file is readable again the store recovers without a restart.
    expect(await store.hasCommitted("agent-1")).toBe(true);
    expect(await store.getEpoch("agent-1")).toBe("epoch-1");
  });

  it("reads the log once when concurrent appends arrive on a cold cache", async () => {
    const writer = createStore();
    await writer.ensureEpoch("agent-1", "epoch-1");
    await writer.bulkInsert(
      "agent-1",
      Array.from({ length: 50 }, (_, index) => row(index + 1, `row ${index}`)),
    );
    await writer.flush();

    // A fresh store stands in for an agent evicted from the read cache while it
    // is still streaming. Appends are fire-and-forget, so they land together.
    const store = createStore();
    const readFile = vi.spyOn(fs, "readFile");
    await Promise.all(
      [51, 52, 53, 54, 55].map((seq) => store.bulkInsert("agent-1", [row(seq, `new ${seq}`)])),
    );
    await store.flush();

    const reads = readFile.mock.calls.filter((call) =>
      String(call[0]).endsWith("agent-1.jsonl"),
    ).length;
    expect(reads).toBe(1);

    const reader = createStore();
    expect((await reader.getCommittedRows("agent-1")).map((entry) => entry.seq)).toEqual(
      Array.from({ length: 55 }, (_, index) => index + 1),
    );
  });

  it("does not let an agent id escape the timeline directory", async () => {
    const store = createStore();
    await store.ensureEpoch("../escaped", "epoch-1");
    await store.bulkInsert("../escaped", [row(1, "one")]);
    await store.flush();

    const entries = await fs.readdir(directory);
    expect(entries).toEqual(["escaped.jsonl"]);
  });
});
