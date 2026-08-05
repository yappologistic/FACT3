import {
  CheckpointRef,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectAutomationPolicy,
  type OrchestrationProject,
  type OrchestrationAutonomousWorkflowConfig,
  type OrchestrationThread,
  type OrchestrationThreadAutomation,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  automationAvailableSlots,
  automationCanRetry,
  automationNeedsStartupRecovery,
  automationConflictBlockers,
  automationConcurrencyLimit,
  automationDependencyTerminalBlockers,
  automationDispatchAdoptionDeadline,
  automationDispatchCompletion,
  automationDispatchStartExpired,
  automationFailureCanRetry,
  automationHasActiveSubagents,
  automationIsStalled,
  automationRetryDecision,
  automationStuckDeadline,
  buildAutomationPrompt,
  classifyAutomationFailure,
  resolveAutomationDependencyBranches,
  selectRunnableAutomationTasks,
} from "./AutomationReactor.logic.ts";

const NOW = "2026-08-03T12:00:00.000Z";
const policy: OrchestrationProjectAutomationPolicy = {
  enabled: true,
  maxConcurrentRuns: 3,
  defaultMaxAttempts: 2,
  defaultMaxRuntimeMinutes: 60,
  stuckAfterMinutes: 15,
  createWorktrees: true,
  requireVerification: true,
  requireReview: true,
  deliveryMode: "local-commit",
};

const modelSelection = (model: string) => ({
  instanceId: ProviderInstanceId.make("codex"),
  model,
});

const workflowConfig: OrchestrationAutonomousWorkflowConfig = {
  mode: "automatic",
  roles: {
    orchestrator: modelSelection("orchestrator-model"),
    planner: modelSelection("planner-model"),
    worker: modelSelection("worker-model"),
    verifier: modelSelection("verifier-model"),
    integrator: modelSelection("integrator-model"),
    visual: modelSelection("visual-model"),
  },
};

function task(input: {
  readonly id: string;
  readonly stage: OrchestrationThreadAutomation["stage"];
  readonly dependencies?: ReadonlyArray<ThreadId>;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly changeScopes?: ReadonlyArray<string>;
  readonly taskKind?: OrchestrationThreadAutomation["taskKind"];
  readonly role?: OrchestrationThreadAutomation["role"];
  readonly phase?: OrchestrationThreadAutomation["phase"];
  readonly lastError?: string | null;
  readonly workflowConfig?: OrchestrationAutonomousWorkflowConfig;
  readonly workflowId?: ThreadId | null;
  readonly acceptanceCriteria?: ReadonlyArray<string>;
  readonly branch?: string | null;
  readonly archivedAt?: string | null;
}): OrchestrationThread {
  const id = ThreadId.make(input.id);
  return {
    id,
    projectId: ProjectId.make("project"),
    title: input.id,
    modelSelection: modelSelection("gpt-5.6-sol"),
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: input.branch === undefined ? "main" : input.branch,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: input.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    deletedAt: null,
    messages: [],
    proposedPlans: [],
    activities: [],
    checkpoints: [],
    session: null,
    automation: {
      taskKind: input.taskKind ?? "implementation",
      workflowId: input.workflowId === undefined ? ThreadId.make("workflow") : input.workflowId,
      workflowTaskKey: input.id,
      role: input.role ?? "worker",
      ...(input.workflowConfig ? { workflowConfig: input.workflowConfig } : {}),
      goal: input.id,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      dependencies: input.dependencies ?? [],
      changeScopes: input.changeScopes ?? [],
      baseBranch: "main",
      stage: input.stage,
      phase: input.phase ?? "implementation",
      attempt: input.attempt ?? 0,
      maxAttempts: input.maxAttempts ?? 2,
      maxRuntimeMinutes: 60,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastError: input.lastError ?? null,
      feedback: null,
      verification: { status: "pending", summary: null, evidence: [], completedAt: null },
      startedAt: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

function projectFor(thread: OrchestrationThread): OrchestrationProject {
  return {
    id: thread.projectId,
    title: "FACT3",
    workspaceRoot: "D:/FACT3",
    repositoryIdentity: null,
    defaultModelSelection: thread.modelSelection,
    scripts: [],
    automationPolicy: policy,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

describe("automation scheduler decisions", () => {
  it("materializes approved dependency branches in declared order", () => {
    const first = task({ id: "first", stage: "complete", branch: "t3code/first" });
    const second = task({ id: "second", stage: "complete", branch: "t3code/second" });
    const duplicate = task({ id: "duplicate", stage: "complete", branch: "t3code/first" });
    const alreadyOnBase = task({ id: "base", stage: "complete", branch: "main" });
    const dependent = task({
      id: "dependent",
      stage: "ready",
      dependencies: [first.id, second.id, duplicate.id, alreadyOnBase.id],
    });

    expect(
      resolveAutomationDependencyBranches({
        thread: dependent,
        tasks: [dependent, second, alreadyOnBase, first, duplicate],
      }),
    ).toEqual({ branches: ["t3code/first", "t3code/second"], missing: [] });
  });

  it("reports dependency output that cannot be materialized", () => {
    const missingBranch = task({ id: "missing branch", stage: "complete", branch: null });
    const unfinished = task({ id: "unfinished", stage: "review", branch: "t3code/review" });
    const dependent = task({
      id: "dependent",
      stage: "ready",
      dependencies: [missingBranch.id, unfinished.id, ThreadId.make("unknown")],
    });

    expect(
      resolveAutomationDependencyBranches({
        thread: dependent,
        tasks: [dependent, missingBranch, unfinished],
      }),
    ).toEqual({ branches: [], missing: ["missing branch", "unfinished", "unknown"] });
  });

  it("surfaces terminal dependency blockers without treating ordinary waits as failures", () => {
    const failed = task({ id: "failed", stage: "failed", lastError: "Focused tests failed." });
    const cancelled = task({ id: "cancelled", stage: "cancelled" });
    const running = task({ id: "running", stage: "running" });
    const manual = { ...task({ id: "manual", stage: "ready" }), automation: undefined };
    const dependent = task({
      id: "dependent",
      stage: "ready",
      dependencies: [failed.id, cancelled.id, running.id, manual.id, ThreadId.make("deleted")],
    });

    expect(
      automationDependencyTerminalBlockers({
        thread: dependent,
        tasks: [dependent, failed, cancelled, running, manual],
      }),
    ).toEqual([
      {
        dependencyId: failed.id,
        title: "failed",
        reason: "failed",
        detail: "Dependency 'failed' failed: Focused tests failed.",
      },
      {
        dependencyId: cancelled.id,
        title: "cancelled",
        reason: "cancelled",
        detail: "Dependency 'cancelled' was cancelled. Reopen it or replan the dependent work.",
      },
      {
        dependencyId: manual.id,
        title: "manual",
        reason: "not-automated",
        detail: "Dependency 'manual' is not an autonomous task and cannot satisfy this workflow.",
      },
      {
        dependencyId: "deleted",
        title: "deleted",
        reason: "missing",
        detail: "Dependency 'deleted' is no longer available. Replan or remove this dependency.",
      },
    ]);
  });

  it("forces serial execution without worktrees", () => {
    expect(automationConcurrencyLimit({ ...policy, createWorktrees: false })).toBe(1);
    expect(
      automationAvailableSlots({
        policy: { ...policy, createWorktrees: false },
        tasks: [task({ id: "running", stage: "running" })],
      }),
    ).toBe(0);
  });

  it("counts needs-input runs against bounded project capacity", () => {
    expect(
      automationAvailableSlots({
        policy,
        tasks: [
          task({ id: "running", stage: "running" }),
          task({ id: "waiting", stage: "needs-input" }),
        ],
      }),
    ).toBe(1);
  });

  it("starts only dependency-ready tasks and respects available slots", () => {
    const complete = task({ id: "complete", stage: "complete" });
    const blockedByComplete = task({
      id: "ready-after-complete",
      stage: "ready",
      dependencies: [complete.id],
    });
    const pending = task({ id: "pending", stage: "running" });
    const blocked = task({
      id: "blocked",
      stage: "ready",
      dependencies: [pending.id],
    });
    const independent = task({ id: "independent", stage: "ready" });

    expect(
      selectRunnableAutomationTasks({
        tasks: [complete, blockedByComplete, pending, blocked, independent],
        availableSlots: 1,
      }).map((candidate) => candidate.id),
    ).toEqual([blockedByComplete.id]);
  });

  it("treats an automatic workflow root in coordination as a satisfied barrier", () => {
    const root = task({
      id: "workflow-root",
      stage: "review",
      taskKind: "planning",
      workflowConfig,
      workflowId: ThreadId.make("workflow-root"),
    });
    const child = task({
      id: "child",
      stage: "ready",
      dependencies: [root.id],
    });

    expect(
      selectRunnableAutomationTasks({ tasks: [root, child], availableSlots: 1 }).map(
        (candidate) => candidate.id,
      ),
    ).toEqual([child.id]);
    expect(resolveAutomationDependencyBranches({ thread: child, tasks: [root, child] })).toEqual({
      branches: [],
      missing: [],
    });
  });

  it("does not redispatch a ready task until its previous provider turn is quiescent", () => {
    const ready = task({ id: "ready-but-stopping", stage: "ready" });
    const stopping: OrchestrationThread = {
      ...ready,
      session: {
        threadId: ready.id,
        status: "running",
        providerName: "Codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    };

    expect(selectRunnableAutomationTasks({ tasks: [stopping], availableSlots: 1 })).toEqual([]);
  });

  it("keeps overlapping change scopes out of the same parallel batch", () => {
    const active = task({
      id: "active-web",
      stage: "running",
      changeScopes: ["apps/web/src/components"],
    });
    const conflicting = task({
      id: "conflicting-web",
      stage: "ready",
      changeScopes: ["apps/web/src/components/kanban/**"],
    });
    const independent = task({
      id: "independent-server",
      stage: "ready",
      changeScopes: ["apps/server/src/**"],
    });

    expect(automationConflictBlockers(conflicting, [active])).toEqual([active]);
    expect(
      selectRunnableAutomationTasks({
        tasks: [active, conflicting, independent],
        availableSlots: 2,
      }).map((candidate) => candidate.id),
    ).toEqual([independent.id]);
  });

  it("conservatively serializes leading and partial-segment wildcard scopes", () => {
    const global = task({ id: "global", stage: "running", changeScopes: ["**/*"] });
    const partial = task({ id: "partial", stage: "running", changeScopes: ["Kanban*.tsx"] });
    const web = task({
      id: "web",
      stage: "ready",
      changeScopes: ["apps/web/src/KanbanBoard.tsx"],
    });
    const kanban = task({ id: "kanban", stage: "ready", changeScopes: ["KanbanBoard.tsx"] });

    expect(automationConflictBlockers(web, [global])).toEqual([global]);
    expect(automationConflictBlockers(kanban, [partial])).toEqual([partial]);
  });

  it("never schedules an archived automation task", () => {
    const archived = task({
      id: "archived",
      stage: "ready",
      archivedAt: "2026-08-03T12:00:00.000Z",
    });

    expect(selectRunnableAutomationTasks({ tasks: [archived], availableSlots: 1 })).toEqual([]);
  });

  it("does not dispatch two conflicting ready tasks in one scheduling pass", () => {
    const first = task({ id: "first", stage: "ready", changeScopes: ["packages/contracts"] });
    const second = task({
      id: "second",
      stage: "ready",
      changeScopes: ["packages/contracts/src/orchestration.ts"],
    });

    expect(
      selectRunnableAutomationTasks({ tasks: [first, second], availableSlots: 2 }).map(
        (candidate) => candidate.id,
      ),
    ).toEqual([first.id]);
  });

  it("detects a silent run from its latest durable progress timestamp", () => {
    const running = task({ id: "silent", stage: "running" });
    const withHeartbeat: OrchestrationThread = {
      ...running,
      session: {
        threadId: running.id,
        status: "running",
        providerName: "Codex",
        providerInstanceId: ProviderInstanceId.make("codex"),
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-08-03T12:04:00.000Z",
      },
      automation: {
        ...running.automation!,
        startedAt: "2026-08-03T12:00:00.000Z",
        lastHeartbeatAt: "2026-08-03T12:04:00.000Z",
      },
    };

    expect(automationStuckDeadline({ thread: withHeartbeat, policy })).toBe(
      "2026-08-03T12:19:00.000Z",
    );
    expect(
      automationIsStalled({
        thread: withHeartbeat,
        policy,
        now: "2026-08-03T12:18:59.999Z",
      }),
    ).toBe(false);
    expect(
      automationIsStalled({
        thread: withHeartbeat,
        policy,
        now: "2026-08-03T12:19:00.000Z",
      }),
    ).toBe(true);
  });

  it("gives planning tasks a read-only structured-output contract", () => {
    const planning = task({
      id: "project-plan",
      stage: "running",
      taskKind: "planning",
      role: "planner",
      workflowConfig,
    });
    const prompt = buildAutomationPrompt({
      thread: planning,
      project: projectFor(planning),
      policy,
    });
    expect(prompt).toContain("Inspect the repository read-only");
    expect(prompt).toContain('"changeScopes"');
    expect(prompt).toContain('"role":"worker|visual"');
    expect(prompt).toContain("Role models are configured by the user");
    expect(prompt).toContain("visual=visual-model");
    expect(prompt).toContain("Do not edit files, commit, push, or open a pull request.");
  });

  it("gives root orchestrators executable plan JSON before a corrected plan audit", () => {
    const planning = task({
      id: "initial-plan",
      stage: "running",
      taskKind: "planning",
      role: "orchestrator",
    });
    const planAudit = task({
      id: "audit-plan",
      stage: "running",
      taskKind: "planning",
      role: "orchestrator",
      phase: "verification",
    });
    const finalAudit = task({ id: "final-audit", stage: "running", role: "orchestrator" });

    const planningPrompt = buildAutomationPrompt({
      thread: planning,
      project: projectFor(planning),
      policy,
    });
    const planAuditPrompt = buildAutomationPrompt({
      thread: planAudit,
      project: projectFor(planAudit),
      policy,
    });
    const finalPrompt = buildAutomationPrompt({
      thread: finalAudit,
      project: projectFor(finalAudit),
      policy,
    });

    expect(planningPrompt).toContain("planning a real autonomous FACT3 Kanban project");
    expect(planningPrompt).toContain('"tasks"');
    expect(planningPrompt).toContain('"role":"worker|visual"');
    expect(planAuditPrompt).toContain("auditing the prior autonomous FACT3 project plan");
    expect(planAuditPrompt).toContain("Return a corrected final plan");
    expect(planAuditPrompt).toContain('"tasks"');
    expect(planAuditPrompt).not.toContain('"requiredChanges"');
    expect(planAuditPrompt).not.toContain('"status":"approved');
    expect(finalPrompt).toContain("performing the final audit");
    expect(finalPrompt).toContain('"status":"complete|repair-required|needs-input"');
    expect(finalPrompt).toContain('"followUpTasks"');
  });

  it("requires verifier evidence and keeps verification independent from repairs", () => {
    const verifier = task({
      id: "verify-search",
      stage: "running",
      role: "verifier",
      phase: "verification",
      acceptanceCriteria: ["Keyboard navigation works"],
    });
    const prompt = buildAutomationPrompt({
      thread: verifier,
      project: projectFor(verifier),
      policy,
    });

    expect(prompt).toContain("independent verifier");
    expect(prompt).toContain("Do not modify the implementation");
    expect(prompt).toContain('"summary":"one sentence"');
    expect(prompt).toContain('"checks"');
    expect(prompt).toContain('"status":"passed|failed"');
    expect(prompt).not.toContain('"evidence"');
    expect(prompt).toContain("one check for every acceptance criterion");
    expect(prompt).toContain("Set status=failed when any criterion or required check is unmet");
  });

  it("instructs integrators to preserve intent while resolving dependency conflicts", () => {
    const integrator = task({ id: "integrate-workflow", stage: "running", role: "integrator" });
    const prompt = buildAutomationPrompt({
      thread: integrator,
      project: projectFor(integrator),
      policy,
      dependencyBranches: ["t3code/contracts", "t3code/web"],
    });

    expect(prompt).toContain("dedicated integration worktree");
    expect(prompt).toContain("declared dependency order");
    expect(prompt).toContain("- t3code/contracts\n- t3code/web");
    expect(prompt).toContain("resolve the conflict deliberately");
    expect(prompt).toContain("Never discard a branch");
    expect(prompt).toContain('"conflictsResolved"');
  });

  it("keeps workflow subtasks local while preserving legacy standalone delivery", () => {
    const workflowTask = task({ id: "workflow-worker", stage: "running", role: "worker" });
    const standaloneTask = task({
      id: "standalone-worker",
      stage: "running",
      role: "worker",
      workflowId: null,
    });
    const pullRequestPolicy = { ...policy, deliveryMode: "pull-request" as const };

    const workflowPrompt = buildAutomationPrompt({
      thread: workflowTask,
      project: projectFor(workflowTask),
      policy: pullRequestPolicy,
    });
    const standalonePrompt = buildAutomationPrompt({
      thread: standaloneTask,
      project: projectFor(standaloneTask),
      policy: pullRequestPolicy,
    });

    expect(workflowPrompt).toContain("locally on this isolated workflow branch");
    expect(workflowPrompt).toContain("FACT3 owns integration and base promotion");
    expect(workflowPrompt).not.toContain("open a pull request. Do not merge it");
    expect(standalonePrompt).toContain("open a pull request. Do not merge it");
  });

  it("includes adaptive recovery context instead of repeating a failed approach", () => {
    const recovering = task({
      id: "recover",
      stage: "running",
      lastError: "Typecheck failed in the Kanban package.",
    });
    const prompt = buildAutomationPrompt({
      thread: recovering,
      project: projectFor(recovering),
      policy,
    });

    expect(prompt).toContain("Previous attempt failed (verification)");
    expect(prompt).toContain("Use the failed checks as repair requirements");
    expect(prompt).toContain("Do not repeat the failed approach unchanged");
  });

  it("stops retrying exactly at the configured attempt budget", () => {
    expect(automationCanRetry(task({ id: "retry", stage: "failed", attempt: 1 }))).toBe(true);
    expect(
      automationCanRetry(task({ id: "exhausted", stage: "failed", attempt: 2, maxAttempts: 2 })),
    ).toBe(false);
  });

  it("recovers a running task whose provider turn was lost during server startup", () => {
    expect(automationNeedsStartupRecovery(task({ id: "lost-start", stage: "running" }))).toBe(true);
    expect(automationNeedsStartupRecovery(task({ id: "ordinary-queue", stage: "ready" }))).toBe(
      false,
    );
  });

  it("retries a queued provider turn only after its adoption grace window expires", () => {
    const running = task({ id: "queued-provider-start", stage: "running" });
    const queued: OrchestrationThread = {
      ...running,
      automation: {
        ...running.automation!,
        lastHeartbeatAt: "2026-08-03T12:00:00.000Z",
      },
    };

    expect(automationDispatchAdoptionDeadline(queued)).toBe("2026-08-03T12:05:00.000Z");
    expect(
      automationDispatchStartExpired({ thread: queued, now: "2026-08-03T12:04:59.999Z" }),
    ).toBe(false);
    expect(
      automationDispatchStartExpired({ thread: queued, now: "2026-08-03T12:05:00.000Z" }),
    ).toBe(true);
  });

  it("does not expire a dispatch that completed before reconciliation observed it", () => {
    const running = task({ id: "fast-completion", stage: "running" });
    const heartbeat = "2026-08-03T12:00:00.000Z";
    const completed: OrchestrationThread = {
      ...running,
      automation: { ...running.automation!, lastHeartbeatAt: heartbeat },
      session: {
        threadId: running.id,
        status: "ready",
        providerName: "codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: "2026-08-03T12:00:30.000Z",
      },
      checkpoints: [
        {
          turnId: TurnId.make("fast-turn"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/fast-turn"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: "2026-08-03T12:00:30.000Z",
        },
      ],
    };

    expect(automationDispatchAdoptionDeadline(completed)).toBeNull();
    expect(
      automationDispatchStartExpired({ thread: completed, now: "2026-08-03T12:10:00.000Z" }),
    ).toBe(false);
  });

  it("retries transient failures but stops on permanent repository setup failures", () => {
    expect(automationFailureCanRetry("The provider process exited unexpectedly.")).toBe(true);
    expect(automationFailureCanRetry("The autonomous run exceeded its runtime limit.")).toBe(true);
    expect(
      automationFailureCanRetry(
        "No supported VCS repository was detected at D:/project. Initialize Git first.",
      ),
    ).toBe(false);
    expect(
      automationFailureCanRetry(
        "git worktree add failed because HEAD does not have any commits yet",
      ),
    ).toBe(false);
    expect(
      automationFailureCanRetry(
        "Approved dependency output is unavailable for: contracts. Reopen the task.",
      ),
    ).toBe(false);
  });

  it("classifies failures into intentional recovery strategies", () => {
    expect(classifyAutomationFailure("CONFLICT in apps/web/Kanban.tsx")).toMatchObject({
      kind: "merge-conflict",
      retryable: true,
      strategy: "resolve-conflict",
    });
    expect(classifyAutomationFailure("Focused tests failed during verification")).toMatchObject({
      kind: "verification",
      retryable: true,
      strategy: "repair-verification",
    });
    expect(
      classifyAutomationFailure("The autonomous run exceeded its runtime limit"),
    ).toMatchObject({
      kind: "timeout",
      retryable: true,
      strategy: "retry",
    });
    expect(classifyAutomationFailure("Authentication required for the remote")).toMatchObject({
      kind: "permission",
      retryable: false,
      strategy: "request-input",
    });
    expect(
      classifyAutomationFailure("No supported VCS repository was detected at D:/project"),
    ).toMatchObject({ kind: "repository-setup", retryable: false, strategy: "stop" });
    expect(classifyAutomationFailure("The base worktree has uncommitted changes.")).toMatchObject({
      kind: "repository-setup",
      retryable: false,
      strategy: "request-input",
    });
  });

  it("bounds retries in both implementation and verification phases", () => {
    const implementation = task({
      id: "implementation-retry",
      stage: "failed",
      phase: "implementation",
      attempt: 1,
      maxAttempts: 2,
    });
    const verification = task({
      id: "verification-retry",
      stage: "failed",
      phase: "verification",
      attempt: 1,
      maxAttempts: 2,
    });

    expect(
      automationRetryDecision({
        thread: implementation,
        detail: "The provider process exited unexpectedly.",
      }),
    ).toMatchObject({ phase: "implementation", canRetry: true, nextAttempt: 2 });
    expect(
      automationRetryDecision({
        thread: verification,
        detail: "Verification tests failed.",
      }),
    ).toMatchObject({ phase: "verification", canRetry: true, nextAttempt: 2 });
    expect(
      automationRetryDecision({
        thread: {
          ...verification,
          automation: { ...verification.automation!, attempt: 2 },
        },
        detail: "Verification tests failed again.",
      }),
    ).toMatchObject({ phase: "verification", canRetry: false, nextAttempt: 3 });
  });

  it("recognizes a completed dispatch after the shell clears latestTurn", () => {
    const running = task({ id: "completed-dispatch", stage: "running" });
    const heartbeat = "2026-08-03T12:00:10.000Z";
    const completedAt = "2026-08-03T12:01:00.000Z";
    const checkpoint = {
      turnId: TurnId.make("turn-1"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoints/turn-1"),
      status: "ready" as const,
      files: [],
      assistantMessageId: null,
      completedAt,
    };
    const completed: OrchestrationThread = {
      ...running,
      latestTurn: null,
      checkpoints: [checkpoint],
      automation: {
        ...running.automation!,
        lastHeartbeatAt: heartbeat,
      },
    };

    expect(automationDispatchCompletion(completed)).toEqual(checkpoint);
  });

  it("ignores a checkpoint from an earlier automation phase", () => {
    const running = task({ id: "stale-checkpoint", stage: "running" });
    const completed: OrchestrationThread = {
      ...running,
      checkpoints: [
        {
          turnId: TurnId.make("old-turn"),
          checkpointTurnCount: 1,
          checkpointRef: CheckpointRef.make("refs/t3/checkpoints/old-turn"),
          status: "ready",
          files: [],
          assistantMessageId: null,
          completedAt: "2026-08-03T12:00:05.000Z",
        },
      ],
      automation: {
        ...running.automation!,
        lastHeartbeatAt: "2026-08-03T12:00:10.000Z",
      },
    };

    expect(automationDispatchCompletion(completed)).toBeNull();
  });

  it("uses the first checkpoint after dispatch so late subagent checkpoints cannot replace it", () => {
    const running = task({ id: "checkpoint-order", stage: "running" });
    const first = {
      turnId: TurnId.make("parent-turn"),
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make("refs/t3/checkpoints/parent-turn"),
      status: "ready" as const,
      files: [],
      assistantMessageId: null,
      completedAt: "2026-08-03T12:01:00.000Z",
    };
    const lateChild = {
      ...first,
      turnId: TurnId.make("child-turn"),
      checkpointRef: CheckpointRef.make("refs/t3/checkpoints/child-turn"),
      completedAt: "2026-08-03T12:02:00.000Z",
    };
    const completed: OrchestrationThread = {
      ...running,
      checkpoints: [lateChild, first],
      automation: {
        ...running.automation!,
        lastHeartbeatAt: "2026-08-03T12:00:00.000Z",
      },
    };

    expect(automationDispatchCompletion(completed)).toEqual(first);
  });

  it("keeps a dispatch open until nested subagents reach terminal states", () => {
    const running = task({ id: "nested-agents", stage: "running" });
    const withActivities: OrchestrationThread = {
      ...running,
      automation: {
        ...running.automation!,
        lastHeartbeatAt: "2026-08-03T12:00:00.000Z",
      },
      activities: [
        {
          id: EventId.make("spawn-child"),
          kind: "tool.started",
          tone: "tool",
          summary: "Spawn child",
          turnId: TurnId.make("parent-turn"),
          payload: {
            itemType: "collab_agent_tool_call",
            collab: {
              tool: "spawnAgent",
              receiverThreadIds: ["child"],
              agentsStates: { child: { status: "running" } },
            },
          },
          sequence: 1,
          createdAt: "2026-08-03T12:00:10.000Z",
        },
        {
          id: EventId.make("spawn-grandchild"),
          kind: "tool.started",
          tone: "tool",
          summary: "Spawn grandchild",
          turnId: TurnId.make("parent-turn"),
          payload: {
            itemType: "collab_agent_tool_call",
            collab: {
              tool: "spawnAgent",
              receiverThreadIds: ["grandchild"],
              agentsStates: { grandchild: { status: "running" } },
            },
          },
          sequence: 2,
          createdAt: "2026-08-03T12:00:20.000Z",
        },
        {
          id: EventId.make("finish-child"),
          kind: "tool.completed",
          tone: "tool",
          summary: "Child finished",
          turnId: TurnId.make("parent-turn"),
          payload: {
            itemType: "collab_agent_tool_call",
            collab: {
              tool: "wait",
              receiverThreadIds: ["child"],
              agentsStates: { child: { status: "completed" } },
            },
          },
          sequence: 3,
          createdAt: "2026-08-03T12:00:30.000Z",
        },
      ],
    };

    expect(automationHasActiveSubagents(withActivities)).toBe(true);
    expect(
      automationHasActiveSubagents({
        ...withActivities,
        activities: [
          ...withActivities.activities,
          {
            id: EventId.make("finish-grandchild"),
            kind: "tool.completed",
            tone: "tool",
            summary: "Grandchild finished",
            turnId: TurnId.make("parent-turn"),
            payload: {
              itemType: "collab_agent_tool_call",
              data: {
                item: {
                  type: "subAgentActivity",
                  kind: "completed",
                  agentThreadId: "grandchild",
                  agentPath: "/root/child/grandchild",
                },
              },
            },
            sequence: 4,
            createdAt: "2026-08-03T12:00:40.000Z",
          },
        ],
      }),
    ).toBe(false);
  });
});
