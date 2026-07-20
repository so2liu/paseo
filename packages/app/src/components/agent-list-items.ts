import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";

export type AgentListSectionKey =
  | "pinned"
  | "today"
  | "yesterday"
  | "thisWeek"
  | "thisMonth"
  | "older";

export type AgentListItem =
  | { type: "header"; key: string; section: AgentListSectionKey }
  | { type: "agent"; key: string; agent: AggregatedAgent };

const DATE_SECTION_ORDER = [
  "today",
  "yesterday",
  "thisWeek",
  "thisMonth",
  "older",
] as const satisfies readonly AgentListSectionKey[];

function deriveDateSectionKey(lastActivityAt: Date, now: Date): AgentListSectionKey {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart.getTime() - 24 * 60 * 60 * 1000);
  const activityStart = new Date(
    lastActivityAt.getFullYear(),
    lastActivityAt.getMonth(),
    lastActivityAt.getDate(),
  );

  if (activityStart.getTime() >= todayStart.getTime()) return "today";
  if (activityStart.getTime() >= yesterdayStart.getTime()) return "yesterday";

  const diffDays = Math.floor((todayStart.getTime() - activityStart.getTime()) / 86_400_000);
  if (diffDays <= 7) return "thisWeek";
  if (diffDays <= 30) return "thisMonth";
  return "older";
}

export function buildAgentListItems(agents: AggregatedAgent[], now = new Date()): AgentListItem[] {
  const buckets = new Map<AgentListSectionKey, AggregatedAgent[]>();
  for (const agent of agents) {
    const section =
      agent.pinnedAt && !agent.archivedAt
        ? "pinned"
        : deriveDateSectionKey(agent.lastActivityAt, now);
    const existing = buckets.get(section) ?? [];
    existing.push(agent);
    buckets.set(section, existing);
  }

  const result: AgentListItem[] = [];
  const pinnedAgents = buckets.get("pinned");
  if (pinnedAgents && pinnedAgents.length > 0) {
    pinnedAgents.sort(
      (left, right) => (right.pinnedAt?.getTime() ?? 0) - (left.pinnedAt?.getTime() ?? 0),
    );
    result.push({ type: "header", key: "header:pinned", section: "pinned" });
    for (const agent of pinnedAgents) {
      result.push({ type: "agent", key: `${agent.serverId}:${agent.id}`, agent });
    }
  }

  for (const section of DATE_SECTION_ORDER) {
    const data = buckets.get(section);
    if (!data || data.length === 0) continue;
    result.push({ type: "header", key: `header:${section}`, section });
    for (const agent of data) {
      result.push({ type: "agent", key: `${agent.serverId}:${agent.id}`, agent });
    }
  }
  return result;
}
