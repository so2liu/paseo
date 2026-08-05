export interface NativeHistoryLayoutInvalidationController {
  observeViewportWidth(previousWidth: number, viewportWidth: number): void;
  settle(): number | null;
}

export function createNativeHistoryLayoutInvalidationController(): NativeHistoryLayoutInvalidationController {
  let committedWidth = 0;
  let pendingWidth: number | null = null;

  return {
    observeViewportWidth(previousWidth, viewportWidth) {
      if (previousWidth <= 0) {
        committedWidth = viewportWidth;
        pendingWidth = null;
        return;
      }
      if (previousWidth !== viewportWidth) {
        pendingWidth = viewportWidth;
      }
    },
    settle() {
      if (pendingWidth === null) {
        return null;
      }
      const settledWidth = pendingWidth;
      pendingWidth = null;
      if (settledWidth === committedWidth) {
        return null;
      }
      committedWidth = settledWidth;
      return settledWidth;
    },
  };
}
