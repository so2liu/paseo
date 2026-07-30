import { createContext, useContext, type RefObject } from "react";
import type { View } from "react-native";

export interface MermaidViewportSnapshot {
  scrollY: number;
  viewportHeight: number;
}

export interface MermaidViewportSubscription {
  contentContainerRef: RefObject<View | null>;
  getSnapshot: () => MermaidViewportSnapshot;
  subscribe: (listener: (snapshot: MermaidViewportSnapshot) => void) => () => void;
  subscribeContentLayout: (listener: () => void) => () => void;
}

export const MermaidViewportContext = createContext<MermaidViewportSubscription | null>(null);

export function useMermaidViewport(): MermaidViewportSubscription | null {
  return useContext(MermaidViewportContext);
}
