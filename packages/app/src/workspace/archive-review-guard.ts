import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { ConfirmDialogInput } from "@/utils/confirm-dialog";

type ConfirmArchive = (input: ConfirmDialogInput) => Promise<boolean>;

export async function confirmReadyToReviewWorkspaceArchive(
  status: WorkspaceDescriptor["status"],
  confirm: ConfirmArchive,
  dialog: ConfirmDialogInput,
): Promise<boolean> {
  if (status !== "attention") {
    return true;
  }

  return await confirm(dialog);
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
