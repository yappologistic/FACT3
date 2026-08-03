import type {
  OrchestrationProject,
  OrchestrationProjectAutomationPolicy,
  OrchestrationThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export function buildAutomationPrompt(input: {
  readonly thread: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly policy: OrchestrationProjectAutomationPolicy;
}): string {
  const automation = input.thread.automation!;
  const criteria =
    automation.acceptanceCriteria.length === 0
      ? "- Preserve existing behavior and leave the repository in a verified state."
      : automation.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
  const delivery =
    input.policy.deliveryMode === "pull-request"
      ? "Commit the finished work, push the task branch, and open a pull request. Do not merge it."
      : input.policy.deliveryMode === "push-branch"
        ? "Commit the finished work and push the task branch. Do not merge it."
        : "Commit the finished work locally on the task branch. Do not push or merge it.";
  const feedback = automation.feedback ? `\nReviewer feedback:\n${automation.feedback}\n` : "";

  if (automation.taskKind === "planning") {
    return [
      "You are planning a real autonomous FACT3 Kanban project. Inspect the repository read-only and decompose the goal into the smallest independent tasks that can safely run in parallel.",
      `Project: ${input.project.title}`,
      `Project goal: ${automation.goal}`,
      "Return only one fenced JSON block. Do not edit files, commit, push, or open a pull request.",
      "The JSON must have this exact shape:",
      '{"summary":"one sentence","tasks":[{"key":"short-stable-key","title":"clear action title","goal":"implementation goal","acceptanceCriteria":["observable check"],"dependsOn":["other-key"],"changeScopes":["relative/path/or/glob"],"model":"model-slug","reasoningEffort":"low|medium|high|xhigh|max|ultra","verification":["focused command or manual check"]}]}',
      `Use ${input.thread.modelSelection.model} unless there is a concrete reason to choose another model available to this provider. Every task needs at least one acceptance criterion, one narrow change scope, and one verification check. Dependencies must reference task keys and must not contain cycles. Avoid multiple tasks that own the same files; if overlap is unavoidable, express it as a dependency. Keep the plan between 2 and 8 tasks.`,
    ].join("\n\n");
  }

  if (automation.phase === "verification") {
    return [
      "You are the verification pass for an autonomous FACT3 Kanban task.",
      `Project: ${input.project.title}`,
      `Goal: ${automation.goal}`,
      "Acceptance criteria:",
      criteria,
      feedback,
      "Inspect the implementation already present in this worktree. Run the smallest relevant tests and static checks, verify every acceptance criterion, and inspect the diff for regressions. Fix any issue you find and rerun the affected checks. Do not claim success without evidence.",
      delivery,
      "Finish with a concise report of checks run, results, files changed, and any remaining risk. If a required choice or permission is genuinely unavailable, ask one precise question instead of guessing.",
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return [
    "You are executing an autonomous FACT3 Kanban task in an isolated worktree.",
    `Project: ${input.project.title}`,
    `Goal: ${automation.goal}`,
    "Acceptance criteria:",
    criteria,
    feedback,
    "Own this task from investigation through implementation. Keep the change scoped to the goal, preserve unrelated user work, and use the repository's existing conventions. Run focused tests and static checks before finishing. Continue through recoverable issues without waiting for routine confirmation.",
    delivery,
    "Finish with a concise implementation summary, checks run, results, and any remaining risk. If a required choice or permission is genuinely unavailable, ask one precise question instead of guessing.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function automationConcurrencyLimit(policy: OrchestrationProjectAutomationPolicy): number {
  return policy.createWorktrees ? policy.maxConcurrentRuns : 1;
}

export function automationAvailableSlots(input: {
  readonly policy: OrchestrationProjectAutomationPolicy;
  readonly tasks: ReadonlyArray<OrchestrationThread>;
}): number {
  const active = input.tasks.filter(
    (thread) =>
      thread.automation?.stage === "running" || thread.automation?.stage === "needs-input",
  ).length;
  return Math.max(0, automationConcurrencyLimit(input.policy) - active);
}

export function resolveAutomationDependencyBranches(input: {
  readonly thread: OrchestrationThread;
  readonly tasks: ReadonlyArray<OrchestrationThread>;
}): {
  readonly branches: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
} {
  const automation = input.thread.automation;
  if (!automation || automation.dependencies.length === 0) {
    return { branches: [], missing: [] };
  }

  const byId = new Map(input.tasks.map((task) => [task.id, task]));
  const branches: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();

  for (const dependencyId of automation.dependencies) {
    const dependency = byId.get(dependencyId);
    if (dependency?.automation?.stage !== "complete" || !dependency.branch) {
      missing.push(dependency?.title ?? dependencyId);
      continue;
    }
    if (dependency.branch === automation.baseBranch || seen.has(dependency.branch)) continue;
    seen.add(dependency.branch);
    branches.push(dependency.branch);
  }

  return { branches, missing };
}

export function selectRunnableAutomationTasks(input: {
  readonly tasks: ReadonlyArray<OrchestrationThread>;
  readonly availableSlots: number;
}): ReadonlyArray<OrchestrationThread> {
  if (input.availableSlots <= 0) return [];
  const completeIds = new Set(
    input.tasks
      .filter((thread) => thread.automation?.stage === "complete")
      .map((thread) => thread.id),
  );
  const active = input.tasks.filter(
    (thread) =>
      thread.automation?.stage === "running" || thread.automation?.stage === "needs-input",
  );
  const selected: OrchestrationThread[] = [];
  for (const thread of input.tasks) {
    if (selected.length >= input.availableSlots) break;
    if (
      thread.automation?.stage !== "ready" ||
      !thread.automation.dependencies.every((dependency) => completeIds.has(dependency))
    ) {
      continue;
    }
    if (automationConflictBlockers(thread, [...active, ...selected]).length > 0) continue;
    selected.push(thread);
  }
  return selected;
}

function normalizedScopePrefix(scope: string): string | null {
  const normalized = scope.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const wildcard = normalized.search(/[?*{[]/);
  const prefix = (wildcard === -1 ? normalized : normalized.slice(0, wildcard))
    .replace(/\/+$/, "")
    .trim();
  return prefix.length > 0 ? prefix.toLowerCase() : null;
}

function scopesOverlap(left: string, right: string): boolean {
  const leftPrefix = normalizedScopePrefix(left);
  const rightPrefix = normalizedScopePrefix(right);
  if (leftPrefix === null || rightPrefix === null) return false;
  return (
    leftPrefix === rightPrefix ||
    leftPrefix.startsWith(`${rightPrefix}/`) ||
    rightPrefix.startsWith(`${leftPrefix}/`)
  );
}

export function automationConflictBlockers(
  candidate: OrchestrationThread,
  active: ReadonlyArray<OrchestrationThread>,
): ReadonlyArray<OrchestrationThread> {
  const candidateScopes = candidate.automation?.changeScopes ?? [];
  if (candidateScopes.length === 0) return [];
  return active.filter((thread) => {
    if (thread.id === candidate.id || thread.projectId !== candidate.projectId) return false;
    const activeScopes = thread.automation?.changeScopes ?? [];
    return candidateScopes.some((candidateScope) =>
      activeScopes.some((activeScope) => scopesOverlap(candidateScope, activeScope)),
    );
  });
}

export function automationLatestProgressAt(thread: OrchestrationThread): string | null {
  const automation = thread.automation;
  if (!automation) return null;
  const timestamps = [
    automation.lastHeartbeatAt,
    automation.startedAt,
    thread.latestTurn?.requestedAt,
    thread.latestTurn?.startedAt,
    thread.session?.updatedAt,
    ...thread.messages.map((message) => message.updatedAt),
    ...thread.activities.map((activity) => activity.createdAt),
  ].filter((timestamp): timestamp is string => timestamp !== null && timestamp !== undefined);
  return timestamps.toSorted((left, right) => right.localeCompare(left))[0] ?? null;
}

export function automationStuckDeadline(input: {
  readonly thread: OrchestrationThread;
  readonly policy: OrchestrationProjectAutomationPolicy;
}): string | null {
  const progressAt = automationLatestProgressAt(input.thread);
  if (input.thread.automation?.stage !== "running" || progressAt === null) return null;
  return DateTime.formatIso(
    DateTime.add(DateTime.makeUnsafe(progressAt), { minutes: input.policy.stuckAfterMinutes }),
  );
}

export function automationIsStalled(input: {
  readonly thread: OrchestrationThread;
  readonly policy: OrchestrationProjectAutomationPolicy;
  readonly now: string;
}): boolean {
  const agentStillRunning =
    input.thread.session?.status === "starting" ||
    input.thread.session?.status === "running" ||
    input.thread.latestTurn?.state === "running";
  if (!agentStillRunning) return false;
  const deadline = automationStuckDeadline(input);
  return deadline !== null && Date.parse(deadline) <= Date.parse(input.now);
}

export function automationCanRetry(thread: OrchestrationThread): boolean {
  return Boolean(thread.automation && thread.automation.attempt < thread.automation.maxAttempts);
}

/**
 * Finds the checkpoint produced by the automation dispatch represented by the
 * current heartbeat. Completed turns are intentionally removed from the thread
 * shell's `latestTurn`, so the checkpoint timestamp is the durable fallback.
 */
export function automationDispatchCompletion(thread: OrchestrationThread) {
  const automation = thread.automation;
  const lastHeartbeatAt = automation?.lastHeartbeatAt;
  if (!lastHeartbeatAt) return null;

  const latestTurn = thread.latestTurn;
  if (latestTurn && latestTurn.requestedAt >= lastHeartbeatAt) {
    const exactCheckpoint = thread.checkpoints.find(
      (checkpoint) => checkpoint.turnId === latestTurn.turnId,
    );
    if (exactCheckpoint) return exactCheckpoint;
  }

  return (
    thread.checkpoints
      .filter((checkpoint) => checkpoint.completedAt >= lastHeartbeatAt)
      .toSorted((left, right) => right.completedAt.localeCompare(left.completedAt))[0] ?? null
  );
}
