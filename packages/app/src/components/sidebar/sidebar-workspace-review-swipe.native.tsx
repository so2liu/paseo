import { useCallback, useRef, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import ReanimatedSwipeable, {
  type SwipeableMethods,
} from "react-native-gesture-handler/ReanimatedSwipeable";
import { StyleSheet } from "react-native-unistyles";

export function SidebarWorkspaceReviewSwipe({
  children,
  onMarkDone,
}: {
  children: ReactNode;
  onMarkDone?: () => void;
}) {
  const swipeableRef = useRef<SwipeableMethods>(null);
  const handleDone = useCallback(() => {
    swipeableRef.current?.close();
    onMarkDone?.();
  }, [onMarkDone]);
  const renderRightActions = useCallback(
    () => (
      <View style={styles.actionContainer}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Mark workspace as done"
          style={styles.action}
          onPress={handleDone}
          testID="sidebar-workspace-swipe-mark-done"
        >
          <Text style={styles.actionText}>Done</Text>
        </Pressable>
      </View>
    ),
    [handleDone],
  );

  if (!onMarkDone) return children;
  return (
    <ReanimatedSwipeable
      ref={swipeableRef}
      friction={2}
      rightThreshold={36}
      overshootRight={false}
      renderRightActions={renderRightActions}
    >
      {children}
    </ReanimatedSwipeable>
  );
}

const styles = StyleSheet.create((theme) => ({
  actionContainer: { width: 76, paddingVertical: 2 },
  action: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.palette.green[600],
    borderRadius: 6,
  },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "600" },
}));
