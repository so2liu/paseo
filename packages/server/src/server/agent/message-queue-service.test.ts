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
    const manager = {
      subscribe: vi.fn(() => () => undefined),
      hasInFlightRun: vi.fn(() => true),
      steerAgent: vi.fn(async () => undefined),
    } as unknown as AgentManager;
    return {
      manager,
      service: new AgentMessageQueueService(
        tempDir,
        manager,
        {} as AgentStorage,
        createTestLogger(),
      ),
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

    expect(manager.steerAgent).toHaveBeenCalledOnce();
    expect(await service.list("agent-1")).toEqual([]);
  });
});
