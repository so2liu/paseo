import { describe, expect, it } from "vitest";
import { collectUserInputHistory, navigateInputHistory } from "./input-history";
import type { StreamItem } from "@/types/stream";

function user(id: string, text: string): StreamItem {
  return { kind: "user_message", id, text, timestamp: new Date(0) };
}

describe("input history", () => {
  it("collects non-empty user messages in conversation order", () => {
    expect(
      collectUserInputHistory([user("1", "first"), user("2", "first")], [user("3", " second ")]),
    ).toEqual(["first", "first", "second"]);
  });

  it("walks backward and forward before restoring the draft", () => {
    const older = navigateInputHistory({
      direction: "older",
      history: ["first", "second"],
      currentText: "draft",
      state: { index: null, draft: "" },
    });
    expect(older).toEqual({ handled: true, index: 1, draft: "draft", text: "second" });

    const oldest = navigateInputHistory({
      direction: "older",
      history: ["first", "second"],
      currentText: older.text,
      state: older,
    });
    expect(oldest.text).toBe("first");

    const newer = navigateInputHistory({
      direction: "newer",
      history: ["first", "second"],
      currentText: oldest.text,
      state: oldest,
    });
    const restored = navigateInputHistory({
      direction: "newer",
      history: ["first", "second"],
      currentText: newer.text,
      state: newer,
    });
    expect(restored).toEqual({ handled: true, index: null, draft: "draft", text: "draft" });
  });
});
