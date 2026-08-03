import {
  CheckpointRef,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationProjectAutomationPolicy,
  type OrchestrationThread,
  type OrchestrationThreadAutomation,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  automationAvailableSlots,
  automationCanRetry,
  automationConcurrencyLimit,
  automationDispatchCompletion,
  selectRunnableAutomationTasks,
} from "./AutomationReactor.logic.ts";

const NOW = "2026-08-03T12:00:00.000Z";
const policy: OrchestrationProjectAutomationPolicy = {
  enabled: true,
  maxConcurrentRuns: 3,
  defaultMaxAttempts: 2,
  defaultMaxRuntimeMinutes: 60,
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
}): OrchestrationThread {
  const id = ThreadId.make(input.id);
  return {
    id,
    projectId: ProjectId.make("project"),
    title: input.id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "main",
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
      goal: input.id,
      acceptanceCriteria: [],
      dependencies: input.dependencies ?? [],
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

  it("stops retrying exactly at the configured attempt budget", () => {
    expect(automationCanRetry(task({ id: "retry", stage: "failed", attempt: 1 }))).toBe(true);
    expect(
      automationCanRetry(task({ id: "exhausted", stage: "failed", attempt: 2, maxAttempts: 2 })),
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
