import { createContext, useContext } from "react";

export interface MermaidViewportSnapshot {
  scrollY: number;
  viewportHeight: number;
}

export interface MermaidViewportSubscription {
  getSnapshot: () => MermaidViewportSnapshot;
  subscribe: (listener: (snapshot: MermaidViewportSnapshot) => void) => () => void;
}

export const MermaidViewportContext = createContext<MermaidViewportSubscription | null>(null);

export function useMermaidViewport(): MermaidViewportSubscription | null {
  return useContext(MermaidViewportContext);
}
