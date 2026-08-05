import {
  CheckpointRef,
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ModelSelection,
  type OrchestrationAutonomousWorkflowConfig,
  type OrchestrationThread,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  AUTOMATIC_WORKFLOW_RUNTIME_MODE,
  activeWorkflowThreadsForCancellation,
  automationCheckpointCapturePending,
  completedFinalAuditCanRecoverCoordinator,
  hasBlockingRequest,
  nextFinalAuditRepairCycle,
  staleWorkflowThreads,
  workflowModelSelection,
  workflowThreadId,
} from "./AutomationReactor.ts";

const NOW = "2026-08-04T12:00:00.000Z";
const model = (name: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model: name,
});
const workflowConfig: OrchestrationAutonomousWorkflowConfig = {
  mode: "automatic",
  roles: {
    orchestrator: model("orchestrator"),
    planner: model("planner"),
    worker: model("worker"),
    verifier: model("verifier"),
    integrator: model("integrator"),
    visual: model("visual"),
  },
};

function thread(input: {
  readonly id: string;
  readonly taskKind?: "implementation" | "planning";
  readonly role?: "orchestrator" | "planner" | "worker" | "verifier" | "integrator" | "visual";
  readonly workflowId?: ThreadId | null;
  readonly workflowConfig?: OrchestrationAutonomousWorkflowConfig;
  readonly activities?: OrchestrationThread["activities"];
}): OrchestrationThread {
  const id = ThreadId.make(input.id);
  return {
    id,
    projectId: ProjectId.make("project"),
    title: input.id,
    modelSelection: model("thread-default"),
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
    activities: input.activities ?? [],
    checkpoints: [],
    session: null,
    automation: {
      taskKind: input.taskKind ?? "implementation",
      workflowId: input.workflowId === undefined ? null : input.workflowId,
      workflowTaskKey: input.taskKind === "planning" ? null : input.id,
      role: input.role ?? "worker",
      ...(input.workflowConfig ? { workflowConfig: input.workflowConfig } : {}),
      goal: input.id,
      acceptanceCriteria: [],
      dependencies: [],
      changeScopes: [],
      baseBranch: "main",
      stage: "ready",
      phase: "implementation",
      attempt: 0,
      maxAttempts: 3,
      maxRuntimeMinutes: 60,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastError: null,
      feedback: null,
      verification: { status: "pending", summary: null, evidence: [], completedAt: null },
      startedAt: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    },
  };
}

describe("AutomationReactor workflow helpers", () => {
  it("runs FACT3-owned workflow agents without interactive approval pauses", () => {
    expect(AUTOMATIC_WORKFLOW_RUNTIME_MODE).toBe("full-access");
  });

  it("waits for provisional checkpoint capture unless capture failed or the turn was interrupted", () => {
    const running = thread({ id: "checkpoint-pending" });
    const turnId = TurnId.make("turn-checkpoint-pending");
    const checkpoint: OrchestrationThread["checkpoints"][number] = {
      turnId,
      checkpointTurnCount: 1,
      checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${running.id}/turn/1`),
      status: "missing",
      files: [],
      assistantMessageId: MessageId.make(`assistant:${turnId}`),
      completedAt: NOW,
    };
    const pending = {
      ...running,
      latestTurn: {
        turnId,
        state: "completed" as const,
        requestedAt: NOW,
        startedAt: NOW,
        completedAt: NOW,
        assistantMessageId: checkpoint.assistantMessageId,
      },
      checkpoints: [checkpoint],
      automation: { ...running.automation!, lastHeartbeatAt: NOW },
    };

    expect(automationCheckpointCapturePending(pending, checkpoint)).toBe(true);
    expect(
      automationCheckpointCapturePending(
        {
          ...pending,
          activities: [
            {
              id: EventId.make("capture-failed"),
              tone: "error",
              kind: "checkpoint.capture.failed",
              summary: "Checkpoint capture failed",
              payload: { detail: "git ref update failed" },
              turnId,
              createdAt: NOW,
            },
          ],
        },
        checkpoint,
      ),
    ).toBe(false);
    expect(
      automationCheckpointCapturePending(
        {
          ...pending,
          latestTurn: { ...pending.latestTurn, state: "interrupted" as const },
        },
        checkpoint,
      ),
    ).toBe(false);
  });

  it("routes planning, implementation, and verification turns through the configured role models", () => {
    const root = thread({
      id: "workflow",
      taskKind: "planning",
      role: "orchestrator",
      workflowId: ThreadId.make("workflow"),
      workflowConfig,
    });
    const worker = thread({
      id: "task-a",
      role: "worker",
      workflowId: root.id,
    });

    expect(workflowModelSelection(root, "implementation", root).model).toBe("planner");
    expect(workflowModelSelection(root, "verification", root).model).toBe("orchestrator");
    expect(workflowModelSelection(worker, "implementation", root).model).toBe("worker");
    expect(workflowModelSelection(worker, "verification", root).model).toBe("verifier");
  });

  it("builds stable workflow-scoped ids for idempotent task materialization", () => {
    const workflowId = ThreadId.make("workflow");
    expect(workflowThreadId(workflowId, "ui/audit")).toBe("workflow:automation:ui%2Faudit");
    expect(workflowThreadId(workflowId, "ui/audit")).toBe(workflowThreadId(workflowId, "ui/audit"));
    expect(workflowThreadId(workflowId, "api")).not.toBe(workflowThreadId(workflowId, "ui/audit"));
  });

  it("allocates a fresh repair graph after every final-audit repair cycle", () => {
    expect(nextFinalAuditRepairCycle("__final_audit__")).toBe(1);
    expect(nextFinalAuditRepairCycle("__final_audit__repair_1")).toBe(2);
    expect(nextFinalAuditRepairCycle("__final_audit__repair_7")).toBe(8);
  });

  it("identifies obsolete partially materialized children before releasing the workflow barrier", () => {
    const workflowId = ThreadId.make("workflow");
    const accepted = thread({
      id: workflowThreadId(workflowId, "accepted"),
      workflowId,
    });
    const obsolete = thread({
      id: workflowThreadId(workflowId, "obsolete"),
      workflowId,
    });
    const unrelated = thread({
      id: "other-workflow:automation:obsolete",
      workflowId: ThreadId.make("other-workflow"),
    });

    expect(
      staleWorkflowThreads({
        workflowId,
        projectId: ProjectId.make("project"),
        acceptedIds: new Set([accepted.id]),
        threads: [accepted, obsolete, unrelated],
      }).map((candidate) => candidate.id),
    ).toEqual([obsolete.id]);
  });

  it("selects every non-terminal workflow descendant when its coordinator is cancelled", () => {
    const workflowId = ThreadId.make("workflow");
    const ready = thread({ id: "ready", workflowId });
    const running = {
      ...thread({ id: "running", workflowId }),
      automation: {
        ...thread({ id: "running", workflowId }).automation!,
        stage: "running" as const,
      },
    };
    const complete = {
      ...thread({ id: "complete", workflowId }),
      automation: {
        ...thread({ id: "complete", workflowId }).automation!,
        stage: "complete" as const,
      },
    };
    const unrelated = thread({ id: "unrelated", workflowId: ThreadId.make("other") });

    expect(
      activeWorkflowThreadsForCancellation({
        workflowId,
        projectId: ProjectId.make("project"),
        threads: [ready, running, complete, unrelated],
      }).map((candidate) => candidate.id),
    ).toEqual([ready.id, running.id]);
  });

  it("recovers a failed coordinator only from a newer completed final audit", () => {
    const workflowId = ThreadId.make("workflow");
    const coordinatorBase = thread({
      id: workflowId,
      taskKind: "planning",
      role: "orchestrator",
      workflowId,
      workflowConfig,
    });
    const coordinator = {
      ...coordinatorBase,
      automation: {
        ...coordinatorBase.automation!,
        stage: "failed" as const,
        updatedAt: "2026-08-04T12:01:00.000Z",
      },
    };
    const auditBase = thread({
      id: "workflow:automation:__final_audit__",
      role: "orchestrator",
      workflowId,
    });
    const finalAudit = {
      ...auditBase,
      automation: {
        ...auditBase.automation!,
        workflowTaskKey: "__final_audit__",
        stage: "complete" as const,
        completedAt: "2026-08-04T12:02:00.000Z",
      },
    };

    expect(completedFinalAuditCanRecoverCoordinator({ coordinator, finalAudit })).toBe(true);
    expect(
      completedFinalAuditCanRecoverCoordinator({
        coordinator,
        finalAudit: {
          ...finalAudit,
          automation: {
            ...finalAudit.automation!,
            completedAt: "2026-08-04T12:00:00.000Z",
          },
        },
      }),
    ).toBe(false);

    const reopenedCoordinator = {
      ...coordinator,
      automation: {
        ...coordinator.automation!,
        stage: "review" as const,
        updatedAt: "2026-08-04T12:03:00.000Z",
      },
    };
    expect(
      completedFinalAuditCanRecoverCoordinator({
        coordinator: reopenedCoordinator,
        finalAudit,
      }),
    ).toBe(false);
  });

  it("clears stale approval failures but preserves actionable failed responses", () => {
    const requested = {
      id: EventId.make("activity-request"),
      tone: "approval" as const,
      kind: "approval.requested",
      summary: "Approval needed",
      payload: { requestId: "request-1" },
      turnId: null,
      createdAt: NOW,
    };
    const stale = {
      ...requested,
      id: EventId.make("activity-stale"),
      kind: "provider.approval.respond.failed",
      summary: "Approval was stale",
      payload: {
        requestId: "request-1",
        detail: "Unknown pending approval request",
      },
    };
    const actionable = {
      ...stale,
      id: EventId.make("activity-actionable"),
      payload: { requestId: "request-1", detail: "Provider transport error" },
    };

    expect(hasBlockingRequest(thread({ id: "open", activities: [requested] }))).toBe(true);
    expect(hasBlockingRequest(thread({ id: "stale", activities: [requested, stale] }))).toBe(false);
    expect(
      hasBlockingRequest(thread({ id: "actionable", activities: [requested, actionable] })),
    ).toBe(true);
  });
});
