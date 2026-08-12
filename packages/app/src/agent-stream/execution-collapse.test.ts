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

describe("execution collapse before the opening prompt is paged in", () => {
  it("collapses the leading run so a second device does not land on raw tool calls", () => {
    // What a reader sees first on another device: the tail of a turn, newest rows only.
    const projection = buildExecutionCollapseProjection({
      items: [toolCall("t1"), toolCall("t2"), toolCall("t3"), assistant("final")],
      isRunning: false,
    });

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0].hostItemId).toBe("t1");
    expect([...projection.groups[0].itemIds]).toEqual(["t1", "t2", "t3"]);
    expect(projection.groupByItemId.has("final")).toBe(false);
  });

  it("keeps the same group id as older pages arrive so expand state survives", () => {
    const firstPage = buildExecutionCollapseProjection({
      items: [toolCall("t2"), toolCall("t3"), assistant("final")],
      isRunning: false,
    });
    const secondPage = buildExecutionCollapseProjection({
      items: [toolCall("t0"), toolCall("t1"), toolCall("t2"), toolCall("t3"), assistant("final")],
      isRunning: false,
    });

    expect(secondPage.groups[0].id).toBe(firstPage.groups[0].id);
    expect(secondPage.groups[0].itemCount).toBe(4);
  });

  it("still collapses the leading run once a later prompt is loaded", () => {
    const projection = buildExecutionCollapseProjection({
      items: [toolCall("t1"), assistant("final1"), user("u2"), toolCall("t2"), assistant("final2")],
      isRunning: false,
    });

    expect(projection.groups.map((group) => group.hostItemId)).toEqual(["t1", "t2"]);
  });

  it("leaves the leading run alone while it may still be the live turn", () => {
    const projection = buildExecutionCollapseProjection({
      items: [toolCall("t1"), toolCall("t2"), assistant("final")],
      isRunning: true,
    });

    expect(projection.groups).toHaveLength(0);
  });

  it("collapses a leading run that is provably finished even while the agent runs", () => {
    const projection = buildExecutionCollapseProjection({
      items: [toolCall("t1"), assistant("final1"), user("u2"), toolCall("t2")],
      isRunning: true,
    });

    expect(projection.groups.map((group) => group.hostItemId)).toEqual(["t1"]);
  });
});

describe("裁决者提出的指控：leading 组会不会卷进多轮并折掉它们的结论", () => {
  it("窗口里出现更晚的提问时，leading 段只覆盖那一个未完整的 turn", () => {
    // 行是按 seq 连续到达的，所以只要某一轮的行在窗口里，它的提问也在窗口里。
    // 于是第一条已加载提问之前的内容，最多只是"上一轮的尾巴"。
    const projection = buildExecutionCollapseProjection({
      items: [
        toolCall("t_prev"),
        assistant("conclusion_prev"),
        user("u_next"),
        toolCall("t_next"),
        assistant("conclusion_next"),
      ],
      isRunning: false,
    });

    // 上一轮的结论必须仍然可见，不能被卷进折叠块
    expect(projection.groupByItemId.has("conclusion_prev")).toBe(false);
    expect(projection.groupByItemId.has("conclusion_next")).toBe(false);
    expect(projection.groups.map((group) => Array.from(group.itemIds))).toEqual([
      ["t_prev"],
      ["t_next"],
    ]);
  });

  it("未完整的 turn 里，结论和最后一段工具调用前的开场白都保持可见", () => {
    // 可见性规则是既有的：最终结论 + 最后一段连续工具调用之前的那条助手消息。
    // leading 段沿用同一套规则，不会把它们折进去。
    const projection = buildExecutionCollapseProjection({
      items: [assistant("opening"), toolCall("t1"), toolCall("t2"), assistant("conclusion")],
      isRunning: false,
    });

    expect(projection.groupByItemId.has("conclusion")).toBe(false);
    expect(projection.groupByItemId.has("opening")).toBe(false);
    expect([...projection.groups[0].itemIds]).toEqual(["t1", "t2"]);
  });
});

function at(item: StreamItem, seq: number): StreamItem {
  return { ...item, timelineCursor: { epoch: "e1", seq } };
}

describe("按提问清单切分（daemon 提供索引时）", () => {
  it("提问那一行还没加载，也能按真实 turn 边界折叠", () => {
    // 读者在第二台设备上落地时看到的：某一轮的尾巴，提问在更早的分页里。
    const projection = buildExecutionCollapseProjection({
      items: [at(toolCall("t1"), 11), at(toolCall("t2"), 12), at(assistant("final"), 13)],
      isRunning: false,
      promptSeqs: [10],
    });

    expect(projection.groups).toHaveLength(1);
    expect(projection.groups[0].id).toBe("execution-collapse:prompt:10");
    expect(Array.from(projection.groups[0].itemIds)).toEqual(["t1", "t2"]);
    expect(projection.groupByItemId.has("final")).toBe(false);
  });

  it("翻出更早的页时分组 id 不变，只是变大", () => {
    const firstPage = buildExecutionCollapseProjection({
      items: [at(toolCall("t3"), 13), at(assistant("final"), 14)],
      isRunning: false,
      promptSeqs: [10],
    });
    const secondPage = buildExecutionCollapseProjection({
      items: [
        at(toolCall("t1"), 11),
        at(toolCall("t2"), 12),
        at(toolCall("t3"), 13),
        at(assistant("final"), 14),
      ],
      isRunning: false,
      promptSeqs: [10],
    });

    expect(secondPage.groups[0].id).toBe(firstPage.groups[0].id);
    expect(secondPage.groups[0].itemCount).toBe(3);
  });

  it("多轮各自成组，即使这些轮的提问都没加载", () => {
    const projection = buildExecutionCollapseProjection({
      items: [
        at(toolCall("a1"), 11),
        at(assistant("finalA"), 12),
        at(toolCall("b1"), 21),
        at(assistant("finalB"), 22),
      ],
      isRunning: false,
      promptSeqs: [10, 20],
    });

    expect(projection.groups.map((group) => group.id)).toEqual([
      "execution-collapse:prompt:10",
      "execution-collapse:prompt:20",
    ]);
    expect(projection.groupByItemId.has("finalA")).toBe(false);
    expect(projection.groupByItemId.has("finalB")).toBe(false);
  });

  it("正在跑的是最新一轮，它不折叠，更早的轮照折", () => {
    const projection = buildExecutionCollapseProjection({
      items: [
        at(toolCall("a1"), 11),
        at(assistant("finalA"), 12),
        at(toolCall("b1"), 21),
        at(assistant("liveB"), 22),
      ],
      isRunning: true,
      promptSeqs: [10, 20],
    });

    expect(projection.groups.map((group) => group.id)).toEqual(["execution-collapse:prompt:10"]);
  });

  it("提问那一行本身不会被折进去", () => {
    const projection = buildExecutionCollapseProjection({
      items: [at(user("u1"), 10), at(toolCall("t1"), 11), at(assistant("final"), 12)],
      isRunning: false,
      promptSeqs: [10],
    });

    expect(projection.groupByItemId.has("u1")).toBe(false);
    expect(Array.from(projection.groups[0].itemIds)).toEqual(["t1"]);
  });

  it("没有索引时退回按已加载提问切分", () => {
    const projection = buildExecutionCollapseProjection({
      items: [user("u1"), toolCall("t1"), assistant("final")],
      isRunning: false,
      promptSeqs: [],
    });

    expect(projection.groups[0].id).toBe("u1");
  });
});
