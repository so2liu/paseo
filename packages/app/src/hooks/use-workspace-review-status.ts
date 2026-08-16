import { useCallback, useMemo, useRef } from "react";
import { i18n } from "@/i18n/i18next";
import { getHostRuntimeStore } from "@/runtime/host-runtime";

export interface WorkspaceReviewStatusController {
  canMarkDone: boolean;
  canMarkReady: boolean;
  markDone: () => Promise<void>;
  markReady: () => Promise<void>;
}

export function useWorkspaceReviewStatus({
  serverId,
  workspaceId,
  status,
  hasRootAgent,
  supportsMarkReady,
}: {
  serverId: string;
  workspaceId: string;
  status: "needs_input" | "failed" | "running" | "attention" | "done";
  hasRootAgent: boolean;
  supportsMarkReady: boolean;
}): WorkspaceReviewStatusController {
  const markDonePendingRef = useRef(false);
  const markReadyPendingRef = useRef(false);

  const getClient = useCallback(() => {
    const client = getHostRuntimeStore().getClient(serverId);
    if (!client) {
      throw new Error(i18n.t("workspace.terminal.hostDisconnected"));
    }
    return client;
  }, [serverId]);

  const markDone = useCallback(async () => {
    if (markDonePendingRef.current || (status !== "attention" && status !== "failed")) {
      return;
    }
    markDonePendingRef.current = true;
    try {
      await getClient().clearWorkspaceAttention(workspaceId);
    } finally {
      markDonePendingRef.current = false;
    }
  }, [getClient, status, workspaceId]);

  const markReady = useCallback(async () => {
    if (markReadyPendingRef.current || status !== "done" || !supportsMarkReady || !hasRootAgent) {
      return;
    }
    markReadyPendingRef.current = true;
    try {
      await getClient().markWorkspaceReady(workspaceId);
    } finally {
      markReadyPendingRef.current = false;
    }
  }, [getClient, hasRootAgent, status, supportsMarkReady, workspaceId]);

  return useMemo(
    () => ({
      canMarkDone: status === "attention" || status === "failed",
      canMarkReady: status === "done" && supportsMarkReady && hasRootAgent,
      markDone,
      markReady,
    }),
    [hasRootAgent, markDone, markReady, status, supportsMarkReady],
  );
}
