import {
  forwardRef,
  useCallback,
  useMemo,
  useRef,
  type ComponentProps,
  type RefObject,
} from "react";
import {
  ScrollView,
  View,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from "react-native";
import {
  MermaidViewportContext,
  type MermaidViewportSnapshot,
  type MermaidViewportSubscription,
} from "./mermaid-viewport-context";

type MermaidViewportScrollProps = ComponentProps<typeof ScrollView>;

function createViewportSubscription(
  contentContainerRef: RefObject<View | null>,
): MermaidViewportSubscription & {
  update: (snapshot: MermaidViewportSnapshot) => void;
} {
  let snapshot: MermaidViewportSnapshot = { scrollY: 0, viewportHeight: 0 };
  const listeners = new Set<(nextSnapshot: MermaidViewportSnapshot) => void>();

  return {
    contentContainerRef,
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    update(nextSnapshot) {
      if (
        snapshot.scrollY === nextSnapshot.scrollY &&
        snapshot.viewportHeight === nextSnapshot.viewportHeight
      ) {
        return;
      }
      snapshot = nextSnapshot;
      for (const listener of listeners) listener(snapshot);
    },
  };
}

export const MermaidViewportScroll = forwardRef<ScrollView, MermaidViewportScrollProps>(
  function MermaidViewportScroll({ onLayout, onScroll, scrollEventThrottle, ...props }, ref) {
    const contentContainerRef = useRef<View>(null);
    const viewport = useMemo(
      () => createViewportSubscription(contentContainerRef),
      [contentContainerRef],
    );
    const viewportHeightRef = useRef(0);
    const scrollYRef = useRef(0);

    const publishViewport = useCallback(() => {
      viewport.update({
        scrollY: scrollYRef.current,
        viewportHeight: viewportHeightRef.current,
      });
    }, [viewport]);

    const handleLayout = useCallback(
      (event: LayoutChangeEvent) => {
        viewportHeightRef.current = event.nativeEvent.layout.height;
        publishViewport();
        onLayout?.(event);
      },
      [onLayout, publishViewport],
    );

    const handleScroll = useCallback(
      (event: NativeSyntheticEvent<NativeScrollEvent>) => {
        scrollYRef.current = event.nativeEvent.contentOffset.y;
        publishViewport();
        onScroll?.(event);
      },
      [onScroll, publishViewport],
    );

    return (
      <MermaidViewportContext.Provider value={viewport}>
        <ScrollView
          {...props}
          ref={ref}
          innerViewRef={contentContainerRef as RefObject<View>}
          onLayout={handleLayout}
          onScroll={handleScroll}
          scrollEventThrottle={scrollEventThrottle ?? 100}
        />
      </MermaidViewportContext.Provider>
    );
  },
);
