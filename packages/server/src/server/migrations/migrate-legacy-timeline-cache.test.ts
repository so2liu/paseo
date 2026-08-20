import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { FileAgentTimelineStore } from "../agent/file-agent-timeline-store.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { migrateLegacyTimelineCache } from "./migrate-legacy-timeline-cache.js";

const roots = new Set<string>();

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-legacy-timeline-"));
  roots.add(root);
  return root;
}

function seedLegacyDatabase(
  databasePath: string,
  timelines: Array<{
    agentId: string;
    epoch: string;
    complete: boolean;
    rows: AgentTimelineRow[];
  }>,
): void {
  const database = new DatabaseSync(databasePath);
  database.exec(`
    CREATE TABLE agent_timelines (
      agent_id TEXT PRIMARY KEY,
      epoch TEXT NOT NULL,
      backfill_complete INTEGER NOT NULL DEFAULT 1
    );
    CREATE TABLE agent_timeline_rows (
      agent_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      timestamp TEXT NOT NULL,
      item TEXT NOT NULL,
      PRIMARY KEY (agent_id, seq)
    ) WITHOUT ROWID;
  `);
  const insertTimeline = database.prepare(
    "INSERT INTO agent_timelines (agent_id, epoch, backfill_complete) VALUES (?, ?, ?)",
  );
  const insertRow = database.prepare(
    `INSERT INTO agent_timeline_rows (agent_id, seq, timestamp, item)
     VALUES (?, ?, ?, ?)`,
  );
  for (const timeline of timelines) {
    insertTimeline.run(timeline.agentId, timeline.epoch, timeline.complete ? 1 : 0);
    for (const row of timeline.rows) {
      insertRow.run(timeline.agentId, row.seq, row.timestamp, JSON.stringify(row.item));
    }
  }
  database.close();
}

afterEach(async () => {
  await Promise.all([...roots].map((root) => rm(root, { recursive: true, force: true })));
  roots.clear();
});

describe("legacy SQLite timeline cache migration", () => {
  test("preserves complete rows and epoch without removing the rollback database", async () => {
    const root = await makeRoot();
    const databasePath = path.join(root, "timelines.db");
    const timelineDirectory = path.join(root, "agent-timelines");
    const markerPath = path.join(timelineDirectory, ".legacy-sqlite-migration.json");
    const store = new FileAgentTimelineStore(timelineDirectory);
    const rows: AgentTimelineRow[] = [
      {
        seq: 1,
        timestamp: "2026-08-01T00:00:00.000Z",
        item: { type: "user_message", text: "old question" },
      },
      {
        seq: 2,
        timestamp: "2026-08-01T00:00:01.000Z",
        item: { type: "assistant_message", text: "old answer" },
      },
    ];
    seedLegacyDatabase(databasePath, [
      { agentId: "legacy-agent", epoch: "legacy-epoch", complete: true, rows },
    ]);

    const result = await migrateLegacyTimelineCache({
      databasePath,
      markerPath,
      timelineStore: store,
      logger: createTestLogger(),
    });

    expect(result).toEqual({
      sourceFound: true,
      migratedAgents: 1,
      skippedMigratedAgents: 0,
      skippedExistingAgents: 0,
      skippedIncompleteAgents: 0,
      failedAgents: 0,
    });
    expect(existsSync(databasePath)).toBe(true);
    expect(await store.getCommittedSnapshot("legacy-agent")).toEqual({
      rows,
      historyComplete: true,
    });
    expect((await store.fetchCommitted("legacy-agent", { limit: 0 })).epoch).toBe("legacy-epoch");

    const repeated = await migrateLegacyTimelineCache({
      databasePath,
      markerPath,
      timelineStore: new FileAgentTimelineStore(timelineDirectory),
      logger: createTestLogger(),
    });
    expect(repeated.migratedAgents).toBe(0);
    expect(repeated.skippedMigratedAgents).toBe(1);
  });

  test("never overwrites current-format rows", async () => {
    const root = await makeRoot();
    const databasePath = path.join(root, "timelines.db");
    const timelineDirectory = path.join(root, "agent-timelines");
    const markerPath = path.join(timelineDirectory, ".legacy-sqlite-migration.json");
    const store = new FileAgentTimelineStore(timelineDirectory);
    seedLegacyDatabase(databasePath, [
      {
        agentId: "agent",
        epoch: "legacy-epoch",
        complete: true,
        rows: [
          {
            seq: 1,
            timestamp: "2026-08-01T00:00:00.000Z",
            item: { type: "assistant_message", text: "legacy" },
          },
        ],
      },
    ]);
    await store.replaceCommittedSnapshot("agent", {
      rows: [
        {
          seq: 1,
          timestamp: "2026-08-02T00:00:00.000Z",
          item: { type: "assistant_message", text: "current" },
        },
      ],
      historyComplete: true,
    });

    const result = await migrateLegacyTimelineCache({
      databasePath,
      markerPath,
      timelineStore: store,
      logger: createTestLogger(),
    });

    expect(result.skippedExistingAgents).toBe(1);
    expect(await store.getLastAssistantMessage("agent")).toBe("current");
    expect((await store.fetchCommitted("agent", { limit: 0 })).epoch).not.toBe("legacy-epoch");
  });

  test("does not publish an interrupted SQLite backfill as committed history", async () => {
    const root = await makeRoot();
    const databasePath = path.join(root, "timelines.db");
    const timelineDirectory = path.join(root, "agent-timelines");
    const markerPath = path.join(timelineDirectory, ".legacy-sqlite-migration.json");
    const store = new FileAgentTimelineStore(timelineDirectory);
    seedLegacyDatabase(databasePath, [
      {
        agentId: "partial-agent",
        epoch: "partial-epoch",
        complete: false,
        rows: [
          {
            seq: 1,
            timestamp: "2026-08-01T00:00:00.000Z",
            item: { type: "assistant_message", text: "truncated" },
          },
        ],
      },
    ]);

    const result = await migrateLegacyTimelineCache({
      databasePath,
      markerPath,
      timelineStore: store,
      logger: createTestLogger(),
    });

    expect(result.skippedIncompleteAgents).toBe(1);
    expect(await store.getCommittedRows("partial-agent")).toEqual([]);
  });

  test("does not resurrect migrated SQLite history after the current cache is deleted", async () => {
    const root = await makeRoot();
    const databasePath = path.join(root, "timelines.db");
    const timelineDirectory = path.join(root, "agent-timelines");
    const markerPath = path.join(timelineDirectory, ".legacy-sqlite-migration.json");
    const store = new FileAgentTimelineStore(timelineDirectory);
    seedLegacyDatabase(databasePath, [
      {
        agentId: "reloaded-agent",
        epoch: "obsolete-epoch",
        complete: true,
        rows: [
          {
            seq: 1,
            timestamp: "2026-08-01T00:00:00.000Z",
            item: { type: "assistant_message", text: "obsolete" },
          },
        ],
      },
    ]);
    await migrateLegacyTimelineCache({
      databasePath,
      markerPath,
      timelineStore: store,
      logger: createTestLogger(),
    });
    await store.deleteAgent("reloaded-agent");

    const restarted = new FileAgentTimelineStore(timelineDirectory);
    const result = await migrateLegacyTimelineCache({
      databasePath,
      markerPath,
      timelineStore: restarted,
      logger: createTestLogger(),
    });

    expect(result.skippedMigratedAgents).toBe(1);
    expect(await restarted.getCommittedRows("reloaded-agent")).toEqual([]);
  });
});
