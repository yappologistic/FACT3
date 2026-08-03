import { effectiveSettled } from "@t3tools/client-runtime/state/thread-settled";
import type {
  EnvironmentThread,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";

export const KANBAN_ACTIVE_LANES = ["queue", "running", "attention", "review", "complete"] as const;

export type KanbanActiveLane = (typeof KANBAN_ACTIVE_LANES)[number];
export type KanbanLane = KanbanActiveLane | "history";

export interface KanbanLaneGroup {
  readonly id: KanbanActiveLane;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}

export function liveKanbanAutomation(
  shell: Pick<EnvironmentThreadShell, "automation">,
  detail: Pick<EnvironmentThread, "automation"> | null,
) {
  // Shell snapshots drive the live board and may advance after a thread detail
  // was cached. Prefer them so review gates and lifecycle actions never lag.
  return shell.automation ?? detail?.automation;
}

export function isKanbanThreadRunning(
  thread: Pick<
    EnvironmentThreadShell,
    "session" | "latestTurn" | "hasPendingApprovals" | "hasPendingUserInput" | "automation"
  >,
): boolean {
  return (
    thread.session?.status === "starting" ||
    thread.session?.status === "running" ||
    thread.latestTurn?.state === "running" ||
    thread.hasPendingApprovals ||
    thread.hasPendingUserInput
  );
}

export function classifyKanbanThread(thread: EnvironmentThreadShell, now: string): KanbanLane {
  if (thread.archivedAt !== null) return "history";
  if (thread.automation) {
    switch (thread.automation.stage) {
      case "planned":
      case "ready":
        return "queue";
      case "running":
        return "running";
      case "needs-input":
      case "failed":
        return "attention";
      case "review":
        return "review";
      case "complete":
      case "cancelled":
        return "complete";
    }
  }
  if (isKanbanThreadRunning(thread)) return "running";
  if (
    effectiveSettled(thread, {
      now,
      // The board should only move work to Complete from durable lifecycle
      // state (explicit settle or a merged/closed change request). A local
      // inactivity preference must never silently move a card while open.
      autoSettleAfterDays: null,
    })
  ) {
    return "complete";
  }
  return "review";
}

export function sortKanbanThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
): EnvironmentThreadShell[] {
  return threads.toSorted((left, right) => {
    const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
    return updated !== 0 ? updated : left.id.localeCompare(right.id);
  });
}

export function groupKanbanThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  now: string,
): ReadonlyArray<KanbanLaneGroup> {
  const grouped = new Map<KanbanActiveLane, EnvironmentThreadShell[]>(
    KANBAN_ACTIVE_LANES.map((lane) => [lane, []]),
  );

  for (const thread of threads) {
    const lane = classifyKanbanThread(thread, now);
    if (lane === "history") continue;
    grouped.get(lane)?.push(thread);
  }

  return KANBAN_ACTIVE_LANES.map((id) => ({
    id,
    threads: sortKanbanThreads(grouped.get(id) ?? []),
  }));
}

export function describeKanbanThreadState(
  thread: Pick<
    EnvironmentThreadShell,
    "session" | "latestTurn" | "hasPendingApprovals" | "hasPendingUserInput" | "automation"
  >,
): string {
  if (thread.automation) {
    switch (thread.automation.stage) {
      case "planned":
        return "Paused";
      case "ready":
        return "Queued";
      case "running":
        return thread.automation.phase === "verification" ? "Verifying" : "Working";
      case "needs-input":
        return "Needs input";
      case "review":
        return "Ready for review";
      case "complete":
        return "Complete";
      case "failed":
        return "Run failed";
      case "cancelled":
        return "Cancelled";
    }
  }
  if (thread.hasPendingUserInput) return "Needs input";
  if (thread.hasPendingApprovals) return "Needs approval";
  if (thread.session?.status === "starting") return "Starting agent";
  if (thread.session?.status === "running" || thread.latestTurn?.state === "running") {
    return "Working";
  }
  if (thread.latestTurn?.state === "error" || thread.session?.status === "error") {
    return "Needs attention";
  }
  if (thread.latestTurn?.state === "interrupted") return "Interrupted";
  return "Ready for review";
}

export function describeEmptyKanbanActivity(
  automation: EnvironmentThreadShell["automation"],
): string {
  switch (automation?.stage) {
    case "planned":
      return "Task paused. Queue it when you are ready.";
    case "ready":
      return "Waiting for Autopilot to start this task.";
    case "running":
      return "The agent is starting. Activity will appear here.";
    case "needs-input":
      return "The agent is waiting for input in chat.";
    case "review":
      return "Agent finished. Review the verified changes below.";
    case "complete":
      return "Task completed. Earlier changes remain available below.";
    case "failed":
      return "The run stopped before activity was recorded.";
    case "cancelled":
      return "Run cancelled. Earlier changes remain available below.";
    case undefined:
      return "No activity has been recorded yet.";
  }
}

export function incompleteAutomationDependencies(
  thread: EnvironmentThreadShell,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  if (!thread.automation) return [];
  const completeIds = new Set(
    threads
      .filter((candidate) => candidate.automation?.stage === "complete")
      .map((candidate) => candidate.id),
  );
  const byId = new Map(threads.map((candidate) => [candidate.id, candidate]));
  return thread.automation.dependencies.flatMap((dependencyId) => {
    if (completeIds.has(dependencyId)) return [];
    const dependency = byId.get(dependencyId);
    return dependency ? [dependency] : [];
  });
}

export function latestCheckpointSummary(
  checkpoints: ReadonlyArray<{
    readonly files: ReadonlyArray<{
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
    }>;
  }>,
): {
  readonly files: number;
  readonly additions: number;
  readonly deletions: number;
} | null {
  const checkpoint =
    checkpoints.toReversed().find((candidate) => candidate.files.length > 0) ?? checkpoints.at(-1);
  if (!checkpoint) return null;
  return {
    files: checkpoint.files.length,
    additions: checkpoint.files.reduce((sum, file) => sum + file.additions, 0),
    deletions: checkpoint.files.reduce((sum, file) => sum + file.deletions, 0),
  };
}

export function firstUserGoal(
  messages: ReadonlyArray<{ readonly role: string; readonly text: string }>,
): string | null {
  const message = messages.find(
    (candidate) => candidate.role === "user" && candidate.text.trim().length > 0,
  );
  return message?.text.trim() ?? null;
}
