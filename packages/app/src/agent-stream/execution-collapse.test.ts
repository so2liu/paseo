import { describe, expect, it } from "vitest";
import { buildExecutionCollapseProjection } from "./execution-collapse";
import type { StreamItem } from "@/types/stream";

const timestamp = new Date(0);

function user(id: string): StreamItem {
  return { kind: "user_message", id, text: id, timestamp };
}

function assistant(id: string): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp };
}

function thought(id: string): StreamItem {
  return { kind: "thought", id, text: id, status: "ready", timestamp };
}

describe("execution collapse projection", () => {
  it("collapses intermediate work but preserves the final assistant conclusion", () => {
    const projection = buildExecutionCollapseProjection({
      items: [user("u1"), assistant("progress"), thought("work"), assistant("final")],
      isRunning: false,
    });

    expect(projection.groups).toHaveLength(1);
    expect([...projection.groups[0].itemIds]).toEqual(["progress", "work"]);
    expect(projection.groupByItemId.has("final")).toBe(false);
  });

  it("does not collapse the active running turn", () => {
    const projection = buildExecutionCollapseProjection({
      items: [user("u1"), assistant("progress"), thought("work")],
      isRunning: true,
    });

    expect(projection.groups).toHaveLength(0);
  });
});
