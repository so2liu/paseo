import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

type ConfirmArchive = (input: ConfirmDialogInput) => Promise<boolean>;

export async function confirmReadyToReviewWorkspaceArchive(
  status: WorkspaceDescriptor["status"],
  confirm: ConfirmArchive,
): Promise<boolean> {
  if (status !== "attention") {
    return true;
  }

  return await confirm({
    title: "Archive workspace that is ready to review?",
    message:
      "Opening this workspace does not mark it done. Archive it only if you intentionally want to remove it from Ready to review.",
    confirmLabel: "Archive",
    cancelLabel: "Keep ready to review",
    destructive: true,
  });
}

export function shouldEnableWorkspaceArchiveShortcut(input: {
  selected: boolean;
  isArchiving: boolean;
  status: WorkspaceDescriptor["status"];
}): boolean {
  // A delayed or synthesized destructive shortcut must never consume the same
  // interaction that selects a result awaiting review. The explicit Archive
  // menu still works, behind the confirmation in useWorkspaceArchive.
  return input.selected && !input.isArchiving && input.status !== "attention";
}
