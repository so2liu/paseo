import { useCallback, useMemo } from "react";
import { useHostRuntimeSnapshot, useHosts } from "@/runtime/host-runtime";
import { useDownloadStore } from "@/stores/download-store";
import { useFileExplorerActions } from "@/hooks/use-file-explorer-actions";
import { getIsElectron } from "@/constants/platform";
import { saveDesktopDownload } from "@/desktop/downloads";

interface UseFileDownloadParams {
  serverId: string;
  workspaceId?: string | null;
  workspaceRoot: string;
}

/**
 * Returns a stable callback that downloads a single workspace file by its
 * workspace-relative path. Shared by the file explorer tree and the git diff
 * pane so both surfaces download through the same host token + download-store
 * pipeline instead of duplicating the plumbing.
 */
export function useFileDownload({
  serverId,
  workspaceId,
  workspaceRoot,
}: UseFileDownloadParams): (input: { fileName: string; path: string }) => void {
  const daemons = useHosts();
  const daemonProfile = useMemo(
    () => daemons.find((daemon) => daemon.serverId === serverId),
    [daemons, serverId],
  );
  const hostSnapshot = useHostRuntimeSnapshot(serverId);
  const normalizedWorkspaceRoot = useMemo(() => workspaceRoot.trim(), [workspaceRoot]);
  const workspaceScopeId = useMemo(
    () => workspaceId?.trim() || normalizedWorkspaceRoot,
    [normalizedWorkspaceRoot, workspaceId],
  );
  const { readFileForDownload, requestFileDownloadToken } = useFileExplorerActions({
    serverId,
    workspaceId,
    workspaceRoot: normalizedWorkspaceRoot,
  });
  const startDownload = useDownloadStore((state) => state.startDownload);

  return useCallback(
    ({ fileName, path }) => {
      if (!workspaceScopeId) {
        return;
      }
      void startDownload({
        serverId,
        scopeId: workspaceScopeId,
        fileName,
        path,
        daemonProfile,
        activeConnectionType: hostSnapshot?.activeConnection?.type ?? null,
        isElectron: getIsElectron(),
        readFile: readFileForDownload,
        saveDesktopFile: saveDesktopDownload,
        requestFileDownloadToken: (targetPath) => requestFileDownloadToken(targetPath),
      });
    },
    [
      daemonProfile,
      hostSnapshot?.activeConnection?.type,
      readFileForDownload,
      requestFileDownloadToken,
      serverId,
      startDownload,
      workspaceScopeId,
    ],
  );
}
