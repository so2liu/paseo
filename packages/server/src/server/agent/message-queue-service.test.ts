import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../test-utils/test-logger.js";
import type { AgentManager } from "./agent-manager.js";
import type { AgentStorage } from "./agent-storage.js";
import { AgentMessageQueueService } from "./message-queue-service.js";

describe("AgentMessageQueueService", () => {
  let tempDir: string | null = null;

  afterEach(async () => {
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  });

  async function createService() {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "paseo-message-queue-"));
    const streamAgent = vi.fn(() => (async function* noop() {})());
    const manager = {
      subscribe: vi.fn(() => () => undefined),
      hasInFlightRun: vi.fn(() => true),
      steerAgentRun: vi.fn(async () => ({ status: "accepted" as const })),
      getAgent: vi.fn(() => ({ id: "agent-1", provider: "claude" })),
      tryRunOutOfBand: vi.fn(() => false),
      streamAgent,
    } as unknown as AgentManager;
    const storage = {
      get: vi.fn(async () => null),
    } as unknown as AgentStorage;
    return {
      manager,
      service: new AgentMessageQueueService(tempDir, manager, storage, createTestLogger()),
    };
  }

  test("persists queued messages and restores them after restart", async () => {
    const { manager, service } = await createService();
    await service.enqueue({
      id: "message-1",
      agentId: "agent-1",
      text: "continue with the tests",
      images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
      attachments: [],
    });

    const restored = new AgentMessageQueueService(
      tempDir!,
      manager,
      {} as AgentStorage,
      createTestLogger(),
    );
    expect(await restored.list("agent-1")).toMatchObject([
      { id: "message-1", text: "continue with the tests" },
    ]);
    const persisted = JSON.parse(
      await readFile(path.join(tempDir!, "message-queue", "queue.json"), "utf8"),
    );
    expect(persisted.items).toHaveLength(1);
  });

  test("removes a message only after steer is accepted", async () => {
    const { manager, service } = await createService();
    await service.enqueue({ id: "message-1", agentId: "agent-1", text: "steer", attachments: [] });

    await service.steer("agent-1", "message-1");

    expect(manager.steerAgentRun).toHaveBeenCalledOnce();
    expect(await service.list("agent-1")).toEqual([]);
  });

  test("starts the queued message as the next turn when the active turn already finished", async () => {
    const { manager, service } = await createService();
    vi.mocked(manager.steerAgentRun).mockResolvedValueOnce({ status: "unavailable" });
    vi.mocked(manager.hasInFlightRun).mockReturnValue(false);
    await service.enqueue({
      id: "message-1",
      agentId: "agent-1",
      text: "continue as the next turn",
      attachments: [],
    });

    await service.steer("agent-1", "message-1");

    expect(manager.streamAgent).toHaveBeenCalledWith("agent-1", "continue as the next turn", {
      clientMessageId: "message-1",
    });
    expect(await service.list("agent-1")).toEqual([]);
  });

  test("keeps the queued message when an active provider rejects steering", async () => {
    const { manager, service } = await createService();
    vi.mocked(manager.steerAgentRun).mockRejectedValueOnce(new Error("provider rejected steer"));
    await service.enqueue({
      id: "message-1",
      agentId: "agent-1",
      text: "do not lose me",
      attachments: [],
    });

    await expect(service.steer("agent-1", "message-1")).rejects.toThrow("provider rejected steer");

    expect(manager.streamAgent).not.toHaveBeenCalled();
    expect(await service.list("agent-1")).toMatchObject([
      { id: "message-1", text: "do not lose me" },
    ]);
  });

  test("does not enqueue an accepted message again after it was removed and the daemon restarted", async () => {
    const { manager, service } = await createService();
    const message = {
      id: "message-1",
      agentId: "agent-1",
      text: "run exactly once",
      attachments: [],
    };
    await service.enqueue(message);
    await service.remove(message.agentId, message.id);

    const restored = new AgentMessageQueueService(
      tempDir!,
      manager,
      {} as AgentStorage,
      createTestLogger(),
    );
    await restored.enqueue(message);

    expect(await restored.list(message.agentId)).toEqual([]);
  });
});
