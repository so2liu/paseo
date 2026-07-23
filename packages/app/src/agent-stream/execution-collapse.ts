import type { StreamItem } from "@/types/stream";

export interface ExecutionCollapseGroup {
  id: string;
  hostItemId: string;
  itemIds: ReadonlySet<string>;
  itemCount: number;
}

export interface ExecutionCollapseProjection {
  groupByItemId: ReadonlyMap<string, ExecutionCollapseGroup>;
  groups: readonly ExecutionCollapseGroup[];
}

function findFinalAssistant(items: readonly StreamItem[]): StreamItem | null {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item.kind === "assistant_message" && item.text.trim()) {
      return item;
    }
  }
  return null;
}

export function buildExecutionCollapseProjection(input: {
  items: readonly StreamItem[];
  isRunning: boolean;
}): ExecutionCollapseProjection {
  const groups: ExecutionCollapseGroup[] = [];
  const groupByItemId = new Map<string, ExecutionCollapseGroup>();
  const userIndexes = input.items.flatMap((item, index) =>
    item.kind === "user_message" ? [index] : [],
  );

  for (let turnIndex = 0; turnIndex < userIndexes.length; turnIndex += 1) {
    const userIndex = userIndexes[turnIndex];
    const nextUserIndex = userIndexes[turnIndex + 1] ?? input.items.length;
    const isCompleted = turnIndex < userIndexes.length - 1 || !input.isRunning;
    if (!isCompleted) continue;

    const turnItems = input.items.slice(userIndex + 1, nextUserIndex);
    const finalAssistant = findFinalAssistant(turnItems);
    if (!finalAssistant) continue;
    const collapsibleItems = turnItems.filter((item) => item.id !== finalAssistant.id);
    if (collapsibleItems.length === 0) continue;

    const group: ExecutionCollapseGroup = {
      id: input.items[userIndex].id,
      hostItemId: collapsibleItems[0].id,
      itemIds: new Set(collapsibleItems.map((item) => item.id)),
      itemCount: collapsibleItems.length,
    };
    groups.push(group);
    for (const item of collapsibleItems) {
      groupByItemId.set(item.id, group);
    }
  }

  return { groups, groupByItemId };
}
