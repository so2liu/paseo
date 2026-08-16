import { useCallback, useMemo } from "react";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";

export interface WorkspaceReviewStatusController {
  canMarkDone: boolean;
  canMarkReady: boolean;
  markDone: () => Promise<void>;
  markReady: () => Promise<void>;
}

export function useWorkspaceReviewStatus({
  serverId,
  workspaceId,
}: {
  serverId: string;
  workspaceId: string;
}): WorkspaceReviewStatusController {
  const status = useSessionStore(
    (state) => state.sessions[serverId]?.workspaces.get(workspaceId)?.status ?? null,
  );
  const supportsMarkReady = useHostFeature(serverId, "workspaceMarkReady");

  const getClient = useCallback(() => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    return client;
  }, [serverId]);

  const markDone = useCallback(async () => {
    if (status !== "attention" && status !== "failed") {
      return;
    }
    await getClient().clearWorkspaceAttention(workspaceId);
  }, [getClient, status, workspaceId]);

  const markReady = useCallback(async () => {
    if (status !== "done" || !supportsMarkReady) {
      return;
    }
    await getClient().markWorkspaceReady(workspaceId);
  }, [getClient, status, supportsMarkReady, workspaceId]);

  return useMemo(
    () => ({
      canMarkDone: status === "attention" || status === "failed",
      canMarkReady: status === "done" && supportsMarkReady,
      markDone,
      markReady,
    }),
    [markDone, markReady, status, supportsMarkReady],
  );
}
