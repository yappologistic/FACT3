import type { OrchestrationThreadActivity, TurnId } from "@t3tools/contracts";

const ACTIVE_AGENT_STATUSES = new Set(["pendingInit", "running"]);
const COLLAB_ITEM_TYPE = "collab_agent_tool_call";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  const leftSequence = left.sequence;
  const rightSequence = right.sequence;
  if (leftSequence !== undefined && rightSequence !== undefined && leftSequence !== rightSequence) {
    return leftSequence - rightSequence;
  }
  const timestampOrder = left.createdAt.localeCompare(right.createdAt);
  return timestampOrder !== 0 ? timestampOrder : left.id.localeCompare(right.id);
}

/**
 * Replays the compact collaboration snapshots carried by tool activities.
 * Providers without agent-state snapshots fall back to their in-flight
 * collaboration tool calls, so the same UI works across provider adapters.
 */
export function deriveActiveSubagentCount(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  activeTurnId?: TurnId | null,
): number {
  const activeAgentIds = new Set<string>();
  const knownAgentIds = new Set<string>();
  const activeFallbackCalls = new Set<string>();

  for (const activity of [...activities].toSorted(compareActivities)) {
    if (
      activeTurnId !== null &&
      activeTurnId !== undefined &&
      activity.turnId !== null &&
      activity.turnId !== activeTurnId
    ) {
      continue;
    }
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }

    const payload = asRecord(activity.payload);
    if (payload?.itemType !== COLLAB_ITEM_TYPE) {
      continue;
    }

    const callId = asString(payload.toolCallId) ?? asString(asRecord(payload.data)?.toolCallId);
    if (callId && activity.kind === "tool.completed") {
      activeFallbackCalls.delete(callId);
    }

    const collab = asRecord(payload.collab);
    if (callId && collab) {
      // A provider may emit a sparse start event before the real collaboration
      // snapshot. Once real child IDs arrive, the call placeholder must stop
      // contributing to the count.
      activeFallbackCalls.delete(callId);
    }
    const dataItem = asRecord(asRecord(payload.data)?.item) ?? asRecord(payload.data);
    const rootAgentThreadId =
      dataItem?.type === "subAgentActivity" && dataItem.agentPath === "/root"
        ? asString(dataItem.agentThreadId)
        : null;
    const agentStates = asRecord(collab?.agentsStates);
    const receiverThreadIds = Array.isArray(collab?.receiverThreadIds)
      ? collab.receiverThreadIds.filter(
          (value): value is string => asString(value) !== null && value !== rootAgentThreadId,
        )
      : [];
    for (const agentId of receiverThreadIds) {
      knownAgentIds.add(agentId);
    }
    let hasAgentStateSnapshot = false;
    if (agentStates) {
      for (const [agentId, rawState] of Object.entries(agentStates)) {
        if (agentId === rootAgentThreadId || !knownAgentIds.has(agentId)) {
          continue;
        }
        const status = asString(asRecord(rawState)?.status);
        if (!status) {
          continue;
        }
        hasAgentStateSnapshot = true;
        if (ACTIVE_AGENT_STATUSES.has(status)) {
          activeAgentIds.add(agentId);
        } else {
          activeAgentIds.delete(agentId);
        }
      }
    }

    const tool = asString(collab?.tool);
    if (!hasAgentStateSnapshot && receiverThreadIds.length > 0) {
      if (tool === "spawnAgent" || tool === "resumeAgent") {
        for (const agentId of receiverThreadIds) {
          if (agentId !== rootAgentThreadId) activeAgentIds.add(agentId);
        }
      } else if (tool === "closeAgent") {
        for (const agentId of receiverThreadIds) activeAgentIds.delete(agentId);
      }
    }

    if (callId && activity.kind === "tool.started" && collab === null) {
      activeFallbackCalls.add(callId);
    }
  }

  return activeAgentIds.size + activeFallbackCalls.size;
}
