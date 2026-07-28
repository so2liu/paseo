import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { createDaemonTestContext, type DaemonTestContext } from "../test-utils/index.js";

function tmpCwd(): string {
  return mkdtempSync(path.join(tmpdir(), "daemon-e2e-timeline-cache-"));
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
      await agentManager.flushCommittedTimelines();
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
      await agentManager.flushCommittedTimelines();
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
