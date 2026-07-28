import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { AgentStorage } from "./agent-storage.js";
import { JsonlAgentTimelineStore } from "./jsonl-agent-timeline-store.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentResumeSessionOptions,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";

const AGENT_ID = "00000000-0000-4000-8000-0000000004a1";

interface Harness {
  manager: AgentManager;
  storage: AgentStorage;
  timelines: JsonlAgentTimelineStore;
  /** How many times a provider session was resumed — i.e. a process was started. */
  resumeCount: () => number;
}

let root: string;

/**
 * Counts session resumes so a test can assert that a read never started one.
 */
function createHarness(): Harness {
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) {
    throw new Error("expected Codex test client");
  }

  let resumes = 0;
  const client: AgentClient = {
    provider: baseClient.provider,
    capabilities: baseClient.capabilities,
    createSession: async (
      config: AgentSessionConfig,
      launchContext?: AgentLaunchContext,
    ): Promise<AgentSession> => await baseClient.createSession(config, launchContext),
    resumeSession: async (
      handle: AgentPersistenceHandle,
      overrides?: Partial<AgentSessionConfig>,
      launchContext?: AgentLaunchContext,
      _options?: AgentResumeSessionOptions,
    ): Promise<AgentSession> => {
      resumes += 1;
      return await baseClient.resumeSession(handle, overrides, launchContext);
    },
    fetchCatalog: async (options) => await baseClient.fetchCatalog(options),
    isAvailable: async () => await baseClient.isAvailable(),
  };

  const timelines = new JsonlAgentTimelineStore({
    directory: path.join(root, "timelines"),
    logger,
  });
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    durableTimelineStore: timelines,
    logger,
  });

  return { manager, storage, timelines, resumeCount: () => resumes };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "paseo-durable-timeline-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("reads a collected agent's history without starting a provider process", async () => {
  const first = createHarness();
  await first.manager.createAgent({ provider: "codex", cwd: root }, AGENT_ID, {
    workspaceId: "workspace-1",
  });
  await first.manager.appendTimelineItem(AGENT_ID, { type: "user_message", text: "hello" });
  await first.manager.appendTimelineItem(AGENT_ID, {
    type: "assistant_message",
    text: "hi there",
  });
  await first.manager.closeAgent(AGENT_ID);
  await first.manager.flushForShutdown();
  await first.manager.flushCommittedTimelines();

  // A second manager over the same $PASEO_HOME stands in for a daemon restart,
  // or for an agent whose idle runtime was collected: nothing is in memory.
  const restarted = createHarness();
  expect(restarted.manager.getAgent(AGENT_ID)).toBeNull();
  expect(await restarted.manager.hasCommittedTimeline(AGENT_ID)).toBe(true);

  const timeline = await restarted.manager.fetchCommittedTimeline(AGENT_ID, {
    direction: "tail",
    limit: 200,
  });

  expect(timeline.rows.map((row) => row.item)).toEqual([
    { type: "user_message", text: "hello" },
    { type: "assistant_message", text: "hi there" },
  ]);
  // The whole point: history came back and no session was resumed.
  expect(restarted.resumeCount()).toBe(0);
});

test("reports no committed timeline for an agent that predates the durable log", async () => {
  const harness = createHarness();
  await harness.manager.createAgent({ provider: "codex", cwd: root }, AGENT_ID, {
    workspaceId: "workspace-1",
  });
  await harness.manager.closeAgent(AGENT_ID);
  await harness.manager.flushForShutdown();
  await harness.manager.flushCommittedTimelines();

  // No rows were ever committed, so callers must fall back to loading the agent
  // rather than showing an empty conversation.
  const restarted = createHarness();
  expect(await restarted.manager.hasCommittedTimeline(AGENT_ID)).toBe(false);
});

test("resumes the committed epoch and sequence after a restart", async () => {
  const first = createHarness();
  await first.manager.createAgent({ provider: "codex", cwd: root }, AGENT_ID, {
    workspaceId: "workspace-1",
  });
  await first.manager.appendTimelineItem(AGENT_ID, { type: "user_message", text: "hello" });
  const originalEpoch = (
    await first.manager.fetchTimeline(AGENT_ID, { direction: "tail", limit: 1 })
  ).epoch;
  await first.manager.closeAgent(AGENT_ID);
  await first.manager.flushForShutdown();
  await first.manager.flushCommittedTimelines();

  const restarted = createHarness();
  const timeline = await restarted.manager.fetchCommittedTimeline(AGENT_ID);

  // A new epoch would make every client cursor stale and force a full reload.
  expect(timeline.epoch).toBe(originalEpoch);
  expect(timeline.window.nextSeq).toBe(2);
});

test("rebuilds a readable log after force hydration wipes it", async () => {
  const harness = createHarness();
  await harness.manager.createAgent({ provider: "codex", cwd: root }, AGENT_ID, {
    workspaceId: "workspace-1",
  });
  await harness.manager.appendTimelineItem(AGENT_ID, { type: "user_message", text: "before" });
  await harness.manager.flushCommittedTimelines();

  // Rewind takes this path: it deletes the log, mints a fresh epoch, and
  // re-streams provider history into it.
  await harness.manager.hydrateTimelineFromProvider(AGENT_ID, { force: true });
  await harness.manager.flushForShutdown();
  await harness.manager.flushCommittedTimelines();

  const liveEpoch = harness.manager.fetchTimeline(AGENT_ID, { direction: "tail", limit: 1 }).epoch;

  // Appending rows to a header-less file would make the whole log unreadable on
  // the next start, silently dropping this agent back to the slow path.
  const reader = createHarness();
  expect(await reader.manager.hasCommittedTimeline(AGENT_ID)).toBe(
    harness.manager.fetchTimeline(AGENT_ID, { direction: "tail", limit: 0 }).rows.length > 0,
  );
  const timeline = await reader.manager.fetchCommittedTimeline(AGENT_ID);
  expect(timeline.epoch).toBe(liveEpoch);
});

test("seeds a resumed agent from the durable log instead of replaying provider history", async () => {
  const first = createHarness();
  await first.manager.createAgent({ provider: "codex", cwd: root }, AGENT_ID, {
    workspaceId: "workspace-1",
  });
  await first.manager.appendTimelineItem(AGENT_ID, { type: "user_message", text: "hello" });
  await first.manager.closeAgent(AGENT_ID);
  await first.manager.flushForShutdown();
  await first.manager.flushCommittedTimelines();

  const restarted = createHarness();
  const record = await restarted.storage.get(AGENT_ID);
  if (!record?.persistence) {
    throw new Error("expected a persistence handle for the stored agent");
  }
  await restarted.manager.resumeAgentFromPersistence(record.persistence, {}, AGENT_ID);

  // Once the process does start, the live timeline already carries the cached
  // history and keeps numbering from where the log left off.
  const timeline = restarted.manager.fetchTimeline(AGENT_ID, { direction: "tail", limit: 200 });
  expect(timeline.rows.map((row) => row.item)).toEqual([{ type: "user_message", text: "hello" }]);
  expect(timeline.window.nextSeq).toBe(2);
});
