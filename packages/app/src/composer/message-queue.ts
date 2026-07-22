import type { AgentMessageQueueItem } from "@getpaseo/protocol/messages";
import type { ComposerAttachment } from "@/attachments/types";
import type { QueuedComposerMessage } from "@/composer/actions";

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
