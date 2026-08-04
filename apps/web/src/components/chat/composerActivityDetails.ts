import type {
  OrchestrationThreadActivity,
  ToolLifecycleItemType,
  TurnId,
} from "@t3tools/contracts";

import {
  deriveComposerActivitySummary,
  type ActivePlanState,
  type ComposerActivitySummary,
} from "../../session-logic";

export type ComposerActivityItemStatus = "pending" | "running" | "completed" | "failed" | "stopped";

export interface ComposerToolActivityItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly detailKind?: ComposerActivitySummary["detailKind"];
  readonly status: ComposerActivityItemStatus;
  readonly itemType?: ToolLifecycleItemType;
  readonly createdAt: string;
  readonly rawData: unknown;
}

export interface ComposerSubagentActivityItem {
  readonly id: string;
  readonly name: string;
  readonly model?: string;
  readonly reasoningEffort?: string;
  readonly status: ComposerActivityItemStatus;
  readonly prompt?: string;
  readonly result?: string;
  readonly createdAt: string;
}

export interface ComposerTaskActivityItem {
  readonly id: string;
  readonly title: string;
  readonly detail?: string;
  readonly status: ComposerActivityItemStatus;
  readonly createdAt: string;
}

export interface ComposerActivityDetails {
  readonly tools: ReadonlyArray<ComposerToolActivityItem>;
  readonly subagents: ReadonlyArray<ComposerSubagentActivityItem>;
  readonly tasks: ReadonlyArray<ComposerTaskActivityItem>;
  readonly hasHistory: boolean;
}

interface LinkedSubagentMessage {
  readonly agentThreadId: string;
  readonly messageId: string;
  readonly result: string;
}

interface MutableSubagentActivityItem {
  id: string;
  name: string | null;
  model: string | null;
  reasoningEffort: string | null;
  status: ComposerActivityItemStatus;
  prompt: string | null;
  result: string | null;
  createdAt: string;
}

interface MutableTaskActivityItem {
  id: string;
  title: string;
  detail: string | null;
  status: ComposerActivityItemStatus;
  createdAt: string;
}

const ACTIVE_AGENT_STATUSES = new Set(["pendingInit", "running", "inProgress", "started"]);
const COMPLETED_AGENT_STATUSES = new Set(["completed", "shutdown", "finished"]);
const FAILED_AGENT_STATUSES = new Set(["failed", "error", "errored"]);
const STOPPED_AGENT_STATUSES = new Set(["interrupted", "stopped", "cancelled", "closed"]);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => {
        const normalized = asString(entry);
        return normalized ? [normalized] : [];
      })
    : [];
}

function compareActivities(
  left: OrchestrationThreadActivity,
  right: OrchestrationThreadActivity,
): number {
  if (
    left.sequence !== undefined &&
    right.sequence !== undefined &&
    left.sequence !== right.sequence
  ) {
    return left.sequence - right.sequence;
  }
  const createdAtOrder = left.createdAt.localeCompare(right.createdAt);
  return createdAtOrder !== 0 ? createdAtOrder : left.id.localeCompare(right.id);
}

export function deriveLatestComposerActivityTurnId(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): TurnId | null {
  const latest = activities
    .filter((activity) => activity.turnId !== null)
    .toSorted(compareActivities)
    .at(-1);
  return latest?.turnId ?? null;
}

function activityBelongsToTurn(
  activity: OrchestrationThreadActivity,
  turnId: TurnId | null | undefined,
): boolean {
  return (
    turnId === null ||
    turnId === undefined ||
    activity.turnId === null ||
    activity.turnId === turnId
  );
}

function normalizeItemStatus(
  activity: OrchestrationThreadActivity,
  explicitStatus: string | null,
): ComposerActivityItemStatus {
  if (explicitStatus && ACTIVE_AGENT_STATUSES.has(explicitStatus)) return "running";
  if (explicitStatus && COMPLETED_AGENT_STATUSES.has(explicitStatus)) return "completed";
  if (explicitStatus && FAILED_AGENT_STATUSES.has(explicitStatus)) return "failed";
  if (explicitStatus && STOPPED_AGENT_STATUSES.has(explicitStatus)) return "stopped";
  if (activity.kind.endsWith(".completed"))
    return activity.tone === "error" ? "failed" : "completed";
  if (activity.kind.endsWith(".started") || activity.kind.endsWith(".updated")) return "running";
  return "pending";
}

function displayAgentPath(path: string): string {
  const segment = path.split("/").toReversed().find(Boolean) ?? path;
  const words = segment.replace(/[_-]+/g, " ").trim();
  return words.length > 0 ? words.charAt(0).toUpperCase() + words.slice(1) : "Sub-agent";
}

function collectAgentState(
  target: MutableSubagentActivityItem,
  value: unknown,
  activity: OrchestrationThreadActivity,
) {
  const state = asRecord(value);
  const explicitStatus = asString(state?.status);
  if (explicitStatus) {
    target.status = normalizeItemStatus(activity, explicitStatus);
  }
  const message =
    asString(state?.message) ??
    asString(state?.result) ??
    asString(state?.summary) ??
    asString(state?.output);
  if (message) {
    target.result = message;
  }
}

function linkedSubagentMessage(
  activity: OrchestrationThreadActivity,
): LinkedSubagentMessage | null {
  const payload = asRecord(activity.payload);
  if (asString(payload?.itemType) !== "assistant_message") return null;
  const data = asRecord(payload?.data);
  const item = asRecord(data?.item);
  const agentThreadId = asString(data?.threadId);
  const messageId = asString(item?.id);
  const result = asString(item?.text) ?? asString(payload?.detail);
  if (!agentThreadId || !messageId || !result) return null;
  return { agentThreadId, messageId, result };
}

function ensureSubagent(
  byId: Map<string, MutableSubagentActivityItem>,
  id: string,
  activity: OrchestrationThreadActivity,
): MutableSubagentActivityItem {
  const existing = byId.get(id);
  if (existing) return existing;
  const created: MutableSubagentActivityItem = {
    id,
    name: null,
    model: null,
    reasoningEffort: null,
    status: activity.kind === "tool.completed" ? "completed" : "running",
    prompt: null,
    result: null,
    createdAt: activity.createdAt,
  };
  byId.set(id, created);
  return created;
}

function deriveSubagents(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<ComposerSubagentActivityItem> {
  const byId = new Map<string, MutableSubagentActivityItem>();

  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }
    const payload = asRecord(activity.payload);
    if (asString(payload?.itemType) !== "collab_agent_tool_call") continue;

    const data = asRecord(payload?.data);
    const item = asRecord(data?.item) ?? data;
    const collab = asRecord(payload?.collab);
    const tool = asString(collab?.tool) ?? asString(item?.tool);
    const itemType = asString(item?.type);
    const agentThreadId = asString(item?.agentThreadId);
    const agentPath = asString(item?.agentPath);
    const prompt = asString(item?.prompt) ?? asString(collab?.prompt);
    const model = asString(collab?.model) ?? asString(item?.model);
    const reasoningEffort = asString(collab?.reasoningEffort) ?? asString(item?.reasoningEffort);

    const receiverIds = new Set([
      ...asStringArray(collab?.receiverThreadIds),
      ...asStringArray(item?.receiverThreadIds),
      ...(agentThreadId && agentPath !== "/root" ? [agentThreadId] : []),
    ]);

    const collabPaths = asRecord(collab?.agentPaths);
    const collabStates = asRecord(collab?.agentsStates);
    const itemStates = asRecord(item?.agentsStates);
    for (const id of receiverIds) {
      const target = ensureSubagent(byId, id, activity);
      if (prompt) target.prompt = prompt;
      if (model) target.model = model;
      if (reasoningEffort) target.reasoningEffort = reasoningEffort;
      const snapshotPath = asString(collabPaths?.[id]);
      if (snapshotPath && snapshotPath !== "/root") {
        target.name = displayAgentPath(snapshotPath);
      }
      if (id === agentThreadId && agentPath && agentPath !== "/root") {
        target.name = displayAgentPath(agentPath);
      }
      if (collabStates && id in collabStates) collectAgentState(target, collabStates[id], activity);
      if (itemStates && id in itemStates) collectAgentState(target, itemStates[id], activity);

      if (itemType === "subAgentActivity" && id === agentThreadId) {
        const kind = asString(item?.kind);
        if (kind === "interrupted") target.status = "stopped";
        else if (kind === "completed") target.status = "completed";
        else if (kind === "failed") target.status = "failed";
        else if (kind) target.status = "running";
      } else if (
        activity.kind === "tool.completed" &&
        target.status === "running" &&
        tool !== "spawnAgent" &&
        tool !== "resumeAgent" &&
        tool !== "sendInput"
      ) {
        target.status = "completed";
      }
    }
  }

  // Codex currently reports a child agent's final message as an assistant
  // message scoped to the child provider thread, then closes the
  // subAgentActivity item as "interrupted". The final message is the stronger
  // completion signal and is also the result users expect to inspect here.
  for (const activity of activities) {
    const message = linkedSubagentMessage(activity);
    if (!message) continue;
    const target = byId.get(message.agentThreadId);
    if (!target) continue;
    target.result = message.result;
    target.status = "completed";
  }

  return [...byId.values()].map((agent, index) => ({
    id: agent.id,
    name: agent.name ?? `Sub-agent ${index + 1}`,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {}),
    status: agent.status,
    ...(agent.prompt ? { prompt: agent.prompt } : {}),
    ...(agent.result ? { result: agent.result } : {}),
    createdAt: agent.createdAt,
  }));
}

export function deriveSubagentAssistantMessageIds(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
): ReadonlySet<string> {
  const scoped = activities.filter((activity) => activityBelongsToTurn(activity, turnId));
  const agentThreadIds = new Set<string>();
  for (const activity of scoped) {
    const payload = asRecord(activity.payload);
    if (asString(payload?.itemType) !== "collab_agent_tool_call") continue;
    const data = asRecord(payload?.data);
    const item = asRecord(data?.item) ?? data;
    const collab = asRecord(payload?.collab);
    const directAgentId = asString(item?.agentThreadId);
    if (directAgentId && asString(item?.agentPath) !== "/root") {
      agentThreadIds.add(directAgentId);
    }
    for (const id of [
      ...asStringArray(collab?.receiverThreadIds),
      ...asStringArray(item?.receiverThreadIds),
    ]) {
      agentThreadIds.add(id);
    }
  }

  const messageIds = new Set<string>();
  for (const activity of scoped) {
    const message = linkedSubagentMessage(activity);
    if (message && agentThreadIds.has(message.agentThreadId)) {
      messageIds.add(message.messageId);
    }
  }
  return messageIds;
}

function deriveTools(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
): ReadonlyArray<ComposerToolActivityItem> {
  const grouped = new Map<string, OrchestrationThreadActivity[]>();
  for (const activity of activities) {
    if (
      activity.kind !== "tool.started" &&
      activity.kind !== "tool.updated" &&
      activity.kind !== "tool.completed"
    ) {
      continue;
    }
    const payload = asRecord(activity.payload);
    if (asString(payload?.itemType) === "collab_agent_tool_call") continue;
    const id = asString(payload?.toolCallId) ?? activity.id;
    const existing = grouped.get(id);
    if (existing) existing.push(activity);
    else grouped.set(id, [activity]);
  }

  return [...grouped.entries()]
    .flatMap(([id, lifecycle]) => {
      const latest = lifecycle.at(-1);
      if (!latest) return [];
      const payload = asRecord(latest.payload);
      const itemType = asString(payload?.itemType);
      const summary = deriveComposerActivitySummary([latest], latest.turnId);
      return [
        {
          id,
          title: summary.title === "Thinking…" ? latest.summary : summary.title,
          ...(summary.detail ? { detail: summary.detail } : {}),
          ...(summary.detailKind ? { detailKind: summary.detailKind } : {}),
          status: normalizeItemStatus(latest, asString(payload?.status)),
          ...(itemType ? { itemType: itemType as ToolLifecycleItemType } : {}),
          createdAt: lifecycle[0]?.createdAt ?? latest.createdAt,
          rawData: payload?.data ?? latest.payload,
        } satisfies ComposerToolActivityItem,
      ];
    })
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
}

function deriveTasks(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  activePlan: ActivePlanState | null,
): ReadonlyArray<ComposerTaskActivityItem> {
  if (activePlan && activePlan.steps.length > 0) {
    return activePlan.steps.map((step, index) => ({
      id: `${activePlan.turnId ?? "plan"}:${index}`,
      title: step.step,
      status:
        step.status === "completed"
          ? "completed"
          : step.status === "inProgress"
            ? "running"
            : "pending",
      createdAt: activePlan.createdAt,
    }));
  }

  const byId = new Map<string, MutableTaskActivityItem>();
  for (const activity of activities) {
    if (
      activity.kind !== "task.started" &&
      activity.kind !== "task.progress" &&
      activity.kind !== "task.completed"
    ) {
      continue;
    }
    const payload = asRecord(activity.payload);
    const id = asString(payload?.taskId) ?? activity.id;
    const title =
      asString(payload?.title) ??
      asString(payload?.description) ??
      asString(payload?.summary) ??
      activity.summary;
    const detail = asString(payload?.detail);
    const existing = byId.get(id);
    const nextStatus = normalizeItemStatus(activity, asString(payload?.status));
    if (existing) {
      existing.title = title;
      existing.detail = detail ?? existing.detail;
      existing.status = nextStatus;
    } else {
      byId.set(id, {
        id,
        title,
        detail,
        status: nextStatus,
        createdAt: activity.createdAt,
      });
    }
  }

  return [...byId.values()].map((task) => ({
    id: task.id,
    title: task.title,
    ...(task.detail ? { detail: task.detail } : {}),
    status: task.status,
    createdAt: task.createdAt,
  }));
}

export function deriveComposerActivityDetails(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
  activePlan: ActivePlanState | null,
): ComposerActivityDetails {
  const scoped = [...activities]
    .filter((activity) => activityBelongsToTurn(activity, turnId))
    .toSorted(compareActivities);
  const tools = deriveTools(scoped);
  const subagents = deriveSubagents(scoped);
  const tasks = deriveTasks(scoped, activePlan);
  return {
    tools,
    subagents,
    tasks,
    hasHistory: tools.length > 0 || subagents.length > 0 || tasks.length > 0,
  };
}

export function deriveComposerActivityDetailsWithSubagentHistory(
  activities: ReadonlyArray<OrchestrationThreadActivity>,
  turnId: TurnId | null | undefined,
  activePlan: ActivePlanState | null,
): ComposerActivityDetails {
  const currentTurn = deriveComposerActivityDetails(activities, turnId, activePlan);
  const subagents = deriveComposerActivityDetails(activities, null, null).subagents;
  return {
    ...currentTurn,
    subagents,
    hasHistory: currentTurn.hasHistory || subagents.length > 0,
  };
}

export function formatComposerToolData(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "No additional tool details were provided.";
  try {
    const serialized = JSON.stringify(value, null, 2);
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}
