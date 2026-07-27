import { describe, expect, it } from "vitest";
import { pendingQueuedMessagesForServerSync, queuedMessagesFromServer } from "./message-queue";

describe("queuedMessagesFromServer", () => {
  it("marks messages acknowledged after they appear in the daemon queue", () => {
    const [message] = queuedMessagesFromServer(
      [
        {
          id: "message-1",
          agentId: "agent-1",
          text: "Keep going",
          createdAt: "2026-07-21T12:00:00.000Z",
          updatedAt: "2026-07-21T12:00:00.000Z",
        },
      ],
      [],
    );

    expect(message?.serverAcknowledged).toBe(true);
  });

  it("preserves local attachment presentation when applying the daemon snapshot", () => {
    const localAttachment = {
      kind: "image" as const,
      metadata: {
        id: "image-1",
        mimeType: "image/png",
        storageType: "native-file" as const,
        storageKey: "/image.png",
        fileName: "image.png",
        createdAt: 1,
      },
    };
    const [message] = queuedMessagesFromServer(
      [
        {
          id: "message-1",
          agentId: "agent-1",
          text: "Inspect this",
          createdAt: "2026-07-21T12:00:00.000Z",
          updatedAt: "2026-07-21T12:00:00.000Z",
        },
      ],
      [{ id: "message-1", text: "Inspect this", attachments: [localAttachment] }],
    );

    expect(message?.attachments).toEqual([localAttachment]);
  });
});

describe("pendingQueuedMessagesForServerSync", () => {
  it("does not resend an acknowledged local message that the daemon already drained", () => {
    expect(
      pendingQueuedMessagesForServerSync({
        serverId: "server-1",
        agentId: "agent-1",
        serverItems: [],
        outbox: [
          {
            serverId: "server-1",
            agentId: "agent-1",
            id: "message-1",
            text: "Already handled",
            attachments: [],
          },
        ],
        localItems: [
          {
            id: "message-1",
            text: "Already handled",
            attachments: [],
            serverAcknowledged: true,
          },
        ],
      }),
    ).toEqual([]);
  });
});
