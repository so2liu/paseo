import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";

/**
 * Which label the sidebar shows for what backs a workspace.
 *
 * Only the worktree case is worth its own word. `directory` and `local_checkout` differ by
 * whether the directory happens to be a git checkout, which says nothing about how the row
 * behaves — both are the folder the user already had. Collapsing them keeps the row from
 * carrying a distinction it cannot act on.
 */
export function workspaceKindLabelKey(
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"],
): "sidebar.workspace.kind.worktree" | "sidebar.workspace.kind.local" {
  return workspaceKind === "worktree"
    ? "sidebar.workspace.kind.worktree"
    : "sidebar.workspace.kind.local";
}
