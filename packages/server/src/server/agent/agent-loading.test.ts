import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test } from "vitest";

import { createTestLogger } from "../../test-utils/test-logger.js";
import { AgentManager } from "./agent-manager.js";
import { ensureAgentLoaded, serializeAgentLoadMutation } from "./agent-loading.js";
import { AgentStorage } from "./agent-storage.js";
import type {
  AgentClient,
  AgentLaunchContext,
  AgentPersistenceHandle,
  AgentResumeSessionOptions,
  AgentSession,
  AgentSessionConfig,
} from "./agent-sdk-types.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";

test("preserves unread attention when loading an agent for viewing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-attention-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const clients = createTestAgentClients();
  const manager = new AgentManager({
    clients,
    registry: storage,
    logger,
  });
  const agentId = "00000000-0000-4000-8000-000000000300";

  try {
    const agent = await manager.createAgent({ provider: "codex", cwd: root }, agentId, {
      workspaceId: "workspace-review",
    });
    await manager.runAgent(agent.id, "finish this turn");
    await manager.flush();

    const beforeClose = await storage.get(agent.id);
    expect(beforeClose).toMatchObject({
      requiresAttention: true,
      attentionReason: "finished",
    });
    const attentionTimestamp = beforeClose?.attentionTimestamp;
    expect(attentionTimestamp).toEqual(expect.any(String));

    await manager.closeAgent(agent.id);
    await ensureAgentLoaded(agent.id, { agentManager: manager, agentStorage: storage, logger });
    await manager.flush();

    expect(manager.getAgent(agent.id)?.attention).toMatchObject({
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp: new Date(attentionTimestamp ?? ""),
    });
    expect(await storage.get(agent.id)).toMatchObject({
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp,
    });
  } finally {
    await manager.closeAgent(agentId).catch(() => undefined);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("preserves unread attention when loading from stored config without persistence", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-config-attention-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const manager = new AgentManager({
    clients: createTestAgentClients(),
    registry: storage,
    logger,
  });
  const agentId = "00000000-0000-4000-8000-000000000304";
  const timestamp = "2026-08-16T11:30:00.000Z";

  try {
    await storage.upsert({
      id: agentId,
      provider: "codex",
      cwd: root,
      workspaceId: "workspace-review",
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
      title: null,
      labels: {},
      lastStatus: "idle",
      config: {},
      persistence: null,
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp: timestamp,
    });

    await ensureAgentLoaded(agentId, { agentManager: manager, agentStorage: storage, logger });
    await manager.flush();

    expect(manager.getAgent(agentId)?.attention).toEqual({
      requiresAttention: true,
      attentionReason: "finished",
      attentionTimestamp: new Date(timestamp),
    });
  } finally {
    await manager.closeAgent(agentId).catch(() => undefined);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("serializes an explicit attention clear after an in-flight resume", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-attention-race-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) {
    throw new Error("expected Codex test client");
  }

  let releaseResume!: () => void;
  const resumeGate = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  const client: AgentClient = {
    provider: baseClient.provider,
    capabilities: baseClient.capabilities,
    createSession: async (config, launchContext, options) =>
      await baseClient.createSession(config, launchContext, options),
    resumeSession: async (handle, overrides, launchContext) => {
      await resumeGate;
      return await baseClient.resumeSession(handle, overrides, launchContext);
    },
    fetchCatalog: async (options) => await baseClient.fetchCatalog(options),
    isAvailable: async () => await baseClient.isAvailable(),
  };
  const manager = new AgentManager({ clients: { codex: client }, registry: storage, logger });
  const agentId = "00000000-0000-4000-8000-000000000303";

  try {
    const agent = await manager.createAgent({ provider: "codex", cwd: root }, agentId, {
      workspaceId: "workspace-review",
    });
    await manager.runAgent(agent.id, "finish this turn");
    await manager.closeAgent(agent.id);

    const load = ensureAgentLoaded(agent.id, {
      agentManager: manager,
      agentStorage: storage,
      logger,
    });
    await new Promise((resolve) => setImmediate(resolve));
    const clear = serializeAgentLoadMutation(agent.id, async () => {
      await manager.clearAgentAttention(agent.id);
    });

    releaseResume();
    await load;
    await clear;
    await manager.flush();

    expect(manager.getAgent(agent.id)?.attention).toEqual({ requiresAttention: false });
    expect(await storage.get(agent.id)).toMatchObject({
      requiresAttention: false,
      attentionReason: null,
      attentionTimestamp: null,
    });
  } finally {
    releaseResume();
    await manager.closeAgent(agentId).catch(() => undefined);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

test("loads archived records for history and active records with the interactive default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "agent-loading-purpose-"));
  const logger = createTestLogger();
  const storage = new AgentStorage(path.join(root, "agents"), logger);
  const baseClient = createTestAgentClients().codex;
  if (!baseClient) {
    throw new Error("expected Codex test client");
  }

  const resumeOptions: Array<AgentResumeSessionOptions | undefined> = [];
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
      options?: AgentResumeSessionOptions,
    ): Promise<AgentSession> => {
      resumeOptions.push(options);
      return await baseClient.resumeSession(handle, overrides, launchContext);
    },
    fetchCatalog: async (options) => await baseClient.fetchCatalog(options),
    isAvailable: async () => await baseClient.isAvailable(),
  };
  const manager = new AgentManager({
    clients: { codex: client },
    registry: storage,
    logger,
  });

  const archivedId = "00000000-0000-4000-8000-000000000301";
  const activeId = "00000000-0000-4000-8000-000000000302";

  try {
    const archived = await manager.createAgent({ provider: "codex", cwd: root }, archivedId, {
      workspaceId: "workspace-archived",
    });
    await manager.archiveAgent(archived.id);

    const active = await manager.createAgent({ provider: "codex", cwd: root }, activeId, {
      workspaceId: "workspace-active",
    });
    await manager.closeAgent(active.id);

    await ensureAgentLoaded(archived.id, { agentManager: manager, agentStorage: storage, logger });
    await ensureAgentLoaded(active.id, { agentManager: manager, agentStorage: storage, logger });

    expect(resumeOptions).toEqual([{ purpose: "history" }, undefined]);
  } finally {
    await Promise.all([
      manager.closeAgent(archivedId).catch(() => undefined),
      manager.closeAgent(activeId).catch(() => undefined),
    ]);
    await manager.flush().catch(() => undefined);
    await storage.flush().catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});
