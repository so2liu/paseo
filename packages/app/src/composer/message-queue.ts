import type { AgentMessageQueueItem } from "@getpaseo/protocol/messages";
import type { ComposerAttachment } from "@/attachments/types";
import type { QueuedComposerMessage } from "@/composer/actions";
import type { AgentMessageOutboxItem } from "@/composer/outbox";

export function queuedMessagesFromServer(
  items: AgentMessageQueueItem[],
  existing: readonly QueuedComposerMessage[],
): QueuedComposerMessage[] {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  return items.map((item) => {
    const attachments: ComposerAttachment[] = [];
    for (const attachment of item.attachments ?? []) {
      if (attachment.type === "uploaded_file") attachments.push({ kind: "file", attachment });
    }
    return {
      id: item.id,
      text: item.text,
      attachments: existingById.get(item.id)?.attachments ?? attachments,
      wireImages: item.images ?? [],
      wireAttachments: item.attachments ?? [],
      serverAcknowledged: true,
    };
  });
}

export function pendingQueuedMessagesForServerSync(input: {
  serverId: string;
  agentId: string;
  serverItems: readonly AgentMessageQueueItem[];
  outbox: readonly AgentMessageOutboxItem[];
  localItems: readonly QueuedComposerMessage[];
}): AgentMessageOutboxItem[] {
  const acknowledgedIds = new Set(input.serverItems.map((item) => item.id));
  for (const local of input.localItems) {
    if (local.serverAcknowledged === true) {
      acknowledgedIds.add(local.id);
    }
  }

  const pendingById = new Map(
    input.outbox.filter((item) => !acknowledgedIds.has(item.id)).map((item) => [item.id, item]),
  );
  for (const local of input.localItems) {
    if (
      local.serverAcknowledged !== true &&
      !acknowledgedIds.has(local.id) &&
      !pendingById.has(local.id)
    ) {
      pendingById.set(local.id, {
        ...local,
        serverId: input.serverId,
        agentId: input.agentId,
      });
    }
  }
  return Array.from(pendingById.values());
}
