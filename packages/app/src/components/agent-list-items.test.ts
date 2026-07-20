import { describe, expect, it } from "vitest";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { buildAgentListItems } from "./agent-list-items";

const NOW = new Date("2026-07-20T12:00:00.000Z");

function agent(input: {
  id: string;
  lastActivityAt?: string;
  pinnedAt?: string | null;
  archivedAt?: string | null;
}): AggregatedAgent {
  return {
    id: input.id,
    serverId: "server-1",
    serverLabel: "Host",
    title: input.id,
    status: "idle",
    lastActivityAt: new Date(input.lastActivityAt ?? "2026-07-20T10:00:00.000Z"),
    cwd: "/repo",
    provider: "codex",
    pinnedAt: input.pinnedAt ? new Date(input.pinnedAt) : null,
    archivedAt: input.archivedAt ? new Date(input.archivedAt) : null,
    createdAt: new Date("2026-07-19T10:00:00.000Z"),
    labels: {},
  };
}

describe("buildAgentListItems", () => {
  it("hoists pinned sessions and orders them by the most recent pin", () => {
    const items = buildAgentListItems(
      [
        agent({ id: "regular" }),
        agent({ id: "older-pin", pinnedAt: "2026-07-20T08:00:00.000Z" }),
        agent({ id: "newer-pin", pinnedAt: "2026-07-20T09:00:00.000Z" }),
      ],
      NOW,
    );

    expect(items.map((item) => item.key)).toEqual([
      "header:pinned",
      "server-1:newer-pin",
      "server-1:older-pin",
      "header:today",
      "server-1:regular",
    ]);
  });

  it("does not hoist archived sessions even if a legacy record remains pinned", () => {
    const items = buildAgentListItems(
      [
        agent({
          id: "archived",
          pinnedAt: "2026-07-20T09:00:00.000Z",
          archivedAt: "2026-07-20T10:00:00.000Z",
        }),
      ],
      NOW,
    );

    expect(items.map((item) => item.key)).toEqual(["header:today", "server-1:archived"]);
  });
});
