import { describe, expect, it, vi } from "vitest";
import {
  confirmReadyToReviewWorkspaceArchive,
  shouldEnableWorkspaceArchiveShortcut,
} from "@/workspace/archive-review-guard";

describe("ready-to-review workspace archive guard", () => {
  it("requires a separate explicit confirmation before archiving", async () => {
    const confirm = vi.fn(async () => false);
    const dialog = {
      title: "Localized archive title",
      message: "Localized archive message",
      confirmLabel: "Localized archive action",
      cancelLabel: "Localized cancel action",
      destructive: true,
    };

    await expect(confirmReadyToReviewWorkspaceArchive("attention", confirm, dialog)).resolves.toBe(
      false,
    );
    expect(confirm).toHaveBeenCalledWith(dialog);
  });

  it("does not prompt for a workspace that is already done", async () => {
    const confirm = vi.fn(async () => false);

    await expect(
      confirmReadyToReviewWorkspaceArchive("done", confirm, {
        title: "unused",
        message: "unused",
        confirmLabel: "unused",
        cancelLabel: "unused",
        destructive: true,
      }),
    ).resolves.toBe(true);
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
