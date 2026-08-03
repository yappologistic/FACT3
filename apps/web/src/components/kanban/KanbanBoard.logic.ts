import { effectiveSettled } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

export const KANBAN_ACTIVE_LANES = ["running", "review", "complete"] as const;

export type KanbanActiveLane = (typeof KANBAN_ACTIVE_LANES)[number];
export type KanbanLane = KanbanActiveLane | "history";

export interface KanbanLaneGroup {
  readonly id: KanbanActiveLane;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
}

export function isKanbanThreadRunning(
  thread: Pick<
    EnvironmentThreadShell,
    "session" | "latestTurn" | "hasPendingApprovals" | "hasPendingUserInput"
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
    "session" | "latestTurn" | "hasPendingApprovals" | "hasPendingUserInput"
  >,
): string {
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
  const checkpoint = checkpoints.at(-1);
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
