import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";
import { createTestAgentClients } from "../test-utils/fake-agent-client.js";
import type { AgentClient, AgentSession } from "../agent/agent-sdk-types.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-timeline-cache-"));
}

/**
 * Wraps the fake providers so a test can count how many times a provider
 * transcript is actually replayed. Replay is the expensive part this cache
 * exists to avoid, so "how many times did it run" is the thing worth asserting.
 */
function createHistoryCountingClients(): {
  clients: Record<string, AgentClient>;
  replays: () => number;
} {
  let replays = 0;
  const countSession = (session: AgentSession): AgentSession =>
    new Proxy(session, {
      get(target, property) {
        if (property !== "streamHistory") {
          return Reflect.get(target, property, target);
        }
        return function streamHistory(...args: unknown[]) {
          replays += 1;
          return (target.streamHistory as (...rest: unknown[]) => unknown)(...args);
        };
      },
    }) as AgentSession;

  // The fake clients are class instances, so delegate rather than spread —
  // spreading would drop every prototype method.
  const clients = Object.fromEntries(
    Object.entries(createTestAgentClients()).map(([provider, base]) => [
      provider,
      new Proxy(base, {
        get(target, property) {
          if (property === "createSession" || property === "resumeSession") {
            return async (...args: unknown[]) =>
              countSession(
                await (target[property] as (...rest: unknown[]) => Promise<AgentSession>).apply(
                  target,
                  args,
                ),
              );
          }
          return Reflect.get(target, property, target);
        },
      }) as AgentClient,
    ]),
  );
  return { clients, replays: () => replays };
}

describe("daemon E2E - durable timeline reads", () => {
  let ctx: DaemonTestContext;

  beforeEach(async () => {
    ctx = await createDaemonTestContext();
  });

  afterEach(async () => {
    await ctx.cleanup();
  }, 60_000);

  test("serves history for a collected agent without restarting its runtime", async () => {
    const cwd = tmpCwd();
    try {
      const agent = await ctx.client.createAgent({
        provider: "codex",
        cwd,
        title: "Timeline Cache Read Test",
        modeId: "full-access",
      });

      await ctx.client.sendMessage(agent.id, "Respond with exactly: CACHED");
      expect((await ctx.client.waitForFinish(agent.id, 5_000)).status).toBe("idle");

      const { agentManager } = ctx.daemon.daemon;
      // Stand in for the idle-runtime sweep that collects agents after an hour.
      await agentManager.closeAgent(agent.id);
      await agentManager.flushForShutdown();
      expect(agentManager.getAgent(agent.id)).toBeNull();

      const timeline = await ctx.client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 200,
      });

      const assistantTexts = timeline.entries
        .filter((entry) => entry.item.type === "assistant_message")
        .map((entry) => entry.item.text);
      expect(assistantTexts).toContain("CACHED");
      expect(timeline.agent?.id).toBe(agent.id);

      // The read is the whole assertion: history came back and the agent still
      // has no live runtime, so no provider process was started to produce it.
      expect(agentManager.getAgent(agent.id)).toBeNull();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("refreshing an agent with no cached history replays the provider once", async () => {
    const counting = createHistoryCountingClients();
    const counted = await createDaemonTestContext({ agentClients: counting.clients });
    const cwd = tmpCwd();
    try {
      const agent = await counted.client.createAgent({
        provider: "codex",
        cwd,
        title: "Legacy Refresh Test",
        modeId: "full-access",
      });
      await counted.client.sendMessage(agent.id, "Respond with exactly: LEGACY");
      expect((await counted.client.waitForFinish(agent.id, 5_000)).status).toBe("idle");

      const { agentManager } = counted.daemon.daemon;
      await agentManager.closeAgent(agent.id);
      // Stand in for a daemon restart holding an agent that predates this cache:
      // nothing in memory and nothing committed, so the loader has to replay the
      // provider transcript itself. Closing alone is not enough — it leaves the
      // in-memory timeline behind, which marks history primed and skips replay.
      await agentManager.deleteAgentState(agent.id);
      expect(await agentManager.hasCommittedTimeline(agent.id)).toBe(false);

      const before = counting.replays();
      await counted.client.refreshAgent(agent.id);

      // Loading already replayed the whole transcript. Forcing a second pass
      // would double the wait for exactly the agents this cache cannot help.
      expect(counting.replays() - before).toBe(1);

      const timeline = await counted.client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 200,
      });
      const assistantTexts = timeline.entries
        .filter((entry) => entry.item.type === "assistant_message")
        .map((entry) => entry.item.text);
      expect(assistantTexts).toContain("LEGACY");
    } finally {
      await counted.cleanup();
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);

  test("reload re-reads the provider transcript for an agent with no live runtime", async () => {
    const cwd = tmpCwd();
    try {
      const agent = await ctx.client.createAgent({
        provider: "codex",
        cwd,
        title: "Reload After Collection Test",
        modeId: "full-access",
      });

      await ctx.client.sendMessage(agent.id, "Respond with exactly: CACHED");
      expect((await ctx.client.waitForFinish(agent.id, 5_000)).status).toBe("idle");

      const { agentManager } = ctx.daemon.daemon;
      await agentManager.closeAgent(agent.id);
      await agentManager.flushForShutdown();
      expect(agentManager.getAgent(agent.id)).toBeNull();

      const cached = await ctx.client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 200,
      });

      // Reload is the escape hatch for a stale cache. Seeding a cold-loaded
      // agent from the durable log marks its history primed, so without an
      // explicit force this silently returned the cache instead of re-reading
      // the provider.
      await ctx.client.refreshAgent(agent.id);

      const reloaded = await ctx.client.fetchAgentTimeline(agent.id, {
        direction: "tail",
        limit: 200,
      });
      // A re-read mints a fresh epoch; skipping hydration would keep the
      // committed one. That is what separates a real reload from a no-op.
      expect(reloaded.epoch).not.toBe(cached.epoch);
      const assistantTexts = reloaded.entries
        .filter((entry) => entry.item.type === "assistant_message")
        .map((entry) => entry.item.text);
      expect(assistantTexts).toContain("CACHED");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  }, 30_000);
});
