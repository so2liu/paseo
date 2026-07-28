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
});
