import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import type { Logger } from "pino";
import { z } from "zod";

import { writeJsonFileAtomic } from "../atomic-file.js";
import type { AgentTimelineRow } from "../agent/agent-timeline-store-types.js";
import { FileAgentTimelineStore } from "../agent/file-agent-timeline-store.js";

const MigrationMarkerSchema = z.object({
  version: z.literal(1),
  migratedAgentIds: z.array(z.string()),
});

interface LegacyTimelineRecord {
  agentId: string;
  epoch: string;
  backfillComplete: number;
}

interface LegacyTimelineRowRecord {
  seq: number;
  timestamp: string;
  item: string;
}

export interface LegacyTimelineMigrationResult {
  sourceFound: boolean;
  migratedAgents: number;
  skippedMigratedAgents: number;
  skippedExistingAgents: number;
  skippedIncompleteAgents: number;
  failedAgents: number;
}

function emptyResult(sourceFound: boolean): LegacyTimelineMigrationResult {
  return {
    sourceFound,
    migratedAgents: 0,
    skippedMigratedAgents: 0,
    skippedExistingAgents: 0,
    skippedIncompleteAgents: 0,
    failedAgents: 0,
  };
}

async function readMigrationMarker(markerPath: string): Promise<Set<string>> {
  try {
    const marker = MigrationMarkerSchema.parse(JSON.parse(await readFile(markerPath, "utf8")));
    return new Set(marker.migratedAgentIds);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

async function markAgentMigrated(
  markerPath: string,
  migratedAgentIds: Set<string>,
  agentId: string,
): Promise<void> {
  migratedAgentIds.add(agentId);
  await writeJsonFileAtomic(markerPath, {
    version: 1,
    migratedAgentIds: [...migratedAgentIds].toSorted(),
  });
}

function hasLegacyTables(database: DatabaseSync): boolean {
  const tables = database
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('agent_timelines', 'agent_timeline_rows')`,
    )
    .all() as unknown as Array<{ name: string }>;
  return new Set(tables.map((table) => table.name)).size === 2;
}

function hasBackfillCompleteColumn(database: DatabaseSync): boolean {
  const columns = database.prepare("PRAGMA table_info(agent_timelines)").all() as unknown as Array<{
    name: string;
  }>;
  return columns.some((column) => column.name === "backfill_complete");
}

function readLegacyTimelines(database: DatabaseSync): LegacyTimelineRecord[] {
  const completeness = hasBackfillCompleteColumn(database) ? "backfill_complete" : "1";
  return database
    .prepare(
      `SELECT agent_id AS agentId, epoch, ${completeness} AS backfillComplete
       FROM agent_timelines ORDER BY agent_id`,
    )
    .all() as unknown as LegacyTimelineRecord[];
}

function readLegacyRows(database: DatabaseSync, agentId: string): AgentTimelineRow[] {
  const rows = database
    .prepare(
      `SELECT seq, timestamp, item FROM agent_timeline_rows
       WHERE agent_id = ? ORDER BY seq`,
    )
    .all(agentId) as unknown as LegacyTimelineRowRecord[];
  return rows.map((row) => ({
    seq: row.seq,
    timestamp: row.timestamp,
    item: JSON.parse(row.item) as AgentTimelineRow["item"],
  }));
}

/**
 * Move complete timelines from the fork's retired SQLite cache into the
 * upstream file store. The database is read-only and retained for rollback.
 * Per-agent imports are atomic and idempotent, so an interrupted migration can
 * continue on the next daemon start without overwriting current-format data.
 * Durable per-agent markers stop a later cache deletion from reviving stale
 * SQLite rows.
 */
export async function migrateLegacyTimelineCache(options: {
  databasePath: string;
  markerPath: string;
  timelineStore: FileAgentTimelineStore;
  logger: Pick<Logger, "info" | "warn">;
}): Promise<LegacyTimelineMigrationResult> {
  if (!existsSync(options.databasePath)) return emptyResult(false);

  const result = emptyResult(true);
  let migratedAgentIds: Set<string>;
  try {
    migratedAgentIds = await readMigrationMarker(options.markerPath);
  } catch (error) {
    options.logger.warn({ err: error }, "Failed to read legacy timeline migration marker");
    return result;
  }
  let database: DatabaseSync | null = null;
  try {
    database = new DatabaseSync(options.databasePath, { readOnly: true });
    if (!hasLegacyTables(database)) return result;

    for (const timeline of readLegacyTimelines(database)) {
      if (migratedAgentIds.has(timeline.agentId)) {
        result.skippedMigratedAgents += 1;
        continue;
      }
      if (timeline.backfillComplete !== 1) {
        result.skippedIncompleteAgents += 1;
        continue;
      }
      try {
        const rows = readLegacyRows(database, timeline.agentId);
        if (rows.length === 0) continue;
        const imported = await options.timelineStore.importSnapshotIfAbsent(timeline.agentId, {
          epoch: timeline.epoch,
          rows,
          historyComplete: true,
        });
        await markAgentMigrated(options.markerPath, migratedAgentIds, timeline.agentId);
        if (imported) result.migratedAgents += 1;
        else result.skippedExistingAgents += 1;
      } catch (error) {
        result.failedAgents += 1;
        options.logger.warn(
          { err: error, agentId: timeline.agentId },
          "Failed to migrate legacy agent timeline cache",
        );
      }
    }
  } catch (error) {
    options.logger.warn({ err: error }, "Failed to read legacy SQLite timeline cache");
  } finally {
    database?.close();
  }

  if (
    result.migratedAgents > 0 ||
    result.skippedMigratedAgents > 0 ||
    result.skippedExistingAgents > 0 ||
    result.skippedIncompleteAgents > 0 ||
    result.failedAgents > 0
  ) {
    options.logger.info(result, "Legacy SQLite timeline cache migration checked");
  }
  return result;
}
