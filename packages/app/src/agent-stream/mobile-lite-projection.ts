import type { StreamItem } from "@/types/stream";

export function isMobileLiteStreamItem(item: StreamItem): boolean {
  return (
    item.kind === "user_message" ||
    item.kind === "assistant_message" ||
    (item.kind === "activity_log" && item.activityType === "error")
  );
}

export function projectMobileLiteStream(items: StreamItem[]): StreamItem[] {
  const projected = items.filter(isMobileLiteStreamItem);
  return projected.length === items.length ? items : projected;
}
