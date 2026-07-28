import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceDescriptorPayload } from "@getpaseo/protocol/messages";
import { normalizeAgentSnapshot } from "@/utils/agent-snapshots";
import {
  normalizeEmptyProjectDescriptor,
  normalizeWorkspaceDescriptor,
  useSessionStore,
} from "@/stores/session-store";
import type { StreamItem } from "@/types/stream";
import { ReplicaCache, type ReplicaCacheStorage } from ".";

const SERVER_ID = "cached-host";
const LRU_SERVER_IDS = ["host-a", "host-b", "host-c"] as const;

class MemoryStorage implements ReplicaCacheStorage {
  readonly values = new Map<string, string>();

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async setItem(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

function workspace(
  id = "workspace-1",
  projectId = "project-1",
  workspaceDirectory = "/repo/paseo",
): WorkspaceDescriptorPayload {
  return {
    id,
    projectId,
    projectDisplayName: "Paseo",
    projectRootPath: workspaceDirectory,
    workspaceDirectory,
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "running",
    statusEnteredAt: "2026-07-18T08:00:00.000Z",
    activityAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
}

function agent(id: string, workspaceId = "workspace-1", cwd = "/repo/paseo") {
  return normalizeAgentSnapshot(
    {
      id,
      provider: "codex",
      cwd,
      workspaceId,
      model: null,
      createdAt: "2026-07-18T08:00:00.000Z",
      updatedAt: "2026-07-18T08:01:00.000Z",
      lastUserMessageAt: "2026-07-18T08:01:00.000Z",
      status: "idle",
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
      currentModeId: null,
      availableModes: [],
      pendingPermissions: [],
      persistence: null,
      title: `Agent ${id}`,
      labels: {},
    },
    SERVER_ID,
  );
}

function message(id: string, text: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    text,
    timestamp: new Date("2026-07-18T08:02:00.000Z"),
    timelineCursor: { epoch: "epoch-1", seq: 12 },
  };
}

function seedSession(): void {
  const store = useSessionStore.getState();
  store.initializeSession(SERVER_ID, null);
  store.setAgents(SERVER_ID, new Map([["agent-1", agent("agent-1")]]));
  store.setWorkspaces(
    SERVER_ID,
    new Map([["workspace-1", normalizeWorkspaceDescriptor(workspace())]]),
  );
  store.setEmptyProjects(SERVER_ID, [
    normalizeEmptyProjectDescriptor({
      projectId: "empty-project",
      projectDisplayName: "Empty project",
      projectRootPath: "/repo/empty",
      projectKind: "directory",
    }),
  ]);
  store.setFocusedAgentId(SERVER_ID, "agent-1");
  store.setAgentStreamTail(SERVER_ID, new Map([["agent-1", [message("message-1", "Cached")]]]));
  store.setAgentTimelineCursor(
    SERVER_ID,
    new Map([["agent-1", { epoch: "epoch-1", startSeq: 1, endSeq: 12 }]]),
  );
  store.setAgentTimelineHasOlder(SERVER_ID, new Map([["agent-1", true]]));
  store.setAgentAuthoritativeHistoryApplied(SERVER_ID, "agent-1", true);
}

function seedTimeline(serverId: string, text: string): void {
  const agentId = `agent-${serverId}`;
  const workspaceId = `workspace-${serverId}`;
  const workspaceDirectory = `/repo/${serverId}`;
  const store = useSessionStore.getState();
  store.initializeSession(serverId, null);
  store.setAgents(serverId, new Map([[agentId, agent(agentId, workspaceId, workspaceDirectory)]]));
  store.setWorkspaces(
    serverId,
    new Map([
      [
        workspaceId,
        normalizeWorkspaceDescriptor(
          workspace(workspaceId, `project-${serverId}`, workspaceDirectory),
        ),
      ],
    ]),
  );
  store.setFocusedAgentId(serverId, agentId);
  store.setAgentStreamTail(serverId, new Map([[agentId, [message(`message-${serverId}`, text)]]]));
}

afterEach(() => {
  const store = useSessionStore.getState();
  store.clearSession(SERVER_ID);
  for (const serverId of LRU_SERVER_IDS) store.clearSession(serverId);
});

describe("ReplicaCache", () => {
  it("restores a displayable stale replica without claiming remote hydration", async () => {
    const storage = new MemoryStorage();
    const writer = new ReplicaCache(storage);
    writer.setHosts([SERVER_ID]);
    seedSession();
    await writer.flush();

    useSessionStore.getState().clearSession(SERVER_ID);

    const reader = new ReplicaCache(storage);
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    const session = useSessionStore.getState().sessions[SERVER_ID];
    expect(session?.client).toBeNull();
    expect(session?.hasHydratedAgents).toBe(false);
    expect(session?.hasHydratedWorkspaces).toBe(false);
    expect(Array.from(session?.agents.keys() ?? [])).toEqual(["agent-1"]);
    expect(Array.from(session?.workspaces.keys() ?? [])).toEqual(["workspace-1"]);
    expect(Array.from(session?.emptyProjects.keys() ?? [])).toEqual([]);
    expect(session?.agents.get("agent-1")?.updatedAt).toBeInstanceOf(Date);
    expect(session?.workspaces.get("workspace-1")?.statusEnteredAt).toBeInstanceOf(Date);
    expect(session?.agentStreamTail.get("agent-1")).toEqual([message("message-1", "Cached")]);
    expect(session?.agentAuthoritativeHistoryApplied.get("agent-1")).toBe(true);
    expect(session?.agentTimelineCursor.get("agent-1")).toEqual({
      epoch: "epoch-1",
      startSeq: 1,
      endSeq: 12,
    });
    expect(session?.agentTimelineHasOlder.get("agent-1")).toBe(true);
  });

  it("persists every recently viewed agent with a short timeline tail", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage);
    cache.setHosts([SERVER_ID]);
    // Recency is accumulated by the live store subscription, so navigation is
    // recorded even when no persist lands between two switches.
    cache.start();
    seedSession();

    const store = useSessionStore.getState();
    store.setAgents(SERVER_ID, (agents) =>
      new Map(agents).set("agent-2", agent("agent-2", "workspace-2", "/repo/other")),
    );
    store.setWorkspaces(SERVER_ID, (workspaces) =>
      new Map(workspaces).set(
        "workspace-2",
        normalizeWorkspaceDescriptor(workspace("workspace-2", "project-2", "/repo/other")),
      ),
    );
    const secondTimeline = Array.from({ length: 60 }, (_, index) =>
      message(`message-${index}`, `Second ${index}`),
    );
    store.setAgentStreamTail(
      SERVER_ID,
      new Map([
        ["agent-1", [message("message-1", "First")]],
        ["agent-2", secondTimeline],
      ]),
    );
    // Visiting agent-2 must not evict the agent-1 view behind it.
    store.setFocusedAgentId(SERVER_ID, "agent-2");
    await cache.flush();
    cache.stop();

    store.clearSession(SERVER_ID);
    const reader = new ReplicaCache(storage);
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    const session = useSessionStore.getState().sessions[SERVER_ID];
    const timelines = session?.agentStreamTail;
    expect(Array.from(session?.agents.keys() ?? []).sort()).toEqual(["agent-1", "agent-2"]);
    expect(Array.from(session?.workspaces.keys() ?? []).sort()).toEqual([
      "workspace-1",
      "workspace-2",
    ]);
    expect(Array.from(session?.emptyProjects.keys() ?? [])).toEqual([]);
    expect(Array.from(timelines?.keys() ?? []).sort()).toEqual(["agent-1", "agent-2"]);
    expect(timelines?.get("agent-1")).toEqual([message("message-1", "First")]);
    expect(timelines?.get("agent-2")).toEqual(secondTimeline.slice(-50));
    expect(session?.agentAuthoritativeHistoryApplied.get("agent-1")).toBe(true);
    expect(session?.agentAuthoritativeHistoryApplied.get("agent-2")).toBe(true);
  });

  it("keeps only the most recently viewed agents once the byte budget is hit", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage, { maxBytes: 6_000 });
    cache.setHosts([SERVER_ID]);
    cache.start();
    seedSession();

    const store = useSessionStore.getState();
    store.setAgents(SERVER_ID, (agents) =>
      new Map(agents).set("agent-2", agent("agent-2", "workspace-2", "/repo/other")),
    );
    store.setAgentStreamTail(
      SERVER_ID,
      new Map([
        ["agent-1", [message("message-1", "A".repeat(3_000))]],
        ["agent-2", [message("message-2", "B".repeat(3_000))]],
      ]),
    );
    store.setFocusedAgentId(SERVER_ID, "agent-2");
    await cache.flush();
    cache.stop();

    store.clearSession(SERVER_ID);
    const reader = new ReplicaCache(storage, { maxBytes: 6_000 });
    reader.setHosts([SERVER_ID]);
    await reader.restore();

    const session = useSessionStore.getState().sessions[SERVER_ID];
    // agent-2 was focused last, so agent-1 is the one that gets shed.
    expect(Array.from(session?.agentStreamTail.keys() ?? [])).toEqual(["agent-2"]);
  });

  it("evicts the least recently written host when the cache exceeds its byte budget", async () => {
    const storage = new MemoryStorage();
    const cache = new ReplicaCache(storage, { maxBytes: 7_000 });
    cache.setHosts(LRU_SERVER_IDS.slice(0, 2));
    seedTimeline("host-a", "A".repeat(1_200));
    seedTimeline("host-b", "B".repeat(1_200));
    await cache.flush();

    seedTimeline("host-a", "A".repeat(1_201));
    await cache.flush();

    cache.setHosts(LRU_SERVER_IDS);
    seedTimeline("host-c", "C".repeat(1_200));
    await cache.flush();

    for (const serverId of LRU_SERVER_IDS) {
      useSessionStore.getState().clearSession(serverId);
    }
    const reader = new ReplicaCache(storage, { maxBytes: 7_000 });
    reader.setHosts(LRU_SERVER_IDS);
    await reader.restore();

    expect(Object.keys(useSessionStore.getState().sessions).sort()).toEqual(["host-a", "host-c"]);
  });

  it("drops malformed or unknown cache versions", async () => {
    const storage = new MemoryStorage();
    storage.values.set("@paseo:replica-cache", JSON.stringify({ version: 999, hosts: [] }));
    const cache = new ReplicaCache(storage);
    cache.setHosts([SERVER_ID]);

    await cache.restore();

    expect(useSessionStore.getState().sessions[SERVER_ID]).toBeUndefined();
  });
});
