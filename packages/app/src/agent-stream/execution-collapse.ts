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
 * Identifies the turn whose opening prompt has not been paged in yet, used only when the host
 * is too old to serve a prompt index. It is keyed on the run's *last* row rather than its first
 * or a bare constant: the first row changes with every page that prepends, so an id following it
 * would drop the reader's expand state on each load, while a constant would carry that state
 * across a rewind or epoch change onto an unrelated turn.
 */
function leadingTurnGroupId(turnItems: readonly StreamItem[]): string {
  return `execution-collapse:leading:${turnItems.at(-1)?.id ?? ""}`;
}

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

interface TurnSegment {
  id: string;
  turnItems: readonly StreamItem[];
  isCompleted: boolean;
}

interface TurnSegmentAccumulator extends Omit<TurnSegment, "turnItems"> {
  turnItems: StreamItem[];
}

/**
 * Turn boundaries taken from the daemon's prompt index rather than from the rows that happen
 * to be loaded. Paging backwards delivers a turn's opening prompt last, so window-derived
 * boundaries leave exactly the rows a reader lands on — the newest turn's execution — ungrouped
 * until they have scrolled past all of it. The index names every prompt up front, so a partly
 * loaded turn is grouped correctly from the first frame, and its id stays put across pages.
 */
function segmentByPromptIndex(input: {
  items: readonly StreamItem[];
  isRunning: boolean;
  promptSeqs: readonly number[];
}): TurnSegment[] {
  // A prompt that is already loaded but not yet in the index would otherwise be filed under the
  // preceding turn, letting buildGroup swallow both it and the previous conclusion into that
  // older group — and the index refresh is not guaranteed to arrive, so that state can persist.
  // Loaded prompts are boundaries in their own right, so the two sources are unioned.
  const loadedPromptSeqs = input.items.flatMap((item) =>
    item.kind === "user_message" && item.timelineCursor ? [item.timelineCursor.seq] : [],
  );
  const orderedPromptSeqs = [...new Set([...input.promptSeqs, ...loadedPromptSeqs])].sort(
    (left, right) => left - right,
  );
  const newestPromptSeq = orderedPromptSeqs.at(-1);
  const segmentsBySeq = new Map<number, TurnSegmentAccumulator>();

  for (const item of input.items) {
    const seq = item.timelineCursor?.seq;
    if (seq === undefined) continue;
    // The newest prompt owns rows the index has not caught up with yet, which is where live
    // rows land; `isCompleted` still keeps a running turn out of the projection.
    const promptSeq = findOwningPromptSeq(orderedPromptSeqs, seq);
    if (promptSeq === null) continue;
    if (seq === promptSeq) continue;

    let segment = segmentsBySeq.get(promptSeq);
    if (!segment) {
      segment = {
        id: `execution-collapse:prompt:${promptSeq}`,
        turnItems: [],
        isCompleted: promptSeq !== newestPromptSeq || !input.isRunning,
      };
      segmentsBySeq.set(promptSeq, segment);
    }
    segment.turnItems.push(item);
  }

  return [...segmentsBySeq.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, segment]) => segment);
}

function findOwningPromptSeq(orderedPromptSeqs: readonly number[], seq: number): number | null {
  let owning: number | null = null;
  for (const promptSeq of orderedPromptSeqs) {
    if (promptSeq > seq) break;
    owning = promptSeq;
  }
  return owning;
}

function segmentByLoadedPrompts(input: {
  items: readonly StreamItem[];
  isRunning: boolean;
}): TurnSegment[] {
  const segments: TurnSegment[] = [];
  const userIndexes = input.items.flatMap((item, index) =>
    item.kind === "user_message" ? [index] : [],
  );

  const leadingEnd = userIndexes[0] ?? input.items.length;
  const leadingItems = input.items.slice(0, leadingEnd);
  if (leadingItems.length > 0) {
    segments.push({
      id: leadingTurnGroupId(leadingItems),
      turnItems: leadingItems,
      isCompleted: userIndexes.length > 0 || !input.isRunning,
    });
  }

  for (let turnIndex = 0; turnIndex < userIndexes.length; turnIndex += 1) {
    const userIndex = userIndexes[turnIndex];
    const nextUserIndex = userIndexes[turnIndex + 1] ?? input.items.length;
    segments.push({
      id: input.items[userIndex].id,
      turnItems: input.items.slice(userIndex + 1, nextUserIndex),
      isCompleted: turnIndex < userIndexes.length - 1 || !input.isRunning,
    });
  }

  return segments;
}

export function buildExecutionCollapseProjection(input: {
  items: readonly StreamItem[];
  isRunning: boolean;
  /**
   * Every prompt's timeline seq, from the daemon's prompt index. Omitted when the host is too
   * old to serve the index; grouping then falls back to the prompts present in the window.
   */
  promptSeqs?: readonly number[];
}): ExecutionCollapseProjection {
  const groups: ExecutionCollapseGroup[] = [];
  const groupByItemId = new Map<string, ExecutionCollapseGroup>();

  const segments =
    input.promptSeqs && input.promptSeqs.length > 0
      ? segmentByPromptIndex({
          items: input.items,
          isRunning: input.isRunning,
          promptSeqs: input.promptSeqs,
        })
      : segmentByLoadedPrompts({ items: input.items, isRunning: input.isRunning });

  for (const segment of segments) {
    if (!segment.isCompleted) continue;
    const group = buildGroup({ id: segment.id, turnItems: segment.turnItems });
    if (!group) continue;
    groups.push(group);
    for (const itemId of group.itemIds) {
      groupByItemId.set(itemId, group);
    }
  }

  return { groups, groupByItemId };
}
