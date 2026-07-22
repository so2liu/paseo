import { buildStatusGroups, type StatusGroup } from "@/hooks/sidebar-status-view-model";
import {
  splitPinnedSidebarGroups,
  type PinnedSidebarGroups,
  type PinnedSidebarKeys,
} from "@/hooks/use-sidebar-pins";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import type { SidebarGroupMode } from "@/stores/sidebar-view-store";
import {
  buildSidebarShortcutSections,
  type SidebarShortcutModel,
  type SidebarShortcutSection,
} from "@/utils/sidebar-shortcuts";

export interface SidebarProjection {
  pinnedGroups: PinnedSidebarGroups;
  statusGroups: StatusGroup[];
  deviceGroups: SidebarDeviceGroup[];
  shortcutModel: SidebarShortcutModel;
}

export interface SidebarDeviceGroup {
  serverId: string;
  rows: SidebarWorkspaceEntry[];
}

export function buildSidebarProjection(input: {
  projects: SidebarProjectEntry[];
  pinnedKeys: PinnedSidebarKeys;
  workspaceEntriesByKey: ReadonlyMap<string, SidebarWorkspaceEntry>;
  projectNamesByKey: Map<string, string>;
  groupMode: SidebarGroupMode;
  pinnedCollapsed: boolean;
  collapsedProjectKeys: ReadonlySet<string>;
  collapsedStatusGroupKeys: ReadonlySet<string>;
}): SidebarProjection {
  const pinnedGroups = splitPinnedSidebarGroups({
    projects: input.projects,
    keys: input.pinnedKeys,
  });
  const pinnedWorkspaceKeys = new Set(input.pinnedKeys.pinnedWorkspaceKeys);
  const statusGroups =
    input.groupMode === "status"
      ? buildStatusGroups(
          Array.from(input.workspaceEntriesByKey.values()).filter(
            (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
          ),
          input.projectNamesByKey,
        )
      : [];
  const deviceGroups =
    input.groupMode === "device"
      ? buildDeviceGroups(
          Array.from(input.workspaceEntriesByKey.values()).filter(
            (workspace) => !pinnedWorkspaceKeys.has(workspace.workspaceKey),
          ),
        )
      : [];

  const sections: SidebarShortcutSection[] = [];
  if (!input.pinnedCollapsed) {
    sections.push({ workspaces: pinnedGroups.pinnedChats });
  }
  if (input.groupMode === "status") {
    sections.push(
      ...statusGroups.map((group) => ({
        workspaces: group.rows,
        collapsed: input.collapsedStatusGroupKeys.has(group.bucket),
      })),
    );
  } else if (input.groupMode === "device") {
    sections.push(...deviceGroups.map((group) => ({ workspaces: group.rows })));
  } else {
    sections.push(
      ...pinnedGroups.unpinnedProjects.map((project) => ({
        workspaces: project.workspaces,
        collapsed: input.collapsedProjectKeys.has(project.projectKey),
      })),
    );
  }

  return {
    pinnedGroups,
    statusGroups,
    deviceGroups,
    shortcutModel: buildSidebarShortcutSections({ sections }),
  };
}

export function buildDeviceGroups(workspaces: SidebarWorkspaceEntry[]): SidebarDeviceGroup[] {
  const rowsByServerId = new Map<string, SidebarWorkspaceEntry[]>();
  for (const workspace of workspaces) {
    const rows = rowsByServerId.get(workspace.serverId) ?? [];
    rows.push(workspace);
    rowsByServerId.set(workspace.serverId, rows);
  }
  return Array.from(rowsByServerId, ([serverId, rows]) => ({
    serverId,
    rows: rows.sort((left, right) => {
      const projectOrder = left.projectName.localeCompare(right.projectName);
      return projectOrder || left.name.localeCompare(right.name);
    }),
  }));
}
