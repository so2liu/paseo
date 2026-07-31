import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isWorkspaceRootAgent } from "@/subagents/policies";
import { deriveSidebarStateBucket } from "./sidebar-agent-state";

export interface WorkspaceAgentActivity {
  agentId: string;
  status: WorkspaceDescriptor["status"];
  enteredAt: Date | null;
  attentionEnteredAt: Date | null;
}

export function buildWorkspaceAgentActivityIndex(
  agents: ReadonlyMap<string, Agent>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): Map<string, WorkspaceAgentActivity> {
  const activityByWorkspaceId = new Map<string, WorkspaceAgentActivity>();
  const latestActivityAtByWorkspaceId = new Map<string, Date>();
  const latestAttentionAtByWorkspaceId = new Map<string, Date>();

  for (const agent of agents.values()) {
    const parentAgent = agent.parentAgentId ? agents.get(agent.parentAgentId) : undefined;
    if (agent.archivedAt || !agent.workspaceId || !isWorkspaceRootAgent(agent, parentAgent)) {
      continue;
    }

    trackLatestAttentionAt(latestAttentionAtByWorkspaceId, agent.workspaceId, agent);

    const enteredAt = agent.attentionTimestamp ?? agent.updatedAt;
    const latestActivityAt = latestActivityAtByWorkspaceId.get(agent.workspaceId);
    if (latestActivityAt && enteredAt <= latestActivityAt) {
      continue;
    }
    latestActivityAtByWorkspaceId.set(agent.workspaceId, enteredAt);

    const status = deriveSidebarStateBucket({
      status: agent.status,
      pendingPermissionCount: agent.pendingPermissions.length,
      requiresAttention: agent.requiresAttention,
      attentionReason: agent.attentionReason,
    });
    activityByWorkspaceId.set(agent.workspaceId, {
      agentId: agent.id,
      status,
      enteredAt,
      attentionEnteredAt: null,
    });
  }

  reconcileWorkspaceAttentionGenerations(
    activityByWorkspaceId,
    latestAttentionAtByWorkspaceId,
    previous,
  );

  if (previous && areWorkspaceAgentActivityIndexesIdentical(previous, activityByWorkspaceId)) {
    return previous instanceof Map ? previous : new Map(previous);
  }
  return activityByWorkspaceId;
}

function trackLatestAttentionAt(
  latestAttentionAtByWorkspaceId: Map<string, Date>,
  workspaceId: string,
  agent: Agent,
): void {
  if (!agent.requiresAttention || !agent.attentionTimestamp) {
    return;
  }
  const latestAttentionAt = latestAttentionAtByWorkspaceId.get(workspaceId);
  if (!latestAttentionAt || agent.attentionTimestamp > latestAttentionAt) {
    latestAttentionAtByWorkspaceId.set(workspaceId, agent.attentionTimestamp);
  }
}

function reconcileWorkspaceAttentionGenerations(
  activityByWorkspaceId: Map<string, WorkspaceAgentActivity>,
  latestAttentionAtByWorkspaceId: ReadonlyMap<string, Date>,
  previous?: ReadonlyMap<string, WorkspaceAgentActivity>,
): void {
  for (const [workspaceId, activity] of activityByWorkspaceId) {
    const previousActivity = previous?.get(workspaceId);
    const attentionEnteredAt = latestAttentionAtByWorkspaceId.get(workspaceId) ?? null;
    const sameAgentStatus =
      previousActivity?.agentId === activity.agentId && previousActivity.status === activity.status;
    if (
      sameAgentStatus &&
      previousActivity.attentionEnteredAt?.getTime() === attentionEnteredAt?.getTime()
    ) {
      activityByWorkspaceId.set(workspaceId, previousActivity);
      continue;
    }
    activityByWorkspaceId.set(workspaceId, {
      ...activity,
      enteredAt: sameAgentStatus ? previousActivity.enteredAt : activity.enteredAt,
      attentionEnteredAt,
    });
  }
}

function areWorkspaceAgentActivityIndexesIdentical(
  previous: ReadonlyMap<string, WorkspaceAgentActivity>,
  next: ReadonlyMap<string, WorkspaceAgentActivity>,
): boolean {
  if (previous.size !== next.size) {
    return false;
  }
  for (const [workspaceId, activity] of next) {
    if (previous.get(workspaceId) !== activity) {
      return false;
    }
  }
  return true;
}
