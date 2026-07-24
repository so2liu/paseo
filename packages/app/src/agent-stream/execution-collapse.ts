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

function isSameLogicalAssistantMessage(item: StreamItem, target: StreamItem): boolean {
  if (item.kind !== "assistant_message" || target.kind !== "assistant_message") {
    return false;
  }
  if (target.messageId !== undefined) {
    return item.messageId === target.messageId;
  }
  if (target.blockGroupId !== undefined) {
    return item.blockGroupId === target.blockGroupId;
  }
  return item.id === target.id;
}

function collectLogicalAssistantItemIds(
  items: readonly StreamItem[],
  assistant: StreamItem | null,
): string[] {
  if (!assistant) return [];
  return items.flatMap((item) => (isSameLogicalAssistantMessage(item, assistant) ? [item.id] : []));
}

function countLogicalItems(items: readonly StreamItem[]): number {
  const logicalItemIds = new Set<string>();
  for (const item of items) {
    if (item.kind !== "assistant_message") {
      logicalItemIds.add(item.id);
      continue;
    }
    if (item.messageId !== undefined) {
      logicalItemIds.add(`assistant-message:${item.messageId}`);
      continue;
    }
    if (item.blockGroupId !== undefined) {
      logicalItemIds.add(`assistant-block-group:${item.blockGroupId}`);
      continue;
    }
    logicalItemIds.add(item.id);
  }
  return logicalItemIds.size;
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
    const visibleItemIds = new Set([
      ...collectLogicalAssistantItemIds(turnItems, finalAssistant),
      ...collectLogicalAssistantItemIds(turnItems, lastToolCallAssistant),
    ]);
    const collapsibleItems = turnItems.filter((item) => !visibleItemIds.has(item.id));
    if (collapsibleItems.length === 0) continue;

    const group: ExecutionCollapseGroup = {
      id: input.items[userIndex].id,
      hostItemId: collapsibleItems[0].id,
      itemIds: new Set(collapsibleItems.map((item) => item.id)),
      itemCount: countLogicalItems(collapsibleItems),
    };
    groups.push(group);
    for (const item of collapsibleItems) {
      groupByItemId.set(item.id, group);
    }
  }

  return { groups, groupByItemId };
}
