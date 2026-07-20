import { beforeEach, describe, expect, test, vi } from "vitest";

const storage = vi.hoisted(() => new Map<string, string>());
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async (key: string) => storage.get(key) ?? null),
    setItem: vi.fn(async (key: string, value: string) => {
      storage.set(key, value);
    }),
  },
}));

import {
  listAgentMessageOutbox,
  persistAgentMessageOutboxItem,
  removeAgentMessageOutboxItem,
} from "./outbox";

describe("agent message outbox", () => {
  beforeEach(() => storage.clear());

  test("persists unacknowledged messages by server and agent", async () => {
    await persistAgentMessageOutboxItem({
      serverId: "server-1",
      agentId: "agent-1",
      id: "message-1",
      text: "queued while locking",
      attachments: [],
    });

    await expect(listAgentMessageOutbox("server-1", "agent-1")).resolves.toMatchObject([
      { id: "message-1", text: "queued while locking" },
    ]);
    await removeAgentMessageOutboxItem("server-1", "agent-1", "message-1");
    await expect(listAgentMessageOutbox("server-1", "agent-1")).resolves.toEqual([]);
  });
});
