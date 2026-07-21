import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages";

describe("agent message queue protocol", () => {
  test("parses enqueue requests and synchronized snapshots", () => {
    const item = {
      id: "message-1",
      agentId: "agent-1",
      text: "queued guidance",
      attachments: [],
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    };
    expect(
      SessionInboundMessageSchema.parse({
        type: "agent.message_queue.enqueue.request",
        requestId: "request-1",
        item: { id: item.id, agentId: item.agentId, text: item.text, attachments: [] },
      }).type,
    ).toBe("agent.message_queue.enqueue.request");
    expect(
      SessionOutboundMessageSchema.parse({
        type: "agent.message_queue.updated",
        payload: { agentId: item.agentId, items: [item] },
      }),
    ).toMatchObject({ payload: { items: [{ id: "message-1" }] } });
  });
});
