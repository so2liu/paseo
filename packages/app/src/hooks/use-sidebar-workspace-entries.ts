import { useEffect, useMemo, useRef } from "react";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useCreateFlowStore } from "@/stores/create-flow-store";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceAttentionViewStore } from "@/stores/workspace-attention-view-store";
import {
  areSidebarWorkspaceSessionsEqual,
  buildSidebarWorkspaceEntries,
  selectSidebarWorkspaceSessions,
  type SidebarWorkspaceEntry,
  type SidebarWorkspacePlacement,
  type SidebarWorkspaceSession,
} from "./sidebar-workspaces-view-model";

const EMPTY_ENTRIES = new Map<string, SidebarWorkspaceEntry>();
const EMPTY_SESSIONS: SidebarWorkspaceSession[] = [];
const EMPTY_PENDING_CREATE_ATTEMPTS: Record<string, never> = {};
const EMPTY_SEEN_ATTENTION_MARKERS: Record<string, never> = {};

export function useSidebarWorkspaceEntries(
  placements: readonly SidebarWorkspacePlacement[],
  enabled = true,
): ReadonlyMap<string, SidebarWorkspaceEntry> {
  const serverIds = useMemo(
    () => Array.from(new Set(placements.map((placement) => placement.serverId))),
    [placements],
  );
  const sessions = useStoreWithEqualityFn(
    useSessionStore,
    (state) =>
      enabled ? selectSidebarWorkspaceSessions(state.sessions, serverIds) : EMPTY_SESSIONS,
    areSidebarWorkspaceSessionsEqual,
  );
  const pendingCreateAttempts = useCreateFlowStore((state) =>
    enabled ? state.pendingByDraftId : EMPTY_PENDING_CREATE_ATTEMPTS,
  );
  const attentionViewStoreHydrated = useWorkspaceAttentionViewStore((state) => state.hasHydrated);
  const seenAttentionMarkerByWorkspaceKey = useWorkspaceAttentionViewStore((state) =>
    enabled && state.hasHydrated ? state.seenMarkerByWorkspaceKey : EMPTY_SEEN_ATTENTION_MARKERS,
  );
  const clearAttentionSeen = useWorkspaceAttentionViewStore((state) => state.clearAttentionSeen);
  const previousEntriesRef = useRef<ReadonlyMap<string, SidebarWorkspaceEntry>>(EMPTY_ENTRIES);

  // Collection ownership is intentional: retained sidebars have one cheap
  // subscription to structurally shared indexes, never one session-store
  // subscription per mounted row.
  const entries = useMemo(() => {
    if (!enabled) {
      return previousEntriesRef.current;
    }
    if (placements.length === 0 || sessions.length === 0) {
      previousEntriesRef.current = EMPTY_ENTRIES;
      return EMPTY_ENTRIES;
    }
    const nextEntries = buildSidebarWorkspaceEntries({
      placements,
      sessions,
      pendingCreateAttempts,
      seenAttentionMarkerByWorkspaceKey,
      previousEntries: previousEntriesRef.current,
    });
    previousEntriesRef.current = nextEntries;
    return nextEntries;
  }, [enabled, pendingCreateAttempts, placements, seenAttentionMarkerByWorkspaceKey, sessions]);

  useEffect(() => {
    if (!enabled || !attentionViewStoreHydrated) {
      return;
    }
    const inactiveWorkspaceKeys = Array.from(entries.values())
      .filter((entry) => entry.statusBucket !== "attention")
      .map((entry) => entry.workspaceKey);
    clearAttentionSeen(inactiveWorkspaceKeys);
  }, [attentionViewStoreHydrated, clearAttentionSeen, enabled, entries]);

  return entries;
}
