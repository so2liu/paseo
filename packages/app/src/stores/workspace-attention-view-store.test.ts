import { describe, expect, it } from "vitest";
import {
  getWorkspaceAttentionMarker,
  hasUnreadWorkspaceAttention,
} from "./workspace-attention-view-store";

describe("workspace attention view state", () => {
  it("uses the status transition timestamp as the attention generation marker", () => {
    const enteredAt = new Date("2026-07-25T08:00:00.000Z");

    expect(getWorkspaceAttentionMarker(enteredAt)).toBe("2026-07-25T08:00:00.000Z");
    expect(
      hasUnreadWorkspaceAttention({
        status: "attention",
        statusEnteredAt: enteredAt,
        seenMarker: enteredAt.toISOString(),
      }),
    ).toBe(false);
  });

  it("never treats a non-attention workspace as unread", () => {
    expect(
      hasUnreadWorkspaceAttention({
        status: "done",
        statusEnteredAt: null,
      }),
    ).toBe(false);
  });

  it("supports legacy daemon attention without a transition timestamp", () => {
    expect(
      hasUnreadWorkspaceAttention({
        status: "attention",
        statusEnteredAt: null,
      }),
    ).toBe(true);
    expect(
      hasUnreadWorkspaceAttention({
        status: "attention",
        statusEnteredAt: null,
        seenMarker: getWorkspaceAttentionMarker(null),
      }),
    ).toBe(false);
  });
});
