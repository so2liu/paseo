import { describe, expect, it, vi } from "vitest";
import {
  confirmReadyToReviewWorkspaceArchive,
  shouldEnableWorkspaceArchiveShortcut,
} from "@/workspace/archive-review-guard";

describe("ready-to-review workspace archive guard", () => {
  it("requires a separate explicit confirmation before archiving", async () => {
    const confirm = vi.fn(async () => false);

    await expect(confirmReadyToReviewWorkspaceArchive("attention", confirm)).resolves.toBe(false);
    expect(confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmLabel: "Archive",
        cancelLabel: "Keep ready to review",
        destructive: true,
      }),
    );
  });

  it("does not prompt for a workspace that is already done", async () => {
    const confirm = vi.fn(async () => false);

    await expect(confirmReadyToReviewWorkspaceArchive("done", confirm)).resolves.toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("disables the destructive shortcut while the selected workspace awaits review", () => {
    expect(
      shouldEnableWorkspaceArchiveShortcut({
        selected: true,
        isArchiving: false,
        status: "attention",
      }),
    ).toBe(false);
    expect(
      shouldEnableWorkspaceArchiveShortcut({
        selected: true,
        isArchiving: false,
        status: "done",
      }),
    ).toBe(true);
  });
});
