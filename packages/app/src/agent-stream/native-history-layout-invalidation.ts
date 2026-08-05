export interface NativeHistoryLayoutInvalidationController {
  observeViewportWidth(previousWidth: number, viewportWidth: number): boolean;
  settle(): boolean;
}

export function createNativeHistoryLayoutInvalidationController(): NativeHistoryLayoutInvalidationController {
  let committedWidth: number | null = null;
  let pendingWidth: number | null = null;
  let forcePendingInvalidation = false;
  let observedZeroWidthBeforeInitialReveal = false;

  return {
    observeViewportWidth(previousWidth, viewportWidth) {
      if (viewportWidth <= 0) {
        if (committedWidth === null) {
          observedZeroWidthBeforeInitialReveal = true;
        }
        pendingWidth = null;
        forcePendingInvalidation = false;
        return false;
      }
      if (committedWidth === null) {
        committedWidth = viewportWidth;
        pendingWidth = observedZeroWidthBeforeInitialReveal ? viewportWidth : null;
        forcePendingInvalidation = observedZeroWidthBeforeInitialReveal;
        observedZeroWidthBeforeInitialReveal = false;
        return forcePendingInvalidation;
      }
      if (previousWidth <= 0) {
        pendingWidth = viewportWidth;
        forcePendingInvalidation = true;
        return true;
      }
      if (previousWidth !== viewportWidth) {
        pendingWidth = viewportWidth;
        return true;
      }
      return false;
    },
    settle() {
      if (pendingWidth === null) {
        return false;
      }
      const settledWidth = pendingWidth;
      pendingWidth = null;
      const shouldInvalidate = forcePendingInvalidation || settledWidth !== committedWidth;
      forcePendingInvalidation = false;
      committedWidth = settledWidth;
      return shouldInvalidate;
    },
  };
}
