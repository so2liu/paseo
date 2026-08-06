import React, {
  type CSSProperties,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { measureElement as measureVirtualElement, useVirtualizer } from "@tanstack/react-virtual";
import { withUnistyles } from "react-native-unistyles";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useStableEvent } from "@/hooks/use-stable-event";
import type { Theme } from "@/styles/theme";
import { estimateStreamItemHeight } from "./web-virtualization";
import type { StreamRenderInput, StreamStrategy, StreamViewportHandle } from "./strategy";
import { createStreamStrategy } from "./strategy";
import {
  createHistoryStartPaginationState,
  disarmHistoryStartPagination,
  evaluateHistoryStartPagination,
  rearmHistoryStartPagination,
} from "./history-start-pagination";

interface CreateWebStreamStrategyInput {
  isMobileBreakpoint: boolean;
}

type ScrollBehaviorLike = "auto" | "smooth";

const WEB_BOTTOM_SETTLE_TIMEOUT_MS = 200;
const USER_SCROLL_DELTA_EPSILON = 1;
const BOTTOM_OVERSCROLL_TOLERANCE_PX = 2;
const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const AUTO_SCROLL_RESUME_THRESHOLD_PX = 1;
const TOUCH_SCROLL_SETTLE_TIMEOUT_MS = 120;
const WHEEL_SCROLL_SETTLE_TIMEOUT_MS = 120;

type WebHistoryInputKind = "keyboard" | "pointer" | "touch" | "wheel";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

const historyStartSlotStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  minHeight: 32,
  paddingTop: 4,
  paddingBottom: 8,
};

const streamRowContainerStyle: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
};

function isScrollContainerNearBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
  thresholdPx = AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
): boolean {
  const threshold = Number.isFinite(thresholdPx)
    ? Math.max(0, thresholdPx)
    : AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
  const { scrollTop, clientHeight, scrollHeight } = scrollContainer;
  if (![scrollTop, clientHeight, scrollHeight].every(Number.isFinite)) {
    return true;
  }
  const distanceFromBottom = scrollHeight - clientHeight - scrollTop;
  return distanceFromBottom <= threshold;
}

function isScrollContainerAtBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  return isScrollContainerNearBottom(scrollContainer, AUTO_SCROLL_RESUME_THRESHOLD_PX);
}

function isEditableEventTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, [contenteditable]:not([contenteditable='false'])") !== null
  );
}

function scrollElementToBottom(
  scrollContainer: HTMLElement,
  behavior: ScrollBehaviorLike = "auto",
): void {
  scrollContainer.scrollTo({
    top: scrollContainer.scrollHeight,
    behavior,
  });
}

function syncNearBottom(
  scrollContainer: HTMLElement | null,
  onNearBottomChange: (value: boolean) => void,
): boolean {
  if (!scrollContainer) {
    onNearBottomChange(true);
    return true;
  }
  const nextValue = isScrollContainerNearBottom(scrollContainer);
  onNearBottomChange(nextValue);
  return nextValue;
}

function getScrollContainerDistanceFromBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): number {
  return scrollContainer.scrollHeight - scrollContainer.clientHeight - scrollContainer.scrollTop;
}

function isScrollContainerOverscrolledPastBottom(
  scrollContainer: Pick<HTMLElement, "scrollTop" | "clientHeight" | "scrollHeight">,
): boolean {
  // Browser zoom can leave scrollTop fractional while the height metrics remain integer-valued.
  return getScrollContainerDistanceFromBottom(scrollContainer) < -BOTTOM_OVERSCROLL_TOLERANCE_PX;
}

function WebStreamViewport(props: StreamRenderInput & { isMobileBreakpoint: boolean }) {
  const {
    segments,
    liveHeadRowRevision,
    boundary,
    renderers,
    listEmptyComponent,
    viewportRef,
    routeBottomAnchorRequest,
    isAuthoritativeHistoryReady,
    onNearBottomChange,
    onNearHistoryStart,
    isLoadingOlderHistory,
    hasOlderHistory,
    olderHistoryProgressKey,
    scrollEnabled,
    isMobileBreakpoint,
  } = props;
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLElement | null>(null);
  const handleScrollContainerRef = useCallback((node: HTMLElement | null) => {
    scrollContainerRef.current = node;
  }, []);
  const handleContentRef = useCallback((node: HTMLElement | null) => {
    contentRef.current = node;
  }, []);
  const [followOutput, setFollowOutputr] = useState(true);
  const followOutputRef = useRef(followOutput);
  const setFollowOutput = (value: boolean) => {
    followOutputRef.current = value;
    setFollowOutputr(value);
    return value;
  };
  const lastKnownScrollTopRef = useRef(0);
  const pendingUserScrollUpIntentRef = useRef(false);
  const touchStartClientYRef = useRef<number | null>(null);
  const activeHistoryInputRef = useRef<WebHistoryInputKind | null>(null);
  const activeKeyboardKeyRef = useRef<string | null>(null);
  const historyPaginationArmedForInputRef = useRef(false);
  const historyPaginationConsumedForInputRef = useRef(false);
  const pendingWheelInputEndTimeoutRef = useRef<number | null>(null);
  const pendingTouchInputEndTimeoutRef = useRef<number | null>(null);
  const pendingAutoScrollFrameRef = useRef<number | null>(null);
  const pendingAutoScrollTimeoutRef = useRef<number | null>(null);
  const pendingVirtualRowMeasureFramesRef = useRef(new Map<Element, number>());
  const historyStartReadyRef = useRef(false);
  const historyStartPaginationStateRef = useRef(createHistoryStartPaginationState());
  const isLoadingOlderHistoryRef = useRef(isLoadingOlderHistory);
  const shouldUseVirtualizer = segments.historyVirtualized.length > 0;
  const {
    renderHistoryVirtualizedRow,
    renderHistoryMountedRow,
    renderLiveHeadRow,
    renderLiveAuxiliary,
  } = renderers;

  followOutputRef.current = followOutput;
  isLoadingOlderHistoryRef.current = isLoadingOlderHistory;

  const hasRouteBottomAnchorRequest = routeBottomAnchorRequest !== null;
  const activationKey = routeBottomAnchorRequest?.requestKey ?? props.agentId;
  const isActivationReady = !hasRouteBottomAnchorRequest || isAuthoritativeHistoryReady;

  const rowVirtualizer = useVirtualizer({
    count: segments.historyVirtualized.length,
    enabled: shouldUseVirtualizer,
    getScrollElement: () => scrollContainerRef.current,
    getItemKey: (index: number) => segments.historyVirtualized[index]?.id ?? index,
    estimateSize: (index: number) => {
      const row = segments.historyVirtualized[index];
      return row ? estimateStreamItemHeight(row) : 120;
    },
    measureElement: measureVirtualElement,
    useAnimationFrameWithResizeObserver: true,
    overscan: 8,
  });
  useEffect(() => {
    rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (_item, _delta, instance) => {
      const viewportHeight = instance.scrollRect?.height ?? 0;
      const scrollOffset = instance.scrollOffset ?? 0;
      const remainingDistance = instance.getTotalSize() - (scrollOffset + viewportHeight);
      return remainingDistance > AUTO_SCROLL_BOTTOM_THRESHOLD_PX;
    };
    return () => {
      rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = undefined;
    };
  }, [rowVirtualizer]);
  const virtualRows = rowVirtualizer.getVirtualItems();
  const virtualTotalSize = rowVirtualizer.getTotalSize();
  const evaluateHistoryStart = useStableEvent(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }
    const bottomAnchorSettled =
      !followOutputRef.current || isScrollContainerNearBottom(scrollContainer);
    const result = evaluateHistoryStartPagination(historyStartPaginationStateRef.current, {
      distanceFromHistoryStart: scrollContainer.scrollTop,
      hasOlderHistory,
      isLoadingOlderHistory,
      isReady: historyStartReadyRef.current && bottomAnchorSettled,
      progressKey: olderHistoryProgressKey,
    });
    historyStartPaginationStateRef.current = result.state;
    if (result.shouldLoad) {
      historyPaginationConsumedForInputRef.current = true;
      onNearHistoryStart();
    }
  });

  const disarmHistoryInput = useCallback((kind?: WebHistoryInputKind) => {
    if (kind !== undefined && activeHistoryInputRef.current !== kind) {
      return;
    }
    const wheelEndTimeout = pendingWheelInputEndTimeoutRef.current;
    if (wheelEndTimeout !== null) {
      pendingWheelInputEndTimeoutRef.current = null;
      window.clearTimeout(wheelEndTimeout);
    }
    const touchEndTimeout = pendingTouchInputEndTimeoutRef.current;
    if (touchEndTimeout !== null) {
      pendingTouchInputEndTimeoutRef.current = null;
      window.clearTimeout(touchEndTimeout);
    }
    activeHistoryInputRef.current = null;
    activeKeyboardKeyRef.current = null;
    historyPaginationArmedForInputRef.current = false;
    historyPaginationConsumedForInputRef.current = false;
    pendingUserScrollUpIntentRef.current = false;
    historyStartPaginationStateRef.current = disarmHistoryStartPagination(
      historyStartPaginationStateRef.current,
    );
  }, []);

  const beginHistoryInput = useCallback(
    (kind: WebHistoryInputKind, armPagination: boolean, forceNew = false) => {
      if (forceNew) {
        disarmHistoryInput();
      }
      if (activeHistoryInputRef.current !== kind) {
        activeHistoryInputRef.current = kind;
        historyPaginationArmedForInputRef.current = false;
        historyPaginationConsumedForInputRef.current = false;
      }
      if (
        armPagination &&
        !historyPaginationArmedForInputRef.current &&
        !historyPaginationConsumedForInputRef.current &&
        !isLoadingOlderHistoryRef.current
      ) {
        historyStartPaginationStateRef.current = rearmHistoryStartPagination(
          historyStartPaginationStateRef.current,
        );
        historyPaginationArmedForInputRef.current = true;
      }
    },
    [disarmHistoryInput],
  );

  const scheduleTouchHistoryInputEnd = useCallback(() => {
    const pendingTimeout = pendingTouchInputEndTimeoutRef.current;
    if (pendingTimeout !== null) {
      window.clearTimeout(pendingTimeout);
    }
    pendingTouchInputEndTimeoutRef.current = window.setTimeout(() => {
      pendingTouchInputEndTimeoutRef.current = null;
      disarmHistoryInput("touch");
    }, TOUCH_SCROLL_SETTLE_TIMEOUT_MS);
  }, [disarmHistoryInput]);

  const measureVirtualizedRowElement = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node) {
        rowVirtualizer.measureElement(null);
        return;
      }
      const pendingFrames = pendingVirtualRowMeasureFramesRef.current;
      const existingFrame = pendingFrames.get(node);
      if (existingFrame !== undefined) {
        window.cancelAnimationFrame(existingFrame);
      }
      const frame = window.requestAnimationFrame(() => {
        pendingFrames.delete(node);
        if (node.isConnected) {
          rowVirtualizer.measureElement(node);
        }
      });
      pendingFrames.set(node, frame);
    },
    [rowVirtualizer],
  );

  useEffect(() => {
    const pendingFrames = pendingVirtualRowMeasureFramesRef.current;
    return () => {
      for (const frame of pendingFrames.values()) {
        window.cancelAnimationFrame(frame);
      }
      pendingFrames.clear();
    };
  }, []);

  const cancelPendingStickToBottom = useCallback(() => {
    const pendingFrame = pendingAutoScrollFrameRef.current;
    if (pendingFrame !== null) {
      pendingAutoScrollFrameRef.current = null;
      window.cancelAnimationFrame(pendingFrame);
    }
    const pendingTimeout = pendingAutoScrollTimeoutRef.current;
    if (pendingTimeout !== null) {
      pendingAutoScrollTimeoutRef.current = null;
      window.clearTimeout(pendingTimeout);
    }
  }, []);

  const scrollMessagesToBottom = useCallback(
    (behavior: ScrollBehaviorLike = "auto") => {
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerOverscrolledPastBottom(scrollContainer)) {
        return;
      }
      scrollElementToBottom(scrollContainer, behavior);
      lastKnownScrollTopRef.current = scrollContainer.scrollTop;
      syncNearBottom(scrollContainer, onNearBottomChange);
      evaluateHistoryStart();
    },
    [evaluateHistoryStart, onNearBottomChange],
  );

  const scheduleStickToBottom = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (scrollContainer && isScrollContainerOverscrolledPastBottom(scrollContainer)) {
      return;
    }
    if (pendingAutoScrollFrameRef.current !== null) {
      return;
    }
    pendingAutoScrollFrameRef.current = window.requestAnimationFrame(() => {
      pendingAutoScrollFrameRef.current = null;
      if (!followOutputRef.current) {
        return;
      }
      scrollMessagesToBottom("auto");
    });
  }, [scrollMessagesToBottom]);

  const forceStickToBottom = useCallback(() => {
    cancelPendingStickToBottom();
    scrollMessagesToBottom("auto");
    scheduleStickToBottom();
  }, [cancelPendingStickToBottom, scheduleStickToBottom, scrollMessagesToBottom]);

  const updateScrollMetrics = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      onNearBottomChange(true);
      return;
    }
    syncNearBottom(scrollContainer, onNearBottomChange);
  }, [onNearBottomChange]);

  const handleDomScroll = useCallback(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const currentScrollTop = scrollContainer.scrollTop;
    const isAtBottom = isScrollContainerAtBottom(scrollContainer);
    const scrolledUp = currentScrollTop < lastKnownScrollTopRef.current - USER_SCROLL_DELTA_EPSILON;
    const scrolledDown =
      currentScrollTop > lastKnownScrollTopRef.current + USER_SCROLL_DELTA_EPSILON;

    const hasExplicitUpwardInput =
      pendingUserScrollUpIntentRef.current || activeHistoryInputRef.current !== null;

    if (scrolledUp && hasExplicitUpwardInput) {
      beginHistoryInput(activeHistoryInputRef.current ?? "pointer", true);
      cancelPendingStickToBottom();
      if (followOutputRef.current) {
        setFollowOutput(false);
      }
      pendingUserScrollUpIntentRef.current = false;
    } else if (!followOutputRef.current && isAtBottom && scrolledDown) {
      setFollowOutput(true);
      disarmHistoryInput();
    } else if (scrolledDown) {
      historyStartPaginationStateRef.current = disarmHistoryStartPagination(
        historyStartPaginationStateRef.current,
      );
      historyPaginationArmedForInputRef.current = historyPaginationConsumedForInputRef.current;
      pendingUserScrollUpIntentRef.current = false;
    } else if (followOutputRef.current && pendingUserScrollUpIntentRef.current) {
      if (!isAtBottom) {
        cancelPendingStickToBottom();
        setFollowOutput(false);
      }
      pendingUserScrollUpIntentRef.current = false;
    }

    lastKnownScrollTopRef.current = currentScrollTop;
    updateScrollMetrics();
    evaluateHistoryStart();
    if (activeHistoryInputRef.current === "touch" && touchStartClientYRef.current === null) {
      scheduleTouchHistoryInputEnd();
    }
  }, [
    beginHistoryInput,
    cancelPendingStickToBottom,
    disarmHistoryInput,
    evaluateHistoryStart,
    scheduleTouchHistoryInputEnd,
    updateScrollMetrics,
  ]);

  useEffect(() => {
    historyStartPaginationStateRef.current = createHistoryStartPaginationState();
    disarmHistoryInput();
    const frame = window.requestAnimationFrame(() => {
      historyStartReadyRef.current = true;
      evaluateHistoryStart();
    });
    return () => {
      window.cancelAnimationFrame(frame);
      historyStartReadyRef.current = false;
    };
  }, [disarmHistoryInput, evaluateHistoryStart, props.agentId]);

  useLayoutEffect(() => {
    if (!isActivationReady) {
      return;
    }
    if (hasRouteBottomAnchorRequest && !followOutputRef.current) {
      return;
    }
    setFollowOutput(true);
    forceStickToBottom();
    const timeout = window.setTimeout(() => {
      if (!followOutputRef.current) {
        return;
      }
      const scrollContainer = scrollContainerRef.current;
      if (!scrollContainer) {
        return;
      }
      if (isScrollContainerNearBottom(scrollContainer)) {
        return;
      }
      scheduleStickToBottom();
    }, WEB_BOTTOM_SETTLE_TIMEOUT_MS);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [
    activationKey,
    forceStickToBottom,
    hasRouteBottomAnchorRequest,
    isActivationReady,
    scheduleStickToBottom,
  ]);

  useEffect(() => {
    if (!followOutputRef.current) {
      return;
    }
    scheduleStickToBottom();
  }, [
    scheduleStickToBottom,
    segments.historyMounted,
    segments.historyVirtualized,
    segments.liveHead,
  ]);

  useEffect(() => {
    if (!followOutputRef.current || !shouldUseVirtualizer) {
      return;
    }
    scheduleStickToBottom();
  }, [scheduleStickToBottom, shouldUseVirtualizer, virtualTotalSize]);

  useEffect(() => {
    updateScrollMetrics();
    evaluateHistoryStart();
  }, [
    evaluateHistoryStart,
    hasOlderHistory,
    isLoadingOlderHistory,
    olderHistoryProgressKey,
    segments.historyMounted.length,
    segments.historyVirtualized.length,
    segments.liveHead.length,
    updateScrollMetrics,
    virtualTotalSize,
  ]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    const contentNode = contentRef.current;
    if (!scrollContainer || typeof ResizeObserver === "undefined") {
      return;
    }

    updateScrollMetrics();
    evaluateHistoryStart();
    const observer = new ResizeObserver(() => {
      updateScrollMetrics();
      evaluateHistoryStart();
      if (!followOutputRef.current) {
        return;
      }
      scheduleStickToBottom();
    });
    observer.observe(scrollContainer);
    if (contentNode) {
      observer.observe(contentNode);
    }
    return () => {
      observer.disconnect();
    };
  }, [evaluateHistoryStart, scheduleStickToBottom, updateScrollMetrics]);

  useEffect(() => {
    const scrollContainer = scrollContainerRef.current;
    if (!scrollContainer) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      if (event.ctrlKey) {
        return;
      }
      if (event.deltaY < 0) {
        const wheelEndTimeout = pendingWheelInputEndTimeoutRef.current;
        if (wheelEndTimeout !== null) {
          pendingWheelInputEndTimeoutRef.current = null;
          window.clearTimeout(wheelEndTimeout);
        }
        beginHistoryInput("wheel", true);
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
        evaluateHistoryStart();
        pendingWheelInputEndTimeoutRef.current = window.setTimeout(() => {
          pendingWheelInputEndTimeoutRef.current = null;
          disarmHistoryInput("wheel");
        }, WHEEL_SCROLL_SETTLE_TIMEOUT_MS);
      } else if (event.deltaY > 0) {
        disarmHistoryInput();
      }
    };
    const handleTouchStart = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      beginHistoryInput("touch", false, true);
      touchStartClientYRef.current = touch.clientY;
    };
    const handleTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) {
        return;
      }
      const touchStartY = touchStartClientYRef.current;
      if (touchStartY !== null && touch.clientY > touchStartY + 1) {
        beginHistoryInput("touch", true);
        pendingUserScrollUpIntentRef.current = true;
        cancelPendingStickToBottom();
        evaluateHistoryStart();
      } else if (touchStartY !== null && touch.clientY < touchStartY - 1) {
        historyStartPaginationStateRef.current = disarmHistoryStartPagination(
          historyStartPaginationStateRef.current,
        );
        historyPaginationArmedForInputRef.current = historyPaginationConsumedForInputRef.current;
        pendingUserScrollUpIntentRef.current = false;
      }
    };
    const handleTouchEnd = () => {
      touchStartClientYRef.current = null;
      scheduleTouchHistoryInputEnd();
    };
    const handleTouchCancel = () => {
      touchStartClientYRef.current = null;
      disarmHistoryInput("touch");
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        return;
      }
      beginHistoryInput("pointer", false, true);
    };
    const handlePointerUp = () => {
      disarmHistoryInput("pointer");
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableEventTarget(event.target)) {
        return;
      }
      const isUpwardKey =
        event.key === "ArrowUp" ||
        event.key === "PageUp" ||
        event.key === "Home" ||
        (event.key === " " && event.shiftKey);
      if (!isUpwardKey) {
        return;
      }
      if (
        activeHistoryInputRef.current === "keyboard" &&
        activeKeyboardKeyRef.current !== event.key
      ) {
        return;
      }
      activeKeyboardKeyRef.current = event.key;
      // Key repeat belongs to the same held-key gesture. Re-arm only after keyup.
      beginHistoryInput("keyboard", true);
      pendingUserScrollUpIntentRef.current = true;
      cancelPendingStickToBottom();
      evaluateHistoryStart();
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (activeKeyboardKeyRef.current !== event.key) {
        return;
      }
      disarmHistoryInput("keyboard");
    };
    const handleWindowBlur = () => {
      disarmHistoryInput();
    };

    scrollContainer.addEventListener("scroll", handleDomScroll, { passive: true });
    scrollContainer.addEventListener("wheel", handleWheel, { passive: true });
    scrollContainer.addEventListener("pointerdown", handlePointerDown, { passive: true });
    scrollContainer.addEventListener("keydown", handleKeyDown, { passive: true });
    window.addEventListener("pointerup", handlePointerUp, { passive: true });
    window.addEventListener("pointercancel", handlePointerUp, { passive: true });
    window.addEventListener("keyup", handleKeyUp, { passive: true });
    window.addEventListener("blur", handleWindowBlur, { passive: true });
    scrollContainer.addEventListener("touchstart", handleTouchStart, { passive: true });
    scrollContainer.addEventListener("touchmove", handleTouchMove, { passive: true });
    scrollContainer.addEventListener("touchend", handleTouchEnd, { passive: true });
    scrollContainer.addEventListener("touchcancel", handleTouchCancel, { passive: true });

    return () => {
      scrollContainer.removeEventListener("scroll", handleDomScroll);
      scrollContainer.removeEventListener("wheel", handleWheel);
      scrollContainer.removeEventListener("pointerdown", handlePointerDown);
      scrollContainer.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleWindowBlur);
      scrollContainer.removeEventListener("touchstart", handleTouchStart);
      scrollContainer.removeEventListener("touchmove", handleTouchMove);
      scrollContainer.removeEventListener("touchend", handleTouchEnd);
      scrollContainer.removeEventListener("touchcancel", handleTouchCancel);
      disarmHistoryInput();
    };
  }, [
    beginHistoryInput,
    cancelPendingStickToBottom,
    disarmHistoryInput,
    evaluateHistoryStart,
    handleDomScroll,
    scheduleTouchHistoryInputEnd,
  ]);

  useEffect(() => {
    const handle: StreamViewportHandle = {
      scrollToBottom: () => {
        setFollowOutput(true);
        cancelPendingStickToBottom();
        forceStickToBottom();
      },
      scrollToItem: (itemId) => {
        setFollowOutput(false);
        cancelPendingStickToBottom();
        const virtualIndex = segments.historyVirtualized.findIndex((item) => item.id === itemId);
        if (virtualIndex >= 0) {
          rowVirtualizer.scrollToIndex(virtualIndex, { align: "center", behavior: "smooth" });
          return;
        }
        const element = Array.from(
          contentRef.current?.querySelectorAll<HTMLElement>("[data-stream-item-id]") ?? [],
        ).find((candidate) => candidate.dataset.streamItemId === itemId);
        element?.scrollIntoView({ behavior: "smooth", block: "center" });
      },
      prepareForViewportChange: () => {
        if (!followOutputRef.current) {
          return;
        }
        scheduleStickToBottom();
      },
    };
    viewportRef.current = handle;
    return () => {
      if (viewportRef.current === handle) {
        viewportRef.current = null;
      }
      cancelPendingStickToBottom();
    };
  }, [
    cancelPendingStickToBottom,
    forceStickToBottom,
    rowVirtualizer,
    scheduleStickToBottom,
    segments.historyVirtualized,
    viewportRef,
  ]);

  const contentContainerStyle = useMemo((): CSSProperties => {
    return {
      display: "flex",
      flexDirection: "column",
      minHeight: "100%",
      paddingTop: 16,
      paddingBottom: 16,
      paddingLeft: isMobileBreakpoint ? 8 : 16,
      paddingRight: isMobileBreakpoint ? 8 : 16,
      boxSizing: "border-box",
    };
  }, [isMobileBreakpoint]);
  const scrollContainerStyle = useMemo((): CSSProperties => {
    return {
      flex: 1,
      minHeight: 0,
      overflowX: "hidden",
      overflowY: scrollEnabled ? "auto" : "hidden",
      overscrollBehaviorY: "contain",
    };
  }, [scrollEnabled]);
  const virtualRowsContainerStyle = useMemo((): CSSProperties => {
    return {
      position: "relative",
      width: "100%",
      height: virtualTotalSize,
    };
  }, [virtualTotalSize]);
  const renderVirtualRowStyle = useCallback(
    (start: number): CSSProperties => ({
      position: "absolute",
      top: 0,
      left: 0,
      display: "flex",
      flexDirection: "column",
      width: "100%",
      transform: `translateY(${start}px)`,
    }),
    [],
  );
  const mountedHistoryRows = useMemo(() => {
    return segments.historyMounted.map((item, index) => (
      <div key={item.id} data-stream-item-id={item.id} style={streamRowContainerStyle}>
        {renderHistoryMountedRow(item, index, segments.historyMounted)}
      </div>
    ));
  }, [renderHistoryMountedRow, segments.historyMounted]);
  const liveHeadRows = useMemo(() => {
    void liveHeadRowRevision;
    return segments.liveHead.map((item, index) => (
      <div key={item.id} data-stream-item-id={item.id} style={streamRowContainerStyle}>
        {renderLiveHeadRow(item, index, segments.liveHead)}
      </div>
    ));
  }, [liveHeadRowRevision, renderLiveHeadRow, segments.liveHead]);
  const liveAuxiliary = useMemo(() => {
    return renderLiveAuxiliary();
  }, [renderLiveAuxiliary]);
  const historyStartSlot = useMemo(() => {
    if (!hasOlderHistory && !isLoadingOlderHistory) {
      return null;
    }
    return (
      <div
        style={historyStartSlotStyle}
        data-testid={isLoadingOlderHistory ? "load-older-history-spinner" : undefined}
      >
        {isLoadingOlderHistory ? (
          <ThemedLoadingSpinner size="small" uniProps={foregroundMutedColorMapping} />
        ) : null}
      </div>
    );
  }, [hasOlderHistory, isLoadingOlderHistory]);
  const shouldRenderEmpty =
    !boundary.hasMountedHistory &&
    !boundary.hasVirtualizedHistory &&
    !boundary.hasLiveHead &&
    !liveAuxiliary;

  return (
    <div
      ref={handleScrollContainerRef}
      data-testid="agent-chat-scroll"
      tabIndex={0}
      id={`agent-chat-scroll-${shouldUseVirtualizer ? "web-dom-virtualized" : "web-dom-scroll"}`}
      style={scrollContainerStyle}
    >
      <div ref={handleContentRef} style={contentContainerStyle}>
        {historyStartSlot}
        {shouldUseVirtualizer ? (
          <div style={virtualRowsContainerStyle}>
            {virtualRows.map((virtualRow) => {
              const item = segments.historyVirtualized[virtualRow.index];
              if (!item) {
                return null;
              }
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={measureVirtualizedRowElement}
                  style={renderVirtualRowStyle(virtualRow.start)}
                >
                  {renderHistoryVirtualizedRow(item, virtualRow.index, segments.historyVirtualized)}
                </div>
              );
            })}
          </div>
        ) : null}
        {mountedHistoryRows}
        {liveHeadRows}
        {liveAuxiliary}
        {shouldRenderEmpty ? listEmptyComponent : null}
      </div>
    </div>
  );
}

export function createWebStreamStrategy(input: CreateWebStreamStrategyInput): StreamStrategy {
  return createStreamStrategy({
    render: (renderInput) => (
      <WebStreamViewport
        key={renderInput.agentId}
        {...renderInput}
        isMobileBreakpoint={input.isMobileBreakpoint}
      />
    ),
    orderTailReverse: false,
    orderHeadReverse: false,
    assistantTurnTraversalStep: -1,
    edgeSlot: "footer",
    historyLiveBoundaryEdge: "last",
    liveHeadHistoryBoundaryEdge: "first",
    frameChildOrder: "content-then-footer",
    flatListInverted: false,
    overlayScrollbarInverted: false,
    maintainVisibleContentPosition: undefined,
    bottomAnchorTransportBehavior: {
      verificationDelayFrames: 0,
      verificationRetryMode: "rescroll",
    },
    disableParentScrollOnInlineDetailsExpansion: false,
    anchorBottomOnContentSizeChange: true,
    animateManualScrollToBottom: false,
    useVirtualizedList: false,
    isNearBottom: (inputMetrics) => {
      const distanceFromBottom = Math.max(
        0,
        inputMetrics.contentHeight - (inputMetrics.offsetY + inputMetrics.viewportHeight),
      );
      return distanceFromBottom <= inputMetrics.threshold;
    },
    getBottomOffset: (metrics) => Math.max(0, metrics.contentHeight - metrics.viewportHeight),
  });
}
