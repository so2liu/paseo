import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { WorkspaceDescriptor } from "@/stores/session-store";

const LEGACY_ATTENTION_MARKER = "legacy";

interface WorkspaceAttentionViewStoreState {
  seenMarkerByWorkspaceKey: Record<string, string>;
  hasHydrated: boolean;
  markAttentionSeen: (workspaceKey: string, statusEnteredAt: Date | null) => void;
  clearAttentionSeen: (workspaceKeys: readonly string[]) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

export function getWorkspaceAttentionMarker(statusEnteredAt: Date | null): string {
  if (!statusEnteredAt || !Number.isFinite(statusEnteredAt.getTime())) {
    return LEGACY_ATTENTION_MARKER;
  }
  return statusEnteredAt.toISOString();
}

export function hasUnreadWorkspaceAttention(input: {
  status: WorkspaceDescriptor["status"];
  statusEnteredAt: Date | null;
  seenMarker?: string;
}): boolean {
  return (
    input.status === "attention" &&
    input.seenMarker !== getWorkspaceAttentionMarker(input.statusEnteredAt)
  );
}

export const useWorkspaceAttentionViewStore = create<WorkspaceAttentionViewStoreState>()(
  persist(
    (set) => ({
      seenMarkerByWorkspaceKey: {},
      hasHydrated: false,
      markAttentionSeen: (workspaceKey, statusEnteredAt) =>
        set((state) => {
          const marker = getWorkspaceAttentionMarker(statusEnteredAt);
          if (state.seenMarkerByWorkspaceKey[workspaceKey] === marker) {
            return state;
          }
          return {
            seenMarkerByWorkspaceKey: {
              ...state.seenMarkerByWorkspaceKey,
              [workspaceKey]: marker,
            },
          };
        }),
      clearAttentionSeen: (workspaceKeys) =>
        set((state) => {
          const keysToClear = workspaceKeys.filter(
            (workspaceKey) => workspaceKey in state.seenMarkerByWorkspaceKey,
          );
          if (keysToClear.length === 0) {
            return state;
          }
          const nextSeenMarkers = { ...state.seenMarkerByWorkspaceKey };
          for (const workspaceKey of keysToClear) {
            delete nextSeenMarkers[workspaceKey];
          }
          return { seenMarkerByWorkspaceKey: nextSeenMarkers };
        }),
      setHasHydrated: (hasHydrated) => set({ hasHydrated }),
    }),
    {
      name: "workspace-attention-view",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        seenMarkerByWorkspaceKey: state.seenMarkerByWorkspaceKey,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    },
  ),
);
