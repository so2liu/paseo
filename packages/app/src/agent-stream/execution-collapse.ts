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

function findLastToolCallAssistant(items: readonly StreamItem[]): StreamItem | null {
  let lastToolCallIndex = -1;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].kind === "tool_call") {
      lastToolCallIndex = index;
      break;
    }
  }
  if (lastToolCallIndex < 0) return null;

  let firstToolCallIndex = lastToolCallIndex;
  while (firstToolCallIndex > 0 && items[firstToolCallIndex - 1].kind === "tool_call") {
    firstToolCallIndex -= 1;
  }

  const precedingItem = items[firstToolCallIndex - 1];
  if (precedingItem?.kind === "assistant_message" && precedingItem.text.trim()) {
    return precedingItem;
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
    const lastToolCallAssistant = findLastToolCallAssistant(turnItems);
    const visibleItemIds = new Set(
      [finalAssistant, lastToolCallAssistant].flatMap((item) => (item ? [item.id] : [])),
    );
    const collapsibleItems = turnItems.filter((item) => !visibleItemIds.has(item.id));
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
