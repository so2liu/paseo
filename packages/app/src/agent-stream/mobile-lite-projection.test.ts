import { describe, expect, test } from "vitest";
import type { StreamItem } from "@/types/stream";
import { projectMobileLiteStream } from "./mobile-lite-projection";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

function item(input: Partial<StreamItem> & Pick<StreamItem, "kind" | "id">): StreamItem {
  return { timestamp, ...input } as StreamItem;
}

describe("projectMobileLiteStream", () => {
  test("keeps conversation text and errors while removing execution details", () => {
    const user = item({ kind: "user_message", id: "user", text: "hello" });
    const thought = item({ kind: "thought", id: "thought", text: "thinking", status: "ready" });
    const tool = item({
      kind: "tool_call",
      id: "tool",
      payload: {
        source: "orchestrator",
        data: {
          toolCallId: "call",
          toolName: "read",
          arguments: {},
          status: "completed",
        },
      },
    });
    const info = item({
      kind: "activity_log",
      id: "info",
      activityType: "info",
      message: "working",
    });
    const error = item({
      kind: "activity_log",
      id: "error",
      activityType: "error",
      message: "failed",
    });
    const assistant = item({
      kind: "assistant_message",
      id: "assistant",
      text: "done",
    });

    expect(projectMobileLiteStream([user, thought, tool, info, error, assistant])).toEqual([
      user,
      error,
      assistant,
    ]);
  });

  test("preserves the original array when every item is visible", () => {
    const items = [
      item({ kind: "user_message", id: "user", text: "hello" }),
      item({ kind: "assistant_message", id: "assistant", text: "done" }),
    ];

    expect(projectMobileLiteStream(items)).toBe(items);
  });
});
