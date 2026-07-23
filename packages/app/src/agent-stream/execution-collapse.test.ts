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

function toolCall(id: string): StreamItem {
  return {
    kind: "tool_call",
    id,
    timestamp,
    payload: {
      source: "orchestrator",
      data: {
        toolCallId: id,
        toolName: "bash",
        arguments: "cmd",
        result: null,
        status: "completed",
      },
    },
  };
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

  it("also preserves the non-empty assistant text before the last tool call group", () => {
    const projection = buildExecutionCollapseProjection({
      items: [
        user("u1"),
        assistant("earlier"),
        toolCall("tool-1"),
        assistant("latest-tool-text"),
        toolCall("tool-2"),
        thought("work"),
        assistant("final"),
      ],
      isRunning: false,
    });

    expect([...projection.groups[0].itemIds]).toEqual(["earlier", "tool-1", "tool-2", "work"]);
    expect(projection.groupByItemId.has("latest-tool-text")).toBe(false);
    expect(projection.groupByItemId.has("final")).toBe(false);
  });

  it("does not preserve earlier text when the last tool call has no text", () => {
    const projection = buildExecutionCollapseProjection({
      items: [
        user("u1"),
        assistant("earlier"),
        toolCall("tool-1"),
        thought("separator"),
        toolCall("tool-2"),
        assistant("final"),
      ],
      isRunning: false,
    });

    expect([...projection.groups[0].itemIds]).toEqual(["earlier", "tool-1", "separator", "tool-2"]);
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
