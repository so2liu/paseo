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

/**
 * The turn whose opening prompt has not been paged in yet. Opening a long conversation on a
 * second device loads the newest rows first, so the prompt that starts the visible turn is
 * the last thing to arrive — and until it does, keying groups off prompts alone would leave
 * every intermediate row expanded. That is the state a reader actually lands in, so the
 * leading run gets collapsed on its own and simply grows as older pages arrive.
 *
 * The id is a constant rather than a row id: the run's first row changes with every page, and
 * an id that moved with it would drop the reader's expand state on each load.
 */
const LEADING_TURN_GROUP_ID = "execution-collapse:leading";

function buildGroup(input: {
  id: string;
  turnItems: readonly StreamItem[];
}): ExecutionCollapseGroup | null {
  const finalAssistant = findFinalAssistant(input.turnItems);
  if (!finalAssistant) return null;
  const lastToolCallAssistant = findLastToolCallAssistant(input.turnItems);
  const visibleItemIds = new Set([
    ...collectLogicalAssistantItemIds(input.turnItems, finalAssistant),
    ...collectLogicalAssistantItemIds(input.turnItems, lastToolCallAssistant),
  ]);
  const collapsibleItems = input.turnItems.filter((item) => !visibleItemIds.has(item.id));
  if (collapsibleItems.length === 0) return null;

  return {
    id: input.id,
    hostItemId: collapsibleItems[0].id,
    itemIds: new Set(collapsibleItems.map((item) => item.id)),
    itemCount: countLogicalItems(collapsibleItems),
  };
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

  const addGroup = (group: ExecutionCollapseGroup | null) => {
    if (!group) return;
    groups.push(group);
    for (const itemId of group.itemIds) {
      groupByItemId.set(itemId, group);
    }
  };

  // A later prompt proves the leading run is a finished turn. With no prompt loaded at all the
  // run may still be the live one, so it waits for the agent to stop.
  const leadingEnd = userIndexes[0] ?? input.items.length;
  const isLeadingCompleted = userIndexes.length > 0 || !input.isRunning;
  if (leadingEnd > 0 && isLeadingCompleted) {
    addGroup(
      buildGroup({
        id: LEADING_TURN_GROUP_ID,
        turnItems: input.items.slice(0, leadingEnd),
      }),
    );
  }

  for (let turnIndex = 0; turnIndex < userIndexes.length; turnIndex += 1) {
    const userIndex = userIndexes[turnIndex];
    const nextUserIndex = userIndexes[turnIndex + 1] ?? input.items.length;
    const isCompleted = turnIndex < userIndexes.length - 1 || !input.isRunning;
    if (!isCompleted) continue;

    addGroup(
      buildGroup({
        id: input.items[userIndex].id,
        turnItems: input.items.slice(userIndex + 1, nextUserIndex),
      }),
    );
  }

  return { groups, groupByItemId };
}
