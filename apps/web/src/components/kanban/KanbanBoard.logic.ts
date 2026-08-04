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

export const AUTOMATION_PLAN_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AutomationPlanEffort = (typeof AUTOMATION_PLAN_EFFORTS)[number];

export interface AutomationPlanTask {
  readonly key: string;
  readonly title: string;
  readonly goal: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly changeScopes: ReadonlyArray<string>;
  readonly model: string;
  readonly reasoningEffort: AutomationPlanEffort;
  readonly verification: ReadonlyArray<string>;
}

export interface AutomationPlan {
  readonly summary: string;
  readonly tasks: ReadonlyArray<AutomationPlanTask>;
}

function stringArray(value: unknown, maximum: number): ReadonlyArray<string> | null {
  if (!Array.isArray(value) || value.length > maximum) return null;
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim());
  return values.length === value.length && values.every(Boolean) ? values : null;
}

export function parseAutomationPlan(text: string): AutomationPlan | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = fenced ?? text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  if (!candidate.trim()) return null;
  let decoded: unknown;
  try {
    decoded = JSON.parse(candidate);
  } catch {
    return null;
  }
  if (typeof decoded !== "object" || decoded === null) return null;
  const record = decoded as Record<string, unknown>;
  if (typeof record.summary !== "string" || !Array.isArray(record.tasks)) return null;
  if (record.tasks.length === 0 || record.tasks.length > 8) return null;
  const tasks: AutomationPlanTask[] = [];
  for (const value of record.tasks) {
    if (typeof value !== "object" || value === null) return null;
    const task = value as Record<string, unknown>;
    const acceptanceCriteria = stringArray(task.acceptanceCriteria, 24);
    const dependsOn = stringArray(task.dependsOn, 16);
    const changeScopes = stringArray(task.changeScopes, 32);
    const verification = stringArray(task.verification, 16);
    if (
      typeof task.key !== "string" ||
      typeof task.title !== "string" ||
      typeof task.goal !== "string" ||
      typeof task.model !== "string" ||
      typeof task.reasoningEffort !== "string" ||
      !AUTOMATION_PLAN_EFFORTS.includes(task.reasoningEffort as AutomationPlanEffort) ||
      acceptanceCriteria === null ||
      acceptanceCriteria.length === 0 ||
      dependsOn === null ||
      changeScopes === null ||
      changeScopes.length === 0 ||
      verification === null ||
      verification.length === 0
    ) {
      return null;
    }
    tasks.push({
      key: task.key.trim(),
      title: task.title.trim(),
      goal: task.goal.trim(),
      acceptanceCriteria,
      dependsOn,
      changeScopes,
      model: task.model.trim(),
      reasoningEffort: task.reasoningEffort as AutomationPlanEffort,
      verification,
    });
  }
  if (tasks.some((task) => !task.key || !task.title || !task.goal || !task.model)) return null;
  const keys = new Set(tasks.map((task) => task.key));
  if (keys.size !== tasks.length) return null;
  if (tasks.some((task) => task.dependsOn.some((key) => !keys.has(key) || key === task.key))) {
    return null;
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dependencies = new Map(tasks.map((task) => [task.key, task.dependsOn]));
  const hasCycle = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if ((dependencies.get(key) ?? []).some(hasCycle)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  if (tasks.some((task) => hasCycle(task.key))) return null;
  return { summary: record.summary.trim(), tasks };
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

export function isKanbanThreadVerified(
  thread: Pick<EnvironmentThreadShell, "automation">,
): boolean {
  return (
    thread.automation?.stage === "review" && thread.automation.verification.status === "passed"
  );
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
        return isKanbanThreadVerified(thread) ? "Verified · ready for review" : "Ready for review";
      case "complete":
        return "Complete";
      case "failed":
        return thread.automation.lastError?.startsWith("No agent activity")
          ? "Agent stalled"
          : "Run failed";
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
  return "Awaiting review";
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

export type KanbanAutomationErrorPresentation = {
  readonly title: string;
  readonly detail: string;
  readonly recovery: string | null;
};

function compactAutomationError(error: string): string {
  const withoutStack = error
    .split(/\s+at\s+(?:file:|[A-Za-z]:[\\/]|[A-Za-z_$][\w$./<>-]*\s*\()/u, 1)[0]
    ?.split("{ [cause]:", 1)[0]
    ?.replace(/^GitCommandError:\s*/u, "")
    .replace(/^Git command failed in [^(]+\([^)]*\):\s*/u, "")
    .trim();
  if (!withoutStack) return "The autonomous run stopped unexpectedly.";
  return withoutStack.length > 220 ? `${withoutStack.slice(0, 217)}…` : withoutStack;
}

export function presentKanbanAutomationError(error: string): KanbanAutomationErrorPresentation {
  const normalized = error.toLowerCase();
  if (
    normalized.includes("no supported vcs repository was detected") ||
    normalized.includes("not a git repository")
  ) {
    return {
      title: "Git is not set up for this project",
      detail: "Autopilot needs a Git repository so each task can work safely in isolation.",
      recovery: "Initialize Git, create the first commit, then retry the task.",
    };
  }
  if (
    normalized.includes("does not have any commits") ||
    normalized.includes("needed a single revision") ||
    normalized.includes("bad revision 'head'") ||
    normalized.includes("unknown revision or path not in the working tree")
  ) {
    return {
      title: "Create the first commit before starting",
      detail: "Git cannot create an isolated task worktree from a repository with no commit yet.",
      recovery: "Commit the project once, confirm the base branch, then retry the task.",
    };
  }
  if (normalized.includes("git worktree add failed") || normalized.includes("createworktree")) {
    return {
      title: "FACT3 could not create the task worktree",
      detail: "The selected base branch may be missing, already checked out, or unavailable.",
      recovery:
        "Confirm the base branch exists and the repository has an initial commit, then retry.",
    };
  }
  if (normalized.includes("no agent activity was recorded")) {
    return {
      title: "The agent stopped responding",
      detail: compactAutomationError(error),
      recovery: "Review the task and retry when the provider is available.",
    };
  }
  return {
    title: "The autonomous run stopped",
    detail: compactAutomationError(error),
    recovery: "Review the task details, then retry or open the chat for more context.",
  };
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

function normalizedScopePrefix(scope: string): string | null {
  const normalized = scope.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const wildcard = normalized.search(/[?*{[]/);
  const prefix = (wildcard === -1 ? normalized : normalized.slice(0, wildcard))
    .replace(/\/+$/, "")
    .trim();
  return prefix.length > 0 ? prefix.toLowerCase() : null;
}

export function automationConflictBlockers(
  thread: EnvironmentThreadShell,
  threads: ReadonlyArray<EnvironmentThreadShell>,
): ReadonlyArray<EnvironmentThreadShell> {
  const scopes = thread.automation?.changeScopes ?? [];
  if (thread.automation?.stage !== "ready" || scopes.length === 0) return [];
  return threads.filter((candidate) => {
    if (
      candidate.id === thread.id ||
      (candidate.automation?.stage !== "running" && candidate.automation?.stage !== "needs-input")
    ) {
      return false;
    }
    const candidateScopes = candidate.automation.changeScopes;
    return scopes.some((scope) => {
      const left = normalizedScopePrefix(scope);
      if (left === null) return false;
      return candidateScopes.some((candidateScope) => {
        const right = normalizedScopePrefix(candidateScope);
        return (
          right !== null &&
          (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`))
        );
      });
    });
  });
}

export function capCompletedKanbanThreads(
  threads: ReadonlyArray<EnvironmentThreadShell>,
  limit: number,
): {
  readonly visible: ReadonlyArray<EnvironmentThreadShell>;
  readonly overflow: ReadonlyArray<EnvironmentThreadShell>;
} {
  return { visible: threads.slice(0, limit), overflow: threads.slice(limit) };
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
