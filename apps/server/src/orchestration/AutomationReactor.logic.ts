import type {
  OrchestrationAutomationPhase,
  OrchestrationProject,
  OrchestrationProjectAutomationPolicy,
  OrchestrationThread,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export type AutomationFailureKind =
  | "repository-setup"
  | "dependency"
  | "merge-conflict"
  | "verification"
  | "timeout"
  | "permission"
  | "provider"
  | "unknown";

export type AutomationRecoveryStrategy =
  | "stop"
  | "request-input"
  | "resolve-conflict"
  | "repair-verification"
  | "retry";

export interface AutomationFailureClassification {
  readonly kind: AutomationFailureKind;
  readonly retryable: boolean;
  readonly strategy: AutomationRecoveryStrategy;
  readonly guidance: string;
}

export interface AutomationRetryDecision {
  readonly phase: OrchestrationAutomationPhase;
  readonly canRetry: boolean;
  readonly nextAttempt: number;
  readonly classification: AutomationFailureClassification;
  readonly guidance: string;
}

export interface AutomationDependencyTerminalBlocker {
  readonly dependencyId: string;
  readonly title: string;
  readonly reason: "missing" | "not-automated" | "failed" | "cancelled";
  readonly detail: string;
}

const MAX_AUDIT_EVIDENCE_PER_TASK = 8;
const MAX_AUDIT_EVIDENCE_DETAIL_LENGTH = 1_000;

function boundedAuditEvidence(value: string): string {
  return value.length <= MAX_AUDIT_EVIDENCE_DETAIL_LENGTH
    ? value
    : `${value.slice(0, MAX_AUDIT_EVIDENCE_DETAIL_LENGTH - 1)}…`;
}

/** Formats persisted task verification records for the final workflow audit. */
export function buildAutomationWorkflowEvidence(input: {
  readonly workflowId: string;
  readonly excludeThreadId: string;
  readonly threads: ReadonlyArray<OrchestrationThread>;
}): string | null {
  const workflowThreads = input.threads
    .filter(
      (thread) =>
        thread.id !== input.excludeThreadId && thread.automation?.workflowId === input.workflowId,
    )
    .toSorted(
      (left, right) =>
        left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
    );
  if (workflowThreads.length === 0) return null;

  return workflowThreads
    .map((thread) => {
      const automation = thread.automation!;
      const verification = automation.verification;
      const evidence = verification.evidence.slice(0, MAX_AUDIT_EVIDENCE_PER_TASK);
      const omitted = verification.evidence.length - evidence.length;
      return [
        `Task: ${thread.title} (${automation.workflowTaskKey ?? thread.id}, role=${automation.role})`,
        `Lifecycle: stage=${automation.stage}, verification=${verification.status}`,
        ...(verification.summary
          ? [`Verification summary: ${boundedAuditEvidence(verification.summary)}`]
          : []),
        ...evidence.map(
          (entry) =>
            `- ${boundedAuditEvidence(entry.check)}: ${boundedAuditEvidence(entry.detail)}`,
        ),
        ...(omitted > 0 ? [`- ${omitted} additional persisted checks omitted for brevity.`] : []),
      ].join("\n");
    })
    .join("\n\n");
}

function workflowContext(thread: OrchestrationThread): ReadonlyArray<string> {
  const automation = thread.automation!;
  return [
    ...(automation.workflowId ? [`Workflow: ${automation.workflowId}`] : []),
    ...(automation.workflowTaskKey ? [`Workflow task: ${automation.workflowTaskKey}`] : []),
    `Assigned role: ${automation.role}`,
  ];
}

function configuredRoleModels(thread: OrchestrationThread): string | null {
  const roles = thread.automation?.workflowConfig?.roles;
  if (!roles) return null;
  return [
    `orchestrator=${roles.orchestrator.model}`,
    `planner=${roles.planner.model}`,
    `worker=${roles.worker.model}`,
    `verifier=${roles.verifier.model}`,
    `integrator=${roles.integrator.model}`,
    `visual=${roles.visual.model}`,
  ].join(", ");
}

function recoveryContext(thread: OrchestrationThread): string | null {
  const automation = thread.automation;
  if (!automation?.lastError) return null;
  const classification = classifyAutomationFailure(automation.lastError);
  return [
    `Previous attempt failed (${classification.kind}).`,
    `Failure detail: ${automation.lastError}`,
    `Recovery strategy: ${classification.guidance}`,
    "Do not repeat the failed approach unchanged. Confirm the failure is resolved before finishing.",
  ].join("\n");
}

export function buildAutomationPrompt(input: {
  readonly thread: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly policy: OrchestrationProjectAutomationPolicy;
  readonly dependencyBranches?: ReadonlyArray<string>;
  readonly workflowEvidence?: string | null;
}): string {
  const automation = input.thread.automation!;
  const criteria =
    automation.acceptanceCriteria.length === 0
      ? "- Preserve existing behavior and leave the repository in a verified state."
      : automation.acceptanceCriteria.map((criterion) => `- ${criterion}`).join("\n");
  const delivery =
    automation.workflowId !== null
      ? "Commit the finished work locally on this isolated workflow branch. Do not push, open a pull request, merge to the base branch, or mutate another worktree; FACT3 owns integration and base promotion."
      : input.policy.deliveryMode === "pull-request"
        ? "Commit the finished work, push the task branch, and open a pull request. Do not merge it."
        : input.policy.deliveryMode === "push-branch"
          ? "Commit the finished work and push the task branch. Do not merge it."
          : "Commit the finished work locally on the task branch. Do not push or merge it.";
  const feedback = automation.feedback ? `\nReviewer feedback:\n${automation.feedback}\n` : "";
  const context = workflowContext(input.thread);
  const recovery = recoveryContext(input.thread);
  const roleModels = configuredRoleModels(input.thread);
  const planJsonShape =
    '{"summary":"one sentence","tasks":[{"key":"short-stable-key","role":"worker|visual","title":"clear action title","goal":"implementation goal","acceptanceCriteria":["observable check"],"dependsOn":["other-key"],"changeScopes":["relative/path/or/glob"],"verification":["focused command or manual check"]}]}';

  if (automation.taskKind === "planning" || automation.role === "planner") {
    const auditingPlan = automation.phase === "verification";
    return [
      auditingPlan
        ? "You are the orchestrator auditing the prior autonomous FACT3 project plan before execution. Inspect the repository read-only, compare the prior plan with the actual codebase, and correct unsafe assumptions, dependency mistakes, overlapping ownership, missing acceptance criteria, and unnecessary work."
        : "You are planning a real autonomous FACT3 Kanban project. Inspect the repository read-only and decompose the goal into the smallest independent tasks that can safely run in parallel.",
      `Project: ${input.project.title}`,
      `Project goal: ${automation.goal}`,
      ...context,
      roleModels ? `Configured workflow role models: ${roleModels}.` : null,
      "Return only one fenced JSON block. Do not edit files, commit, push, or open a pull request.",
      auditingPlan
        ? "Return a corrected final plan, not an audit verdict or a list of suggested changes. The reactor will parse this response as the executable plan."
        : null,
      "The JSON must have this exact shape:",
      planJsonShape,
      "Assign role=visual only when visual design, interaction, responsive behavior, accessibility, or screenshot-based review is a material part of the task; otherwise use role=worker. Role models are configured by the user, so do not invent model identifiers.",
      "Plan only implementation tasks. FACT3 automatically adds independent verification, integration, and final-audit stages; do not add coordination-only verification, integration, or audit tasks to the plan.",
      "Every task needs at least one acceptance criterion, one narrow change scope, and one verification check. Dependencies must reference task keys and must not contain cycles. Avoid multiple tasks that own the same files; if overlap is unavoidable, express it as a dependency. Keep the plan between 1 and 8 tasks.",
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }

  if (automation.role === "orchestrator") {
    return [
      "You are the orchestrator performing the final audit of an autonomous FACT3 workflow. Inspect the integrated repository state and decide whether the project objective is genuinely complete.",
      `Project: ${input.project.title}`,
      `Project goal: ${automation.goal}`,
      ...context,
      "Acceptance criteria:",
      criteria,
      input.workflowEvidence
        ? `Persisted FACT3 workflow evidence (validate repository claims directly where possible; use lifecycle records for orchestration-only criteria):\n${input.workflowEvidence}`
        : "No persisted workflow evidence was supplied. Do not assume orchestration-only criteria passed.",
      feedback,
      recovery,
      "This is a read-only audit. Do not modify, format, commit, or otherwise change repository files; report repair work in followUpTasks so FACT3 can route it through implementation and verification.",
      'Return only one fenced JSON block with this exact shape: {"status":"complete|repair-required|needs-input","summary":"one sentence","failedCriteria":["criterion"],"remainingRisks":["specific risk"],"followUpTasks":[{"title":"action title","goal":"bounded goal","role":"worker|visual"}]}.',
      "Do not declare completion from task status alone. Check the combined result and cite concrete repository evidence in the JSON.",
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }

  if (automation.phase === "verification" || automation.role === "verifier") {
    return [
      "You are the independent verifier for an autonomous FACT3 Kanban task.",
      `Project: ${input.project.title}`,
      `Goal: ${automation.goal}`,
      ...context,
      "Acceptance criteria:",
      criteria,
      feedback,
      recovery,
      "Inspect the implementation already present in this worktree. Run the smallest relevant tests and static checks, verify every acceptance criterion, and inspect the diff for regressions. Do not modify the implementation to make it pass; report repair work explicitly so a worker can own it.",
      'Return only one fenced JSON block with this exact shape: {"status":"passed|failed","summary":"one sentence","checks":[{"check":"command, criterion, or inspection","detail":"observable result"}]}.',
      "Include one check for every acceptance criterion and every command you ran. For criterion evidence, copy the acceptance criterion text exactly into `check`. Set status=failed when any criterion or required check is unmet. A successful command exit or a completed agent turn is not, by itself, proof that the task is correct; the check detail must state the observable result.",
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }

  if (automation.role === "integrator") {
    return [
      "You are the integration agent for an autonomous FACT3 workflow. Work only in the dedicated integration worktree.",
      `Project: ${input.project.title}`,
      `Goal: ${automation.goal}`,
      ...context,
      "Acceptance criteria:",
      criteria,
      feedback,
      recovery,
      `Dependency branches to integrate in this exact order:\n${
        input.dependencyBranches && input.dependencyBranches.length > 0
          ? input.dependencyBranches.map((branch) => `- ${branch}`).join("\n")
          : "- None supplied; stop and request the missing integration inputs."
      }`,
      "Merge the approved dependency branches in their declared dependency order. If a merge conflicts, inspect both intents, resolve the conflict deliberately, preserve compatible behavior from both sides, and verify the combined result. Never discard a branch or choose one side wholesale merely to make the conflict disappear.",
      "Run focused integration checks after the final merge, leave the worktree clean, and commit the resolved integration result. FACT3 owns the final guarded merge to the base branch; do not mutate another worktree or force-push.",
      'Finish with one fenced JSON block: {"status":"integrated|failed|needs-input","summary":"one sentence","mergedBranches":["branch"],"conflictsResolved":[{"path":"relative/path","resolution":"what intent was preserved"}],"evidence":[{"check":"command or inspection","detail":"observable result"}],"remainingRisks":["specific risk"]}.',
    ]
      .filter((part): part is string => Boolean(part))
      .join("\n\n");
  }

  return [
    automation.role === "visual"
      ? "You are the visual implementation agent for an autonomous FACT3 Kanban task in an isolated worktree. Every visual decision must support hierarchy, clarity, accessibility, or interaction feedback; avoid decorative UI with no product purpose."
      : "You are executing an autonomous FACT3 Kanban task in an isolated worktree.",
    `Project: ${input.project.title}`,
    `Goal: ${automation.goal}`,
    ...context,
    "Acceptance criteria:",
    criteria,
    feedback,
    recovery,
    "Own this task from investigation through implementation. Keep the change scoped to the goal, preserve unrelated user work, and use the repository's existing conventions. Run focused tests and static checks before finishing. Continue through recoverable issues without waiting for routine confirmation.",
    automation.role === "visual"
      ? "Audit typography, spacing, responsive behavior, empty/loading/error states, focus and keyboard behavior, and icon meaning. Capture visual evidence when the repository's test workflow supports it."
      : null,
    delivery,
    "Finish with a concise implementation summary, checks run, results, and any remaining risk. If a required choice or permission is genuinely unavailable, ask one precise question instead of guessing.",
  ]
    .filter((part): part is string => Boolean(part))
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
      thread.automation?.stage === "running" ||
      thread.automation?.stage === "needs-input" ||
      thread.session?.status === "starting" ||
      thread.session?.status === "running",
  ).length;
  return Math.max(0, automationConcurrencyLimit(input.policy) - active);
}

function automationDependencyIsSatisfied(thread: OrchestrationThread): boolean {
  return (
    thread.automation?.stage === "complete" ||
    (thread.automation?.stage === "review" &&
      thread.automation.taskKind === "planning" &&
      thread.automation.workflowConfig?.mode === "automatic")
  );
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
    if (!dependency || !automationDependencyIsSatisfied(dependency) || !dependency.branch) {
      missing.push(dependency?.title ?? dependencyId);
      continue;
    }
    if (dependency.branch === automation.baseBranch || seen.has(dependency.branch)) continue;
    seen.add(dependency.branch);
    branches.push(dependency.branch);
  }

  return { branches, missing };
}

/**
 * Returns only dependency states that cannot become runnable without a plan
 * change or a deliberate retry. Ordinary in-progress dependencies are not
 * blockers; they remain normal scheduler waits.
 */
export function automationDependencyTerminalBlockers(input: {
  readonly thread: OrchestrationThread;
  readonly tasks: ReadonlyArray<OrchestrationThread>;
}): ReadonlyArray<AutomationDependencyTerminalBlocker> {
  const dependencies = input.thread.automation?.dependencies ?? [];
  const byId = new Map(input.tasks.map((task) => [task.id, task]));

  return dependencies.flatMap(
    (dependencyId): ReadonlyArray<AutomationDependencyTerminalBlocker> => {
      const dependency = byId.get(dependencyId);
      if (!dependency) {
        return [
          {
            dependencyId,
            title: dependencyId,
            reason: "missing",
            detail: `Dependency '${dependencyId}' is no longer available. Replan or remove this dependency.`,
          },
        ];
      }
      if (!dependency.automation) {
        return [
          {
            dependencyId,
            title: dependency.title,
            reason: "not-automated",
            detail: `Dependency '${dependency.title}' is not an autonomous task and cannot satisfy this workflow.`,
          },
        ];
      }
      if (dependency.automation.stage === "failed") {
        return [
          {
            dependencyId,
            title: dependency.title,
            reason: "failed",
            detail: dependency.automation.lastError
              ? `Dependency '${dependency.title}' failed: ${dependency.automation.lastError}`
              : `Dependency '${dependency.title}' failed. Retry it or replan the dependent work.`,
          },
        ];
      }
      if (dependency.automation.stage === "cancelled") {
        return [
          {
            dependencyId,
            title: dependency.title,
            reason: "cancelled",
            detail: `Dependency '${dependency.title}' was cancelled. Reopen it or replan the dependent work.`,
          },
        ];
      }
      return [];
    },
  );
}

export function selectRunnableAutomationTasks(input: {
  readonly tasks: ReadonlyArray<OrchestrationThread>;
  readonly availableSlots: number;
}): ReadonlyArray<OrchestrationThread> {
  if (input.availableSlots <= 0) return [];
  const completeIds = new Set(
    input.tasks.filter(automationDependencyIsSatisfied).map((thread) => thread.id),
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
      thread.archivedAt !== null ||
      thread.session?.status === "starting" ||
      thread.session?.status === "running" ||
      thread.latestTurn?.state === "running" ||
      !thread.automation.dependencies.every((dependency) => completeIds.has(dependency))
    ) {
      continue;
    }
    if (automationConflictBlockers(thread, [...active, ...selected]).length > 0) continue;
    selected.push(thread);
  }
  return selected;
}

interface NormalizedScopePrefix {
  readonly prefix: string;
  readonly wildcardStartsSegment: boolean;
}

function normalizedScopePrefix(scope: string): NormalizedScopePrefix | null {
  const normalized = scope.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  const wildcard = normalized.search(/[?*{[]/);
  const rawPrefix = wildcard === -1 ? normalized : normalized.slice(0, wildcard);
  const prefix = rawPrefix.replace(/\/+$/, "").trim();
  return prefix.length > 0
    ? {
        prefix: prefix.toLowerCase(),
        wildcardStartsSegment: wildcard !== -1 && (wildcard === 0 || rawPrefix.endsWith("/")),
      }
    : null;
}

function scopePrefixesOverlap(left: NormalizedScopePrefix, right: NormalizedScopePrefix): boolean {
  if (
    left.prefix === right.prefix ||
    left.prefix.startsWith(`${right.prefix}/`) ||
    right.prefix.startsWith(`${left.prefix}/`)
  ) {
    return true;
  }
  if (!left.wildcardStartsSegment && right.prefix.startsWith(left.prefix)) return true;
  if (!right.wildcardStartsSegment && left.prefix.startsWith(right.prefix)) return true;
  return false;
}

function scopesOverlap(left: string, right: string): boolean {
  const leftPrefix = normalizedScopePrefix(left);
  const rightPrefix = normalizedScopePrefix(right);
  // A leading wildcard has no safe disjoint prefix. Serialize it with every
  // other active scope instead of risking concurrent edits to the same file.
  if (leftPrefix === null || rightPrefix === null) return true;
  return scopePrefixesOverlap(leftPrefix, rightPrefix);
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

export function automationNeedsStartupRecovery(thread: OrchestrationThread): boolean {
  if (thread.automation?.stage !== "running") return false;
  return thread.latestTurn === null || thread.latestTurn.state === "running";
}

// Give a queued workflow enough time for its provider start to be adopted
// before treating the durable queue entry as abandoned.
const AUTOMATION_DISPATCH_ADOPTION_GRACE = { minutes: 5 } as const;

export function automationDispatchAdoptionDeadline(thread: OrchestrationThread): string | null {
  const automation = thread.automation;
  const heartbeat = automation?.lastHeartbeatAt;
  if (automation?.stage !== "running" || heartbeat === null || heartbeat === undefined) return null;
  const currentTurn =
    thread.latestTurn !== null && thread.latestTurn.requestedAt >= heartbeat
      ? thread.latestTurn
      : null;
  const sessionAdopted =
    thread.session !== null &&
    thread.session.status !== "stopped" &&
    thread.session.updatedAt >= heartbeat;
  const turnAdopted = currentTurn !== null;
  const checkpointAdopted = thread.checkpoints.some(
    (checkpoint) => checkpoint.completedAt >= heartbeat,
  );
  if (sessionAdopted || turnAdopted || checkpointAdopted) return null;
  return DateTime.formatIso(
    DateTime.add(DateTime.makeUnsafe(heartbeat), AUTOMATION_DISPATCH_ADOPTION_GRACE),
  );
}

export function automationDispatchStartExpired(input: {
  readonly thread: OrchestrationThread;
  readonly now: string;
}): boolean {
  const deadline = automationDispatchAdoptionDeadline(input.thread);
  return deadline !== null && Date.parse(deadline) <= Date.parse(input.now);
}

const NON_RETRYABLE_AUTOMATION_FAILURES = [
  "no supported vcs repository was detected",
  "not a git repository",
  "does not have any commits",
  "needed a single revision",
  "bad revision 'head'",
  "unknown revision or path not in the working tree",
  "approved dependency output is unavailable",
  "autonomous workflow requires dedicated worktrees and verification",
] as const;

function includesAny(normalized: string, values: ReadonlyArray<string>): boolean {
  return values.some((value) => normalized.includes(value));
}

/**
 * Classifies flattened runtime failures at the pure decision boundary. Typed
 * provider and Git errors should eventually feed this function directly; the
 * textual matching keeps today's persisted failures adaptive and predictable.
 */
export function classifyAutomationFailure(detail: string): AutomationFailureClassification {
  const normalized = detail.trim().toLowerCase();

  if (NON_RETRYABLE_AUTOMATION_FAILURES.some((failure) => normalized.includes(failure))) {
    const dependencyFailure = normalized.includes("approved dependency output is unavailable");
    return dependencyFailure
      ? {
          kind: "dependency",
          retryable: false,
          strategy: "stop",
          guidance:
            "Do not repeat the run. Reopen the missing dependency or replan the graph before dispatching again.",
        }
      : {
          kind: "repository-setup",
          retryable: false,
          strategy: "stop",
          guidance:
            "Do not repeat the run. Initialize or repair the repository and create a valid base commit first.",
        };
  }

  if (
    includesAny(normalized, [
      "the base worktree has uncommitted changes",
      "the primary worktree is on",
      "switch it to",
    ])
  ) {
    return {
      kind: "repository-setup",
      retryable: false,
      strategy: "request-input",
      guidance:
        "Do not repeat integration against the primary checkout. Ask the user to preserve its changes and switch it to the configured base branch, then retry.",
    };
  }

  if (
    includesAny(normalized, [
      "merge conflict",
      "merge failed",
      "automatic merge failed",
      "conflict in ",
      "fix conflicts and then commit",
    ])
  ) {
    return {
      kind: "merge-conflict",
      retryable: true,
      strategy: "resolve-conflict",
      guidance:
        "Preserve the conflicted integration worktree, inspect both branch intents, resolve each conflict deliberately, and rerun integration checks.",
    };
  }

  if (
    includesAny(normalized, [
      "verification",
      "test failed",
      "tests failed",
      "typecheck failed",
      "lint failed",
      "acceptance criterion",
    ])
  ) {
    return {
      kind: "verification",
      retryable: true,
      strategy: "repair-verification",
      guidance:
        "Use the failed checks as repair requirements, change only the responsible implementation, and rerun every failed check before verification repeats.",
    };
  }

  if (
    includesAny(normalized, [
      "exceeded its runtime limit",
      "timed out",
      "timeout",
      "no agent activity",
      "stalled",
    ])
  ) {
    return {
      kind: "timeout",
      retryable: true,
      strategy: "retry",
      guidance:
        "Wait for the previous provider turn to stop, narrow the next attempt to the unfinished work, and retry from the durable checkpoint.",
    };
  }

  if (
    includesAny(normalized, [
      "permission denied",
      "approval required",
      "authentication required",
      "not authorized",
      "credentials",
      "needs user input",
    ])
  ) {
    return {
      kind: "permission",
      retryable: false,
      strategy: "request-input",
      guidance:
        "Ask one concrete permission or credential question. Resume only after the missing authority is supplied.",
    };
  }

  if (
    includesAny(normalized, [
      "provider process",
      "provider startup",
      "transport error",
      "connection reset",
      "connection closed",
      "rate limit",
      "service unavailable",
      "exited unexpectedly",
      "did not adopt the autonomous turn",
    ])
  ) {
    return {
      kind: "provider",
      retryable: true,
      strategy: "retry",
      guidance:
        "Wait for provider quiescence, retain the worktree and checkpoint, then resume from the last durable progress.",
    };
  }

  return {
    kind: "unknown",
    retryable: true,
    strategy: "retry",
    guidance:
      "Inspect the failure and current diff, choose a materially different approach, and retry from the last durable checkpoint.",
  };
}

/**
 * Permanent repository setup failures cannot improve on another autonomous
 * attempt. Leave those for the user once, while transient provider/runtime
 * failures keep using the configured retry budget.
 */
export function automationFailureCanRetry(detail: string): boolean {
  return classifyAutomationFailure(detail).retryable;
}

/**
 * Produces one bounded retry decision for either automation phase. The caller
 * persists `nextAttempt` before dispatch, so verification consumes the same
 * finite task budget instead of silently reusing the prior attempt forever.
 */
export function automationRetryDecision(input: {
  readonly thread: OrchestrationThread;
  readonly detail: string;
  readonly phase?: OrchestrationAutomationPhase;
}): AutomationRetryDecision {
  const automation = input.thread.automation;
  const phase = input.phase ?? automation?.phase ?? "implementation";
  const classification = classifyAutomationFailure(input.detail);
  const nextAttempt = (automation?.attempt ?? 0) + 1;
  const budgetAvailable = automation !== undefined && nextAttempt <= automation.maxAttempts;
  const canRetry = classification.retryable && budgetAvailable;
  const phaseGuidance =
    phase === "verification"
      ? "Treat the verifier evidence as input to a repair attempt; require a fresh verification pass afterward."
      : "Resume from the last durable checkpoint and keep the next implementation attempt scoped to the failure.";
  const budgetGuidance = canRetry
    ? `Dispatch attempt ${nextAttempt} of ${automation!.maxAttempts}.`
    : automation
      ? `The retry budget is exhausted at ${automation.maxAttempts} attempts; do not dispatch again.`
      : "The task has no automation state; do not dispatch a retry.";

  return {
    phase,
    canRetry,
    nextAttempt,
    classification,
    guidance: `${classification.guidance} ${phaseGuidance} ${budgetGuidance}`,
  };
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
      .toSorted((left, right) => left.completedAt.localeCompare(right.completedAt))[0] ?? null
  );
}

function automationActivityRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function automationActivityString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const ACTIVE_SUBAGENT_STATUSES = new Set(["pendingInit", "running", "inProgress", "started"]);
const TERMINAL_SUBAGENT_STATUSES = new Set([
  "completed",
  "shutdown",
  "finished",
  "failed",
  "error",
  "errored",
  "interrupted",
  "stopped",
  "cancelled",
  "closed",
]);

/** Returns true while any child or nested child from the current dispatch is live. */
export function automationHasActiveSubagents(thread: OrchestrationThread): boolean {
  const heartbeat = thread.automation?.lastHeartbeatAt;
  if (!heartbeat) return false;
  const activeById = new Map<string, boolean>();

  for (const activity of thread.activities
    .filter((candidate) => candidate.createdAt >= heartbeat)
    .toSorted((left, right) => {
      if (left.sequence !== undefined && right.sequence !== undefined) {
        return left.sequence - right.sequence;
      }
      return left.createdAt.localeCompare(right.createdAt);
    })) {
    const payload = automationActivityRecord(activity.payload);
    if (automationActivityString(payload?.itemType) !== "collab_agent_tool_call") continue;
    const data = automationActivityRecord(payload?.data);
    const item = automationActivityRecord(data?.item) ?? data;
    const collab = automationActivityRecord(payload?.collab);
    const tool = automationActivityString(collab?.tool) ?? automationActivityString(item?.tool);
    const directId = automationActivityString(item?.agentThreadId);
    const directPath = automationActivityString(item?.agentPath);
    const receiverIds = new Set<string>();
    for (const candidate of [collab?.receiverThreadIds, item?.receiverThreadIds]) {
      if (!Array.isArray(candidate)) continue;
      for (const value of candidate) {
        const id = automationActivityString(value);
        if (id) receiverIds.add(id);
      }
    }
    if (directId && directPath !== "/root") receiverIds.add(directId);

    if (tool === "spawnAgent" || tool === "resumeAgent") {
      for (const id of receiverIds) activeById.set(id, true);
    }

    for (const statesValue of [collab?.agentsStates, item?.agentsStates]) {
      const states = automationActivityRecord(statesValue);
      if (!states) continue;
      for (const id of receiverIds) {
        const state = automationActivityRecord(states[id]);
        const status = automationActivityString(state?.status);
        if (status && ACTIVE_SUBAGENT_STATUSES.has(status)) activeById.set(id, true);
        if (status && TERMINAL_SUBAGENT_STATUSES.has(status)) activeById.set(id, false);
      }
    }

    if (directId && automationActivityString(item?.type) === "subAgentActivity") {
      const kind = automationActivityString(item?.kind);
      if (kind && ACTIVE_SUBAGENT_STATUSES.has(kind)) activeById.set(directId, true);
      if (kind && TERMINAL_SUBAGENT_STATUSES.has(kind)) activeById.set(directId, false);
    }
  }

  return [...activeById.values()].some(Boolean);
}
