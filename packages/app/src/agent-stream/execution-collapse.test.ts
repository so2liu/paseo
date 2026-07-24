import { describe, expect, it } from "vitest";
import { buildExecutionCollapseProjection } from "./execution-collapse";
import type { StreamItem } from "@/types/stream";

const timestamp = new Date(0);

function user(id: string): StreamItem {
  return { kind: "user_message", id, text: id, timestamp };
}

function assistant(
  id: string,
  identity?: { messageId?: string; blockGroupId?: string; blockIndex?: number },
): StreamItem {
  return { kind: "assistant_message", id, text: id, timestamp, ...identity };
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

  it("preserves every rendered block belonging to the final logical assistant message", () => {
    const projection = buildExecutionCollapseProjection({
      items: [
        user("u1"),
        assistant("final:block:0", {
          messageId: "final-message",
          blockGroupId: "final",
          blockIndex: 0,
        }),
        assistant("final:block:1", {
          messageId: "final-message",
          blockGroupId: "final",
          blockIndex: 1,
        }),
        assistant("final:block:2", {
          messageId: "final-message",
          blockGroupId: "final-resumed",
          blockIndex: 2,
        }),
      ],
      isRunning: false,
    });

    expect(projection.groups).toHaveLength(0);
  });

  it("does not count rendered blocks as separate execution items", () => {
    const projection = buildExecutionCollapseProjection({
      items: [
        user("u1"),
        assistant("progress:block:0", {
          messageId: "progress-message",
          blockGroupId: "progress",
          blockIndex: 0,
        }),
        assistant("progress:block:1", {
          messageId: "progress-message",
          blockGroupId: "progress",
          blockIndex: 1,
        }),
        thought("work"),
        assistant("final:block:0", {
          messageId: "final-message",
          blockGroupId: "final",
          blockIndex: 0,
        }),
        assistant("final:block:1", {
          messageId: "final-message",
          blockGroupId: "final",
          blockIndex: 1,
        }),
      ],
      isRunning: false,
    });

    expect(projection.groups).toHaveLength(1);
    expect([...projection.groups[0].itemIds]).toEqual([
      "progress:block:0",
      "progress:block:1",
      "work",
    ]);
    expect(projection.groups[0].itemCount).toBe(2);
    expect(projection.groupByItemId.has("final:block:0")).toBe(false);
    expect(projection.groupByItemId.has("final:block:1")).toBe(false);
  });
});
