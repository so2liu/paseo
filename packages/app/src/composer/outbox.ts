import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueuedComposerMessage } from "@/composer/actions";

const STORAGE_KEY = "paseo.agent-message-outbox.v1";

export interface AgentMessageOutboxItem extends QueuedComposerMessage {
  serverId: string;
  agentId: string;
}

let mutationQueue: Promise<void> = Promise.resolve();

async function readAll(): Promise<AgentMessageOutboxItem[]> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as AgentMessageOutboxItem[]) : [];
  } catch {
    return [];
  }
}

async function applyMutation(
  update: (items: AgentMessageOutboxItem[]) => AgentMessageOutboxItem[],
): Promise<void> {
  const next = update(await readAll());
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

function mutate(update: (items: AgentMessageOutboxItem[]) => AgentMessageOutboxItem[]) {
  const operation = mutationQueue.then(() => applyMutation(update));
  mutationQueue = operation.then(() => undefined).catch(() => undefined);
  return operation;
}

export async function listAgentMessageOutbox(
  serverId: string,
  agentId: string,
): Promise<AgentMessageOutboxItem[]> {
  await mutationQueue;
  return (await readAll()).filter((item) => item.serverId === serverId && item.agentId === agentId);
}

export function persistAgentMessageOutboxItem(item: AgentMessageOutboxItem): Promise<void> {
  return mutate((items) =>
    items.some(
      (candidate) =>
        candidate.serverId === item.serverId &&
        candidate.agentId === item.agentId &&
        candidate.id === item.id,
    )
      ? items
      : [...items, item],
  );
}

export function removeAgentMessageOutboxItem(
  serverId: string,
  agentId: string,
  messageId: string,
): Promise<void> {
  return mutate((items) =>
    items.filter(
      (item) => item.serverId !== serverId || item.agentId !== agentId || item.id !== messageId,
    ),
  );
}
