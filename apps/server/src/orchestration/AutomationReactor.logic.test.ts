import {
  CheckpointRef,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectAutomationPolicy,
  type OrchestrationProject,
  type OrchestrationThread,
  type OrchestrationThreadAutomation,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  automationAvailableSlots,
  automationCanRetry,
  automationConflictBlockers,
  automationConcurrencyLimit,
  automationDispatchCompletion,
  automationFailureCanRetry,
  automationIsStalled,
  automationStuckDeadline,
  buildAutomationPrompt,
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

function task(input: {
  readonly id: string;
  readonly stage: OrchestrationThreadAutomation["stage"];
  readonly dependencies?: ReadonlyArray<ThreadId>;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly changeScopes?: ReadonlyArray<string>;
  readonly taskKind?: OrchestrationThreadAutomation["taskKind"];
  readonly branch?: string | null;
}): OrchestrationThread {
  const id = ThreadId.make(input.id);
  return {
    id,
    projectId: ProjectId.make("project"),
    title: input.id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: input.branch === undefined ? "main" : input.branch,
    worktreePath: null,
    latestTurn: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
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
      goal: input.id,
      acceptanceCriteria: [],
      dependencies: input.dependencies ?? [],
      changeScopes: input.changeScopes ?? [],
      baseBranch: "main",
      stage: input.stage,
      phase: "implementation",
      attempt: input.attempt ?? 0,
      maxAttempts: input.maxAttempts ?? 2,
      maxRuntimeMinutes: 60,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastError: null,
      feedback: null,
      verification: { status: "pending", summary: null, completedAt: null },
      startedAt: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
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
    const planning = task({ id: "project-plan", stage: "running", taskKind: "planning" });
    const project: OrchestrationProject = {
      id: planning.projectId,
      title: "FACT3",
      workspaceRoot: "D:/FACT3",
      repositoryIdentity: null,
      defaultModelSelection: planning.modelSelection,
      scripts: [],
      automationPolicy: policy,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAt: null,
    };
    const prompt = buildAutomationPrompt({ thread: planning, project, policy });
    expect(prompt).toContain("Inspect the repository read-only");
    expect(prompt).toContain('"changeScopes"');
    expect(prompt).toContain('"reasoningEffort"');
    expect(prompt).toContain("Do not edit files, commit, push, or open a pull request.");
  });

  it("stops retrying exactly at the configured attempt budget", () => {
    expect(automationCanRetry(task({ id: "retry", stage: "failed", attempt: 1 }))).toBe(true);
    expect(
      automationCanRetry(task({ id: "exhausted", stage: "failed", attempt: 2, maxAttempts: 2 })),
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
});
