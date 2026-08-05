import {
  CommandId,
  MessageId,
  ThreadId,
  type ModelSelection,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationProjectAutomationPolicy,
  type OrchestrationThread,
  type ProjectId,
} from "@t3tools/contracts";
import {
  automationVerificationCoversCriteria,
  parseAutomationFinalAuditReport,
  parseAutomationIntegrationReport,
  parseAutomationPlan,
  parseAutomationVerificationReport,
  type AutomationFinalAuditReport,
  type AutomationPlan,
  type AutomationVerificationReport,
} from "@t3tools/shared/automationPlan";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { makeKeyedCoalescingWorker } from "@t3tools/shared/KeyedCoalescingWorker";
import * as Cause from "effect/Cause";
import * as Crypto from "effect/Crypto";
import * as Data from "effect/Data";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { ProjectSetupScriptRunner } from "../../project/ProjectSetupScriptRunner.ts";
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { AutomationReactor, type AutomationReactorShape } from "../Services/AutomationReactor.ts";
import {
  automationAvailableSlots,
  automationDependencyTerminalBlockers,
  automationDispatchCompletion,
  automationDispatchAdoptionDeadline,
  automationDispatchStartExpired,
  automationHasActiveSubagents,
  automationIsStalled,
  automationNeedsStartupRecovery,
  automationRetryDecision,
  automationStuckDeadline,
  buildAutomationPrompt,
  buildAutomationWorkflowEvidence,
  resolveAutomationDependencyBranches,
  selectRunnableAutomationTasks,
} from "../AutomationReactor.logic.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

// Automatic workflow agents run only in FACT3-owned isolated worktrees. The
// server remains responsible for verification and guarded base promotion.
export const AUTOMATIC_WORKFLOW_RUNTIME_MODE = "full-access" as const;

class AutomationDependencyMaterializationError extends Data.TaggedError(
  "AutomationDependencyMaterializationError",
)<{
  readonly message: string;
}> {}

class AutomationWorkflowMaterializationError extends Data.TaggedError(
  "AutomationWorkflowMaterializationError",
)<{
  readonly message: string;
}> {}

class AutomationWorkflowPrerequisiteError extends Data.TaggedError(
  "AutomationWorkflowPrerequisiteError",
)<{
  readonly message: string;
}> {}

class AutomationIntegrationError extends Data.TaggedError("AutomationIntegrationError")<{
  readonly message: string;
}> {}

function isStaleRequestFailureDetail(payload: Record<string, unknown> | null): boolean {
  const detail = typeof payload?.detail === "string" ? payload.detail.toLowerCase() : null;
  if (detail === null) return false;
  return (
    detail.includes("stale pending approval request") ||
    detail.includes("unknown pending approval request") ||
    detail.includes("unknown pending permission request") ||
    detail.includes("stale pending user-input request") ||
    detail.includes("unknown pending user-input request") ||
    detail.includes("unknown pending user input request") ||
    detail.includes("unknown pending codex user input request")
  );
}

export function hasBlockingRequest(thread: OrchestrationThread): boolean {
  const open = new Set<string>();
  for (const activity of thread.activities) {
    const payload =
      typeof activity.payload === "object" && activity.payload !== null
        ? (activity.payload as Record<string, unknown>)
        : null;
    const requestId = typeof payload?.requestId === "string" ? payload.requestId : null;
    if (requestId === null) continue;
    if (activity.kind === "approval.requested" || activity.kind === "user-input.requested") {
      open.add(requestId);
    } else if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      open.delete(requestId);
    } else if (
      (activity.kind === "provider.approval.respond.failed" ||
        activity.kind === "provider.user-input.respond.failed") &&
      isStaleRequestFailureDetail(payload)
    ) {
      open.delete(requestId);
    }
  }
  return open.size > 0;
}

export function automationCheckpointCapturePending(
  thread: OrchestrationThread,
  checkpoint: OrchestrationThread["checkpoints"][number],
): boolean {
  if (checkpoint.status !== "missing" || thread.latestTurn?.state === "interrupted") {
    return false;
  }
  const heartbeat = thread.automation?.lastHeartbeatAt;
  return !thread.activities.some(
    (activity) =>
      activity.kind === "checkpoint.capture.failed" &&
      (heartbeat === null || heartbeat === undefined || activity.createdAt >= heartbeat) &&
      (activity.turnId === null || activity.turnId === checkpoint.turnId),
  );
}

function latestAssistantText(thread: OrchestrationThread): string | null {
  const heartbeat = thread.automation?.lastHeartbeatAt;
  return (
    thread.messages
      .filter(
        (message) =>
          message.role === "assistant" &&
          !message.streaming &&
          (heartbeat === null || heartbeat === undefined || message.updatedAt >= heartbeat),
      )
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]?.text ?? null
  );
}

export function workflowModelSelection(
  thread: OrchestrationThread,
  phase: "implementation" | "verification",
  workflowRoot?: OrchestrationThread,
): ModelSelection {
  const automation = thread.automation;
  const roles = (workflowRoot ?? thread).automation?.workflowConfig?.roles;
  if (!automation || !roles) return thread.modelSelection;
  if (automation.taskKind === "planning") {
    return phase === "verification" ? roles.orchestrator : roles.planner;
  }
  if (phase === "verification") return roles.verifier;
  return roles[automation.role] ?? thread.modelSelection;
}

export function workflowThreadId(workflowId: ThreadId, taskKey: string): ThreadId {
  return ThreadId.make(`${workflowId}:automation:${encodeURIComponent(taskKey)}`);
}

export function nextFinalAuditRepairCycle(workflowTaskKey: string | null): number {
  const priorCycle = workflowTaskKey?.match(/^__final_audit__repair_(\d+)$/)?.[1];
  return priorCycle ? Number(priorCycle) + 1 : 1;
}

function latestWorkflowFinalAudit(
  workflowId: ThreadId,
  threads: ReadonlyArray<OrchestrationThread>,
): OrchestrationThread | undefined {
  return threads
    .filter(
      (thread) =>
        thread.automation?.workflowId === workflowId &&
        thread.automation.workflowTaskKey?.startsWith("__final_audit__") === true,
    )
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function staleWorkflowThreads(input: {
  readonly workflowId: ThreadId;
  readonly projectId: ProjectId;
  readonly acceptedIds: ReadonlySet<ThreadId>;
  readonly threads: ReadonlyArray<OrchestrationThread>;
}): ReadonlyArray<OrchestrationThread> {
  const workflowPrefix = `${input.workflowId}:automation:`;
  return input.threads.filter(
    (thread) =>
      thread.projectId === input.projectId &&
      thread.id.startsWith(workflowPrefix) &&
      !input.acceptedIds.has(thread.id) &&
      (thread.automation === undefined || thread.automation.workflowId === input.workflowId),
  );
}

export function activeWorkflowThreadsForCancellation(input: {
  readonly workflowId: ThreadId;
  readonly projectId: ProjectId;
  readonly threads: ReadonlyArray<OrchestrationThread>;
}): ReadonlyArray<OrchestrationThread> {
  return input.threads.filter(
    (thread) =>
      thread.projectId === input.projectId &&
      thread.automation?.workflowId === input.workflowId &&
      thread.automation.stage !== "complete" &&
      thread.automation.stage !== "cancelled",
  );
}

export function completedFinalAuditCanRecoverCoordinator(input: {
  readonly coordinator: OrchestrationThread;
  readonly finalAudit: OrchestrationThread;
}): boolean {
  const coordinatorAutomation = input.coordinator.automation;
  const auditAutomation = input.finalAudit.automation;
  if (
    coordinatorAutomation?.taskKind !== "planning" ||
    coordinatorAutomation.workflowConfig?.mode !== "automatic" ||
    auditAutomation?.workflowId !== input.coordinator.id ||
    auditAutomation.workflowTaskKey !== "__final_audit__" ||
    auditAutomation.stage !== "complete"
  ) {
    return false;
  }
  return (
    (coordinatorAutomation.stage === "review" || coordinatorAutomation.stage === "failed") &&
    auditAutomation.completedAt !== null &&
    auditAutomation.completedAt >= coordinatorAutomation.updatedAt
  );
}

function sameStringArray(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameModelSelection(left: ModelSelection, right: ModelSelection): boolean {
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    JSON.stringify(left.options ?? []) === JSON.stringify(right.options ?? [])
  );
}

function verificationFromReport(
  report: AutomationVerificationReport,
  completedAt: string,
): NonNullable<OrchestrationThread["automation"]>["verification"] {
  return {
    status: "passed",
    summary: report.summary,
    evidence: report.checks,
    completedAt,
  };
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const setupScripts = yield* ProjectSetupScriptRunner;
  const git = yield* GitVcsDriver;
  const vcsStatus = yield* VcsStatusBroadcaster;
  const scheduledLeases = new Map<ThreadId, string>();
  const scheduledStuckChecks = new Map<ThreadId, string>();
  const scheduledAdoptionChecks = new Map<ThreadId, string>();

  const serverCommandId = (label: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((id) => CommandId.make(`server:automation:${label}:${id}`)),
    );
  const messageId = crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(MessageId.make));

  const retireStaleWorkflowThreads = Effect.fn("AutomationReactor.retireStaleWorkflowThreads")(
    function* (input: {
      readonly workflowId: ThreadId;
      readonly projectId: ProjectId;
      readonly acceptedIds: ReadonlySet<ThreadId>;
    }) {
      const model = yield* snapshots.getCommandReadModel();
      const stale = staleWorkflowThreads({ ...input, threads: model.threads });
      for (const thread of stale) {
        if (thread.session?.status === "starting" || thread.session?.status === "running") {
          return yield* new AutomationWorkflowMaterializationError({
            message: `Obsolete workflow task '${thread.title}' is still running and cannot be retired safely. Stop it before materialization resumes.`,
          });
        }
        yield* engine.dispatch({
          type: "thread.delete",
          commandId: yield* serverCommandId("retire-stale-workflow-thread"),
          threadId: thread.id,
        });
      }
    },
  );

  const transition = Effect.fn("AutomationReactor.transition")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly stage: NonNullable<OrchestrationThread["automation"]>["stage"];
    readonly phase?: NonNullable<OrchestrationThread["automation"]>["phase"];
    readonly attempt?: number;
    readonly leaseExpiresAt?: string | null;
    readonly lastHeartbeatAt?: string | null;
    readonly lastError?: string | null;
    readonly feedback?: string | null;
    readonly verification?: NonNullable<OrchestrationThread["automation"]>["verification"];
    readonly startedAt?: string | null;
    readonly completedAt?: string | null;
  }) {
    const updatedAt = yield* nowIso;
    yield* engine.dispatch({
      type: "thread.automation.transition",
      commandId: yield* serverCommandId("transition"),
      threadId: input.thread.id,
      expectedStage: input.thread.automation!.stage,
      stage: input.stage,
      ...(input.phase !== undefined ? { phase: input.phase } : {}),
      ...(input.attempt !== undefined ? { attempt: input.attempt } : {}),
      ...(input.leaseExpiresAt !== undefined ? { leaseExpiresAt: input.leaseExpiresAt } : {}),
      ...(input.lastHeartbeatAt !== undefined ? { lastHeartbeatAt: input.lastHeartbeatAt } : {}),
      ...(input.lastError !== undefined ? { lastError: input.lastError } : {}),
      ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
      ...(input.verification !== undefined ? { verification: input.verification } : {}),
      ...(input.startedAt !== undefined ? { startedAt: input.startedAt } : {}),
      ...(input.completedAt !== undefined ? { completedAt: input.completedAt } : {}),
      updatedAt,
    });
  });

  const completeWorkflowCoordinator = Effect.fn("AutomationReactor.completeWorkflowCoordinator")(
    function* (thread: OrchestrationThread, completedAt: string) {
      yield* transition({
        thread,
        stage: "complete",
        leaseExpiresAt: null,
        lastError: null,
        completedAt,
      });
    },
  );

  let enqueueProject: ((projectId: ProjectId) => Effect.Effect<void>) | null = null;
  const scheduleLease = Effect.fn("AutomationReactor.scheduleLease")(function* (
    thread: OrchestrationThread,
  ) {
    const expiresAt = thread.automation?.leaseExpiresAt;
    if (!expiresAt) return;
    if (scheduledLeases.get(thread.id) === expiresAt) return;
    scheduledLeases.set(thread.id, expiresAt);
    const currentTime = yield* DateTime.now;
    const delayMs = Math.max(
      0,
      DateTime.toEpochMillis(DateTime.makeUnsafe(expiresAt)) - DateTime.toEpochMillis(currentTime),
    );
    yield* Effect.sleep(Duration.millis(delayMs)).pipe(
      Effect.andThen(Effect.suspend(() => enqueueProject?.(thread.projectId) ?? Effect.void)),
      Effect.ensuring(
        Effect.sync(() => {
          if (scheduledLeases.get(thread.id) === expiresAt) {
            scheduledLeases.delete(thread.id);
          }
        }),
      ),
      Effect.forkScoped,
    );
  });

  const scheduleStuckCheck = Effect.fn("AutomationReactor.scheduleStuckCheck")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly policy: OrchestrationProjectAutomationPolicy;
  }) {
    const deadline = automationStuckDeadline(input);
    if (!deadline) return;
    if (scheduledStuckChecks.has(input.thread.id)) return;
    scheduledStuckChecks.set(input.thread.id, deadline);
    const currentTime = yield* DateTime.now;
    const delayMs = Math.max(
      0,
      DateTime.toEpochMillis(DateTime.makeUnsafe(deadline)) - DateTime.toEpochMillis(currentTime),
    );
    yield* Effect.sleep(Duration.millis(delayMs)).pipe(
      Effect.andThen(
        Effect.sync(() => {
          if (scheduledStuckChecks.get(input.thread.id) === deadline) {
            scheduledStuckChecks.delete(input.thread.id);
          }
        }),
      ),
      Effect.andThen(Effect.suspend(() => enqueueProject?.(input.thread.projectId) ?? Effect.void)),
      Effect.ensuring(
        Effect.sync(() => {
          if (scheduledStuckChecks.get(input.thread.id) === deadline) {
            scheduledStuckChecks.delete(input.thread.id);
          }
        }),
      ),
      Effect.forkScoped,
    );
  });

  const scheduleAdoptionCheck = Effect.fn("AutomationReactor.scheduleAdoptionCheck")(function* (
    thread: OrchestrationThread,
  ) {
    const deadline = automationDispatchAdoptionDeadline(thread);
    if (!deadline || scheduledAdoptionChecks.get(thread.id) === deadline) return;
    scheduledAdoptionChecks.set(thread.id, deadline);
    const currentTime = yield* DateTime.now;
    const delayMs = Math.max(
      0,
      DateTime.toEpochMillis(DateTime.makeUnsafe(deadline)) - DateTime.toEpochMillis(currentTime),
    );
    yield* Effect.sleep(Duration.millis(delayMs)).pipe(
      Effect.andThen(Effect.suspend(() => enqueueProject?.(thread.projectId) ?? Effect.void)),
      Effect.ensuring(
        Effect.sync(() => {
          if (scheduledAdoptionChecks.get(thread.id) === deadline) {
            scheduledAdoptionChecks.delete(thread.id);
          }
        }),
      ),
      Effect.forkScoped,
    );
  });

  const prepareWorktree = Effect.fn("AutomationReactor.prepareWorktree")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly project: OrchestrationProject;
    readonly policy: OrchestrationProjectAutomationPolicy;
  }) {
    if (
      input.thread.worktreePath ||
      !input.policy.createWorktrees ||
      input.thread.automation?.taskKind === "planning"
    )
      return;
    const uuid = yield* crypto.randomUUIDv4.pipe(Effect.orDie);
    const branch = buildTemporaryWorktreeBranchName(() => uuid.replaceAll("-", ""));
    const worktree = yield* gitWorkflow.createWorktree({
      cwd: input.project.workspaceRoot,
      refName: input.thread.automation!.baseBranch,
      newRefName: branch,
      baseRefName: input.thread.automation!.baseBranch,
      path: null,
    });
    const model = yield* snapshots.getCommandReadModel();
    const dependencies = resolveAutomationDependencyBranches({
      thread: input.thread,
      tasks: model.threads,
    });
    const cleanup = Effect.gen(function* () {
      yield* git
        .execute({
          operation: "AutomationReactor.prepareWorktree.abortDependencyMerge",
          cwd: worktree.worktree.path,
          args: ["merge", "--abort"],
          allowNonZeroExit: true,
        })
        .pipe(Effect.ignoreCause({ log: true }));
      yield* gitWorkflow
        .removeWorktree({
          cwd: input.project.workspaceRoot,
          path: worktree.worktree.path,
          force: true,
        })
        .pipe(Effect.ignoreCause({ log: true }));
      yield* git
        .execute({
          operation: "AutomationReactor.prepareWorktree.removeFailedBranch",
          cwd: input.project.workspaceRoot,
          args: ["branch", "-D", worktree.worktree.refName],
          allowNonZeroExit: true,
        })
        .pipe(Effect.ignoreCause({ log: true }));
    });
    if (dependencies.missing.length > 0) {
      yield* cleanup;
      return yield* new AutomationDependencyMaterializationError({
        message: `Approved dependency output is unavailable for: ${dependencies.missing.join(", ")}. Reopen those tasks before retrying.`,
      });
    }
    if (input.thread.automation?.role !== "integrator") {
      yield* Effect.forEach(
        dependencies.branches,
        (branch) =>
          git.execute({
            operation: "AutomationReactor.prepareWorktree.mergeDependency",
            cwd: worktree.worktree.path,
            args: [
              "-c",
              "user.name=FACT3 Code",
              "-c",
              "user.email=fact3@localhost",
              "merge",
              "--no-edit",
              branch,
            ],
          }),
        { discard: true },
      ).pipe(Effect.catchCause((cause) => cleanup.pipe(Effect.andThen(Effect.failCause(cause)))));
    }
    const setupInput = {
      threadId: input.thread.id,
      projectId: input.project.id,
      projectCwd: input.project.workspaceRoot,
      worktreePath: worktree.worktree.path,
      timeoutMinutes: input.thread.automation!.maxRuntimeMinutes,
    };
    yield* (
      setupScripts.runForThreadAndWait
        ? setupScripts.runForThreadAndWait(setupInput)
        : setupScripts.runForThread(setupInput)
    ).pipe(Effect.catchCause((cause) => cleanup.pipe(Effect.andThen(Effect.failCause(cause)))));
    yield* engine.dispatch({
      type: "thread.meta.update",
      commandId: yield* serverCommandId("worktree"),
      threadId: input.thread.id,
      branch: worktree.worktree.refName,
      worktreePath: worktree.worktree.path,
    });
    yield* vcsStatus.refreshStatus(worktree.worktree.path).pipe(Effect.ignoreCause({ log: true }));
  });

  const materializeWorkflow = Effect.fn("AutomationReactor.materializeWorkflow")(function* (input: {
    readonly root: OrchestrationThread;
    readonly project: OrchestrationProject;
    readonly policy: OrchestrationProjectAutomationPolicy;
    readonly plan: AutomationPlan;
  }) {
    if (!input.policy.createWorktrees || !input.policy.requireVerification) {
      return yield* new AutomationWorkflowPrerequisiteError({
        message:
          "Autonomous workflow requires dedicated worktrees and verification before tasks can be materialized.",
      });
    }
    const rootAutomation = input.root.automation!;
    const workflowConfig = rootAutomation.workflowConfig;
    if (!workflowConfig) {
      return yield* new AutomationWorkflowMaterializationError({
        message: "The planning task does not contain an autonomous workflow configuration.",
      });
    }
    const createdAt = yield* nowIso;
    const taskIds = new Map(
      input.plan.tasks.map((task) => [task.key, workflowThreadId(input.root.id, task.key)]),
    );
    const integrationKey = "__integration__";
    const integrationId = workflowThreadId(input.root.id, integrationKey);
    const finalAuditKey = "__final_audit__";
    const finalAuditId = workflowThreadId(input.root.id, finalAuditKey);
    const threadSpecs = [
      ...input.plan.tasks.map((task) => ({
        id: taskIds.get(task.key)!,
        title: task.title,
        modelSelection: workflowConfig.roles[task.role],
        runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE,
      })),
      {
        id: integrationId,
        title: `Integrate: ${input.root.title}`,
        modelSelection: workflowConfig.roles.integrator,
        runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE,
      },
      {
        id: finalAuditId,
        title: `Final audit: ${input.root.title}`,
        modelSelection: workflowConfig.roles.orchestrator,
        runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE,
      },
    ];
    const acceptedIds = new Set<ThreadId>(threadSpecs.map((spec) => spec.id));

    const initialModel = yield* snapshots.getCommandReadModel();
    const existingById = new Map(initialModel.threads.map((thread) => [thread.id, thread]));
    for (const spec of threadSpecs) {
      const existing = existingById.get(spec.id);
      if (existing) {
        if (existing.projectId !== input.project.id) {
          return yield* new AutomationWorkflowMaterializationError({
            message: `Workflow task id '${spec.id}' already belongs to another project.`,
          });
        }
        continue;
      }
      yield* engine.dispatch({
        type: "thread.create",
        commandId: yield* serverCommandId("workflow-thread"),
        threadId: spec.id,
        projectId: input.project.id,
        title: spec.title,
        modelSelection: spec.modelSelection,
        runtimeMode: spec.runtimeMode,
        interactionMode: "default",
        branch: rootAutomation.baseBranch,
        worktreePath: null,
        createdAt,
      });
    }

    const refreshed = yield* snapshots.getCommandReadModel();
    const refreshedById = new Map(refreshed.threads.map((thread) => [thread.id, thread]));
    for (const task of input.plan.tasks) {
      const threadId = taskIds.get(task.key)!;
      const existing = refreshedById.get(threadId);
      const expectedDependencies = [
        input.root.id,
        ...task.dependsOn.map((key) => taskIds.get(key)!),
      ];
      const expectedAcceptanceCriteria = [
        ...task.acceptanceCriteria,
        ...task.verification.map((check) => `Verification: ${check}`),
      ];
      if (!existing) {
        return yield* new AutomationWorkflowMaterializationError({
          message: `Workflow task '${task.title}' was not projected after creation.`,
        });
      }
      if (existing.automation) {
        if (
          existing.automation.workflowId !== input.root.id ||
          existing.automation.workflowTaskKey !== task.key ||
          existing.automation.taskKind !== "implementation" ||
          existing.automation.role !== task.role ||
          existing.automation.goal !== task.goal ||
          existing.automation.baseBranch !== rootAutomation.baseBranch ||
          !sameStringArray(existing.automation.acceptanceCriteria, expectedAcceptanceCriteria) ||
          !sameStringArray(existing.automation.dependencies, expectedDependencies) ||
          !sameStringArray(existing.automation.changeScopes, task.changeScopes) ||
          !sameModelSelection(existing.modelSelection, workflowConfig.roles[task.role])
        ) {
          return yield* new AutomationWorkflowMaterializationError({
            message: `Workflow task key '${task.key}' was already materialized with a different definition. Use a new stable key for materially changed work so FACT3 never runs a stale task specification.`,
          });
        }
        continue;
      }
      yield* engine.dispatch({
        type: "thread.automation.configure",
        commandId: yield* serverCommandId("workflow-task"),
        threadId,
        automation: {
          taskKind: "implementation",
          workflowId: input.root.id,
          workflowTaskKey: task.key,
          role: task.role,
          goal: task.goal,
          acceptanceCriteria: expectedAcceptanceCriteria,
          dependencies: expectedDependencies,
          changeScopes: task.changeScopes,
          baseBranch: rootAutomation.baseBranch,
          stage: "ready",
          phase: "implementation",
          attempt: 0,
          maxAttempts: input.policy.defaultMaxAttempts,
          maxRuntimeMinutes: input.policy.defaultMaxRuntimeMinutes,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          feedback: null,
          verification: { status: "pending", summary: null, evidence: [], completedAt: null },
          startedAt: null,
          completedAt: null,
          createdAt,
          updatedAt: createdAt,
        },
        updatedAt: createdAt,
      });
    }

    const integration = (yield* snapshots.getCommandReadModel()).threads.find(
      (thread) => thread.id === integrationId,
    );
    if (!integration) {
      return yield* new AutomationWorkflowMaterializationError({
        message: "The integration task was not projected after creation.",
      });
    }
    if (integration.automation) {
      const expectedIntegrationGoal = `Integrate every approved task for this project goal and resolve conflicts without discarding either intent.\n\n${rootAutomation.goal}\n\nPlan: ${input.plan.summary}`;
      const expectedIntegrationCriteria = [
        "Every planned task branch is merged into the integration branch.",
        "The combined result is clean, committed, and passes focused integration checks.",
      ];
      const expectedIntegrationDependencies = input.plan.tasks.map(
        (task) => taskIds.get(task.key)!,
      );
      if (
        integration.automation.workflowId !== input.root.id ||
        integration.automation.workflowTaskKey !== integrationKey ||
        integration.automation.taskKind !== "implementation" ||
        integration.automation.role !== "integrator" ||
        integration.automation.goal !== expectedIntegrationGoal ||
        integration.automation.baseBranch !== rootAutomation.baseBranch ||
        !sameStringArray(integration.automation.acceptanceCriteria, expectedIntegrationCriteria) ||
        !sameStringArray(integration.automation.dependencies, expectedIntegrationDependencies) ||
        !sameStringArray(integration.automation.changeScopes, ["**/*"]) ||
        !sameModelSelection(integration.modelSelection, workflowConfig.roles.integrator)
      ) {
        return yield* new AutomationWorkflowMaterializationError({
          message:
            "This workflow's integration task was already materialized from a different plan. Return the previously accepted plan or start a new autonomous workflow for the revised graph.",
        });
      }
      yield* retireStaleWorkflowThreads({
        workflowId: input.root.id,
        projectId: input.project.id,
        acceptedIds,
      });
    } else {
      yield* engine.dispatch({
        type: "thread.automation.configure",
        commandId: yield* serverCommandId("workflow-integration"),
        threadId: integrationId,
        automation: {
          taskKind: "implementation",
          workflowId: input.root.id,
          workflowTaskKey: integrationKey,
          role: "integrator",
          goal: `Integrate every approved task for this project goal and resolve conflicts without discarding either intent.\n\n${rootAutomation.goal}\n\nPlan: ${input.plan.summary}`,
          acceptanceCriteria: [
            "Every planned task branch is merged into the integration branch.",
            "The combined result is clean, committed, and passes focused integration checks.",
          ],
          dependencies: input.plan.tasks.map((task) => taskIds.get(task.key)!),
          changeScopes: ["**/*"],
          baseBranch: rootAutomation.baseBranch,
          stage: "ready",
          phase: "implementation",
          attempt: 0,
          maxAttempts: input.policy.defaultMaxAttempts,
          maxRuntimeMinutes: input.policy.defaultMaxRuntimeMinutes,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          feedback: null,
          verification: { status: "pending", summary: null, evidence: [], completedAt: null },
          startedAt: null,
          completedAt: null,
          createdAt,
          updatedAt: createdAt,
        },
        updatedAt: createdAt,
      });
    }

    const finalAudit = (yield* snapshots.getCommandReadModel()).threads.find(
      (thread) => thread.id === finalAuditId,
    );
    if (!finalAudit) {
      return yield* new AutomationWorkflowMaterializationError({
        message: "The final orchestrator audit was not projected after creation.",
      });
    }
    if (finalAudit.automation) {
      if (
        finalAudit.automation.workflowId !== input.root.id ||
        finalAudit.automation.workflowTaskKey !== finalAuditKey ||
        finalAudit.automation.taskKind !== "implementation" ||
        finalAudit.automation.role !== "orchestrator" ||
        finalAudit.automation.goal !== rootAutomation.goal ||
        finalAudit.automation.baseBranch !== rootAutomation.baseBranch ||
        !sameStringArray(
          finalAudit.automation.acceptanceCriteria,
          rootAutomation.acceptanceCriteria,
        ) ||
        !sameStringArray(finalAudit.automation.dependencies, [integrationId]) ||
        !sameStringArray(finalAudit.automation.changeScopes, []) ||
        !sameModelSelection(finalAudit.modelSelection, workflowConfig.roles.orchestrator)
      ) {
        return yield* new AutomationWorkflowMaterializationError({
          message: "This workflow's final orchestrator audit has a stale definition.",
        });
      }
    } else {
      yield* engine.dispatch({
        type: "thread.automation.configure",
        commandId: yield* serverCommandId("workflow-final-audit"),
        threadId: finalAuditId,
        automation: {
          taskKind: "implementation",
          workflowId: input.root.id,
          workflowTaskKey: finalAuditKey,
          role: "orchestrator",
          goal: rootAutomation.goal,
          acceptanceCriteria: rootAutomation.acceptanceCriteria,
          dependencies: [integrationId],
          changeScopes: [],
          baseBranch: rootAutomation.baseBranch,
          stage: "ready",
          phase: "implementation",
          attempt: 0,
          maxAttempts: input.policy.defaultMaxAttempts,
          maxRuntimeMinutes: input.policy.defaultMaxRuntimeMinutes,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          feedback: null,
          verification: { status: "pending", summary: null, evidence: [], completedAt: null },
          startedAt: null,
          completedAt: null,
          createdAt,
          updatedAt: createdAt,
        },
        updatedAt: createdAt,
      });
    }
    yield* retireStaleWorkflowThreads({
      workflowId: input.root.id,
      projectId: input.project.id,
      acceptedIds,
    });
  });

  const routeFinalAuditRepairs = Effect.fn("AutomationReactor.routeFinalAuditRepairs")(
    function* (input: {
      readonly audit: OrchestrationThread;
      readonly project: OrchestrationProject;
      readonly policy: OrchestrationProjectAutomationPolicy;
      readonly report: AutomationFinalAuditReport;
      readonly tasks: ReadonlyArray<OrchestrationThread>;
    }) {
      const auditAutomation = input.audit.automation!;
      if (input.report.followUpTasks.length === 0 || auditAutomation.workflowId === null) {
        return yield* new AutomationWorkflowMaterializationError({
          message:
            "A repair-required final audit must provide at least one bounded follow-up task.",
        });
      }
      const root = input.tasks.find((thread) => thread.id === auditAutomation.workflowId);
      const integration = input.tasks.find(
        (thread) =>
          thread.automation?.workflowId === auditAutomation.workflowId &&
          thread.automation.workflowTaskKey === "__integration__",
      );
      const workflowConfig = root?.automation?.workflowConfig;
      if (!root?.automation || !integration?.automation || !workflowConfig || !integration.branch) {
        return yield* new AutomationWorkflowMaterializationError({
          message:
            "The final audit repair could not resolve a completed integration branch and workflow configuration.",
        });
      }

      const createdAt = yield* nowIso;
      const repairCycle = nextFinalAuditRepairCycle(auditAutomation.workflowTaskKey);
      const repairIds = input.report.followUpTasks.map((_, index) =>
        workflowThreadId(root.id, `__repair_${repairCycle}_${index + 1}`),
      );
      const currentModel = yield* snapshots.getCommandReadModel();
      const existingIds = new Set(currentModel.threads.map((thread) => thread.id));

      for (const [index, repair] of input.report.followUpTasks.entries()) {
        const threadId = repairIds[index]!;
        const key = `__repair_${repairCycle}_${index + 1}`;
        if (!existingIds.has(threadId)) {
          yield* engine.dispatch({
            type: "thread.create",
            commandId: yield* serverCommandId("workflow-repair-thread"),
            threadId,
            projectId: input.project.id,
            title: repair.title,
            modelSelection: workflowConfig.roles[repair.role],
            runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE,
            interactionMode: "default",
            branch: integration.branch,
            worktreePath: null,
            createdAt,
          });
        }
        const projected = (yield* snapshots.getCommandReadModel()).threads.find(
          (thread) => thread.id === threadId,
        );
        if (!projected?.automation) {
          yield* engine.dispatch({
            type: "thread.automation.configure",
            commandId: yield* serverCommandId("workflow-repair"),
            threadId,
            automation: {
              taskKind: "implementation",
              workflowId: root.id,
              workflowTaskKey: key,
              role: repair.role,
              goal: repair.goal,
              acceptanceCriteria: [
                ...input.report.failedCriteria,
                `Final-audit repair: ${repair.goal}`,
              ],
              dependencies: [root.id],
              changeScopes: ["**/*"],
              baseBranch: integration.branch,
              stage: "ready",
              phase: "implementation",
              attempt: 0,
              maxAttempts: input.policy.defaultMaxAttempts,
              maxRuntimeMinutes: input.policy.defaultMaxRuntimeMinutes,
              leaseExpiresAt: null,
              lastHeartbeatAt: null,
              lastError: null,
              feedback: input.report.summary,
              verification: { status: "pending", summary: null, evidence: [], completedAt: null },
              startedAt: null,
              completedAt: null,
              createdAt,
              updatedAt: createdAt,
            },
            updatedAt: createdAt,
          });
        }
      }

      yield* engine.dispatch({
        type: "thread.automation.configure",
        commandId: yield* serverCommandId("workflow-repair-integration"),
        threadId: integration.id,
        automation: {
          ...integration.automation,
          goal: `Integrate the verified final-audit repairs into the prior integrated result.\n\n${input.report.summary}`,
          acceptanceCriteria: [
            "Every final-audit repair branch is merged into the integration branch.",
            "The repaired combined result is clean, committed, and passes focused integration checks.",
          ],
          dependencies: repairIds,
          stage: "ready",
          phase: "implementation",
          attempt: 0,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          feedback: input.report.summary,
          verification: { status: "pending", summary: null, evidence: [], completedAt: null },
          startedAt: null,
          completedAt: null,
          updatedAt: createdAt,
        },
        updatedAt: createdAt,
      });

      const nextAuditKey = `__final_audit__repair_${repairCycle}`;
      const nextAuditId = workflowThreadId(root.id, nextAuditKey);
      if (!existingIds.has(nextAuditId)) {
        yield* engine.dispatch({
          type: "thread.create",
          commandId: yield* serverCommandId("workflow-repair-audit-thread"),
          threadId: nextAuditId,
          projectId: input.project.id,
          title: `Final audit after repair: ${root.title}`,
          modelSelection: workflowConfig.roles.orchestrator,
          runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE,
          interactionMode: "default",
          branch: root.automation.baseBranch,
          worktreePath: null,
          createdAt,
        });
      }
      const projectedAudit = (yield* snapshots.getCommandReadModel()).threads.find(
        (thread) => thread.id === nextAuditId,
      );
      if (!projectedAudit?.automation) {
        yield* engine.dispatch({
          type: "thread.automation.configure",
          commandId: yield* serverCommandId("workflow-repair-audit"),
          threadId: nextAuditId,
          automation: {
            taskKind: "implementation",
            workflowId: root.id,
            workflowTaskKey: nextAuditKey,
            role: "orchestrator",
            goal: root.automation.goal,
            acceptanceCriteria: root.automation.acceptanceCriteria,
            dependencies: [integration.id],
            changeScopes: [],
            baseBranch: root.automation.baseBranch,
            stage: "ready",
            phase: "implementation",
            attempt: 0,
            maxAttempts: input.policy.defaultMaxAttempts,
            maxRuntimeMinutes: input.policy.defaultMaxRuntimeMinutes,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            lastError: null,
            feedback: `Re-audit after verified repairs: ${input.report.summary}`,
            verification: { status: "pending", summary: null, evidence: [], completedAt: null },
            startedAt: null,
            completedAt: null,
            createdAt,
            updatedAt: createdAt,
          },
          updatedAt: createdAt,
        });
      }

      yield* transition({
        thread: input.audit,
        stage: "cancelled",
        leaseExpiresAt: null,
        lastError: `Repairs routed: ${input.report.summary}`,
        completedAt: createdAt,
      });
    },
  );

  const validateCompletedTaskBranch = Effect.fn("AutomationReactor.validateCompletedTaskBranch")(
    function* (thread: OrchestrationThread) {
      const automation = thread.automation;
      if (!automation || automation.taskKind === "planning" || automation.workflowId === null)
        return;
      const hasVerifiedChangeCheckpoint = thread.checkpoints.some(
        (checkpoint) =>
          checkpoint.status === "ready" &&
          checkpoint.files.length > 0 &&
          (automation.startedAt === null || checkpoint.completedAt >= automation.startedAt),
      );
      if (!hasVerifiedChangeCheckpoint) {
        return yield* new AutomationIntegrationError({
          message:
            "The task has no ready checkpoint containing implementation changes, so it cannot become a dependency yet.",
        });
      }
      const cwd = thread.worktreePath;
      const branch = thread.branch;
      if (!cwd || !branch) {
        return yield* new AutomationIntegrationError({
          message: "The autonomous task has no isolated worktree and task branch to verify.",
        });
      }
      const status = yield* git.execute({
        operation: "AutomationReactor.validateTask.status",
        cwd,
        args: ["status", "--porcelain=v1"],
      });
      if (status.stdout.trim().length > 0) {
        return yield* new AutomationIntegrationError({
          message:
            "Verification finished with uncommitted work. Commit the verified result and leave the task worktree clean.",
        });
      }
      const currentBranch = yield* git.execute({
        operation: "AutomationReactor.validateTask.currentBranch",
        cwd,
        args: ["branch", "--show-current"],
      });
      if (currentBranch.stdout.trim() !== branch) {
        return yield* new AutomationIntegrationError({
          message: `The verified worktree is on '${currentBranch.stdout.trim() || "detached HEAD"}', not its task branch '${branch}'.`,
        });
      }
      const [headTree, branchTree, ahead, alreadyIntegrated] = yield* Effect.all([
        git.execute({
          operation: "AutomationReactor.validateTask.headTree",
          cwd,
          args: ["rev-parse", "HEAD^{tree}"],
        }),
        git.execute({
          operation: "AutomationReactor.validateTask.branchTree",
          cwd,
          args: ["rev-parse", `${branch}^{tree}`],
        }),
        git.execute({
          operation: "AutomationReactor.validateTask.ahead",
          cwd,
          args: ["rev-list", "--count", `${automation.baseBranch}..${branch}`],
        }),
        automation.role === "integrator"
          ? git.execute({
              operation: "AutomationReactor.validateTask.alreadyIntegrated",
              cwd,
              args: ["merge-base", "--is-ancestor", branch, automation.baseBranch],
              allowNonZeroExit: true,
            })
          : Effect.succeed(null),
      ]);
      if (headTree.stdout.trim() !== branchTree.stdout.trim()) {
        return yield* new AutomationIntegrationError({
          message: "The verified worktree tree is not recorded by its task branch.",
        });
      }
      if (
        Number.parseInt(ahead.stdout.trim(), 10) < 1 &&
        (alreadyIntegrated === null || alreadyIntegrated.exitCode !== 0)
      ) {
        return yield* new AutomationIntegrationError({
          message: "The task branch has no committed result beyond the workflow base branch.",
        });
      }
    },
  );

  const mergeIntegrationIntoBase = Effect.fn("AutomationReactor.mergeIntegrationIntoBase")(
    function* (input: {
      readonly thread: OrchestrationThread;
      readonly project: OrchestrationProject;
    }) {
      const automation = input.thread.automation!;
      const integrationBranch = input.thread.branch;
      if (!integrationBranch) {
        return yield* new AutomationIntegrationError({
          message: "The verified integration task has no branch to merge.",
        });
      }
      const cwd = input.project.workspaceRoot;
      const model = yield* snapshots.getCommandReadModel();
      const dependencyBranches = resolveAutomationDependencyBranches({
        thread: input.thread,
        tasks: model.threads,
      });
      if (dependencyBranches.missing.length > 0) {
        return yield* new AutomationIntegrationError({
          message: `The integration result cannot be promoted because dependency output is missing for: ${dependencyBranches.missing.join(", ")}.`,
        });
      }
      for (const dependencyBranch of dependencyBranches.branches) {
        const included = yield* git.execute({
          operation: "AutomationReactor.mergeIntegration.includesDependency",
          cwd,
          args: ["merge-base", "--is-ancestor", dependencyBranch, integrationBranch],
          allowNonZeroExit: true,
        });
        if (included.exitCode !== 0) {
          return yield* new AutomationIntegrationError({
            message: `The verified integration branch is missing approved dependency '${dependencyBranch}'. Re-run integration and preserve every task branch before promotion.`,
          });
        }
      }
      const [status, currentBranch] = yield* Effect.all([
        git.execute({
          operation: "AutomationReactor.mergeIntegration.status",
          cwd,
          args: ["status", "--porcelain=v1"],
        }),
        git.execute({
          operation: "AutomationReactor.mergeIntegration.currentBranch",
          cwd,
          args: ["branch", "--show-current"],
        }),
      ]);
      if (status.stdout.trim().length > 0) {
        return yield* new AutomationIntegrationError({
          message:
            "The base worktree has uncommitted changes. Preserve or commit them before automatic integration can continue.",
        });
      }
      if (currentBranch.stdout.trim() !== automation.baseBranch) {
        return yield* new AutomationIntegrationError({
          message: `The primary worktree is on '${currentBranch.stdout.trim() || "detached HEAD"}'. Switch it to '${automation.baseBranch}' before integration continues.`,
        });
      }
      const alreadyMerged = yield* git.execute({
        operation: "AutomationReactor.mergeIntegration.alreadyMerged",
        cwd,
        args: ["merge-base", "--is-ancestor", integrationBranch, automation.baseBranch],
        allowNonZeroExit: true,
      });
      if (alreadyMerged.exitCode === 0) return;
      const fastForward = yield* git.execute({
        operation: "AutomationReactor.mergeIntegration.fastForwardGuard",
        cwd,
        args: ["merge-base", "--is-ancestor", automation.baseBranch, integrationBranch],
        allowNonZeroExit: true,
      });
      if (fastForward.exitCode !== 0) {
        return yield* new AutomationIntegrationError({
          message: `The base branch '${automation.baseBranch}' moved after integration began. Re-run the integration agent so it can merge the latest base and resolve conflicts.`,
        });
      }
      yield* git.execute({
        operation: "AutomationReactor.mergeIntegration.fastForward",
        cwd,
        args: ["merge", "--ff-only", integrationBranch],
      });
      yield* vcsStatus.refreshStatus(cwd).pipe(Effect.ignoreCause({ log: true }));
    },
  );

  const retryOrFail = Effect.fn("AutomationReactor.retryOrFail")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly detail: string;
    readonly attempt?: number;
    readonly retryPhase?: "implementation" | "verification";
    readonly verification?: NonNullable<OrchestrationThread["automation"]>["verification"];
  }) {
    const automation = input.thread.automation!;
    const consumedAttempt = input.attempt ?? automation.attempt;
    const retryPhase = input.retryPhase ?? automation.phase;
    const decision = automationRetryDecision({
      thread: {
        ...input.thread,
        automation: { ...automation, attempt: consumedAttempt },
      },
      detail: input.detail,
      phase: retryPhase,
    });
    const canRetry =
      decision.classification.retryable &&
      (retryPhase === "implementation"
        ? consumedAttempt < automation.maxAttempts
        : decision.canRetry);
    if (canRetry) {
      yield* transition({
        thread: input.thread,
        stage: "ready",
        phase: retryPhase,
        attempt: retryPhase === "verification" ? decision.nextAttempt : consumedAttempt,
        leaseExpiresAt: null,
        lastError: input.detail,
        feedback: decision.guidance,
        ...(input.verification !== undefined ? { verification: input.verification } : {}),
        completedAt: null,
      });
      return;
    }
    const completedAt = yield* nowIso;
    yield* transition({
      thread: input.thread,
      stage: "failed",
      phase: retryPhase,
      attempt: consumedAttempt,
      leaseExpiresAt: null,
      lastError: input.detail,
      feedback: decision.guidance,
      completedAt,
      ...(input.verification !== undefined
        ? { verification: input.verification }
        : automation.phase === "verification"
          ? {
              verification: {
                status: "failed" as const,
                summary: input.detail,
                evidence: [],
                completedAt,
              },
            }
          : {}),
    });
  });

  const dispatchRun = Effect.fn("AutomationReactor.dispatchRun")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly project: OrchestrationProject;
    readonly policy: OrchestrationProjectAutomationPolicy;
    readonly phase: "implementation" | "verification";
  }) {
    if (
      input.thread.automation?.workflowId !== null &&
      (!input.policy.createWorktrees || !input.policy.requireVerification)
    ) {
      return yield* new AutomationWorkflowPrerequisiteError({
        message:
          "Autonomous workflow requires dedicated worktrees and verification before an agent can run.",
      });
    }
    let thread = input.thread;
    if (
      thread.automation?.workflowId !== null &&
      thread.runtimeMode !== AUTOMATIC_WORKFLOW_RUNTIME_MODE
    ) {
      yield* engine.dispatch({
        type: "thread.runtime-mode.set",
        commandId: yield* serverCommandId("workflow-runtime-mode"),
        threadId: thread.id,
        runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE,
        createdAt: yield* nowIso,
      });
      thread = { ...thread, runtimeMode: AUTOMATIC_WORKFLOW_RUNTIME_MODE };
    }
    if (input.phase === "implementation") {
      yield* prepareWorktree({ ...input, thread });
    }
    const currentModel = yield* snapshots.getCommandReadModel();
    const workflowRoot = thread.automation?.workflowId
      ? currentModel.threads.find((candidate) => candidate.id === thread.automation!.workflowId)
      : undefined;
    const dependencyBranches =
      thread.automation?.role === "integrator"
        ? resolveAutomationDependencyBranches({
            thread,
            tasks: currentModel.threads,
          }).branches
        : [];
    const workflowEvidence =
      thread.automation?.role === "orchestrator" && workflowRoot
        ? buildAutomationWorkflowEvidence({
            workflowId: workflowRoot.id,
            excludeThreadId: thread.id,
            threads: currentModel.threads,
          })
        : null;
    const startedAt = yield* nowIso;
    const expiresAt = DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(startedAt), {
        minutes: thread.automation!.maxRuntimeMinutes,
      }),
    );
    const attempt =
      input.phase === "implementation"
        ? thread.automation!.attempt + 1
        : thread.automation!.attempt;
    yield* transition({
      thread,
      stage: "running",
      phase: input.phase,
      attempt,
      leaseExpiresAt: expiresAt,
      lastHeartbeatAt: startedAt,
      lastError: null,
      ...(input.phase === "implementation" ? { startedAt, completedAt: null } : {}),
      ...(input.phase === "verification"
        ? {
            verification: {
              status: "running" as const,
              summary: null,
              evidence: [],
              completedAt: null,
            },
          }
        : {}),
    });
    const transitionedThread: OrchestrationThread = {
      ...thread,
      automation: {
        ...thread.automation!,
        stage: "running",
        phase: input.phase,
        attempt,
        leaseExpiresAt: expiresAt,
        lastHeartbeatAt: startedAt,
      },
    };
    yield* scheduleLease(transitionedThread);
    yield* scheduleStuckCheck({ thread: transitionedThread, policy: input.policy });
    yield* engine
      .dispatch({
        type: "thread.turn.start",
        commandId: yield* serverCommandId(`turn-${input.phase}`),
        threadId: input.thread.id,
        message: {
          messageId: yield* messageId,
          role: "user",
          text: buildAutomationPrompt({
            ...input,
            thread: transitionedThread,
            dependencyBranches,
            workflowEvidence,
          }),
          attachments: [],
        },
        modelSelection: workflowModelSelection(thread, input.phase, workflowRoot),
        titleSeed: thread.title,
        runtimeMode: thread.runtimeMode,
        interactionMode: thread.interactionMode,
        createdAt: startedAt,
      })
      .pipe(
        Effect.catchCause((cause) =>
          retryOrFail({
            thread: transitionedThread,
            detail: Cause.pretty(cause),
            attempt,
            retryPhase: input.phase,
          }),
        ),
      );
  });

  const finishSuccessfulRun = Effect.fn("AutomationReactor.finishSuccessfulRun")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly project: OrchestrationProject;
    readonly policy: OrchestrationProjectAutomationPolicy;
    readonly verification: NonNullable<OrchestrationThread["automation"]>["verification"];
    readonly plan?: AutomationPlan;
  }) {
    const completedAt = yield* nowIso;
    const automation = input.thread.automation!;
    const planning = automation.taskKind === "planning";
    const workflowRoot = automation.workflowId
      ? (yield* snapshots.getCommandReadModel()).threads.find(
          (candidate) => candidate.id === automation.workflowId,
        )
      : undefined;
    const workflowConfig = (workflowRoot ?? input.thread).automation?.workflowConfig;

    if (!planning && automation.role !== "orchestrator") {
      yield* validateCompletedTaskBranch(input.thread);
    }
    if (planning && workflowConfig?.mode === "automatic") {
      if (!input.plan) {
        return yield* new AutomationWorkflowMaterializationError({
          message: "The orchestrator did not return a valid executable task plan.",
        });
      }
      yield* materializeWorkflow({
        root: input.thread,
        project: input.project,
        policy: input.policy,
        plan: input.plan,
      });
    }
    if (!planning && automation.role === "integrator" && workflowConfig?.mode === "automatic") {
      yield* mergeIntegrationIntoBase({ thread: input.thread, project: input.project });
    }

    const workflowWorker = !planning && automation.workflowId !== null;
    const stage =
      planning || (automation.role === "integrator" && workflowConfig?.mode === "review")
        ? "review"
        : workflowWorker || !input.policy.requireReview
          ? "complete"
          : "review";
    yield* transition({
      thread: input.thread,
      stage,
      leaseExpiresAt: null,
      completedAt,
      verification: input.verification,
    });
    if (stage === "complete") {
      yield* engine.dispatch({
        type: "thread.settle",
        commandId: yield* serverCommandId("settle"),
        threadId: input.thread.id,
      });
    }
    if (
      stage === "complete" &&
      automation.role === "orchestrator" &&
      workflowConfig?.mode === "automatic" &&
      workflowRoot?.automation &&
      workflowRoot.automation.stage !== "complete" &&
      workflowRoot.automation.stage !== "cancelled"
    ) {
      yield* completeWorkflowCoordinator(workflowRoot, completedAt);
      yield* engine.dispatch({
        type: "thread.settle",
        commandId: yield* serverCommandId("settle-workflow-root"),
        threadId: workflowRoot.id,
      });
    }
  });

  const reconcileProject = Effect.fn("AutomationReactor.reconcileProject")(function* (
    projectId: ProjectId,
  ) {
    const model = yield* snapshots.getCommandReadModel();
    const project = model.projects.find(
      (candidate) => candidate.id === projectId && candidate.deletedAt === null,
    );
    if (!project?.automationPolicy) return;
    const policy = project.automationPolicy;
    const tasks = model.threads.filter(
      (thread) =>
        thread.projectId === projectId &&
        thread.deletedAt === null &&
        thread.archivedAt === null &&
        thread.automation !== undefined,
    );

    for (const task of tasks) {
      const taskStage = task.automation!.stage;
      const needsLifecycleDetail =
        taskStage === "running" ||
        taskStage === "needs-input" ||
        taskStage === "complete" ||
        taskStage === "cancelled";
      const thread = needsLifecycleDetail
        ? Option.getOrElse(yield* snapshots.getThreadDetailById(task.id), () => task)
        : task;
      const automation = thread.automation!;
      if (
        (automation.stage === "review" || automation.stage === "failed") &&
        automation.taskKind === "planning" &&
        automation.workflowConfig?.mode === "automatic"
      ) {
        const finalAudit = latestWorkflowFinalAudit(thread.id, tasks);
        if (
          finalAudit &&
          completedFinalAuditCanRecoverCoordinator({ coordinator: thread, finalAudit })
        ) {
          const completedAt = yield* nowIso;
          yield* completeWorkflowCoordinator(thread, completedAt);
        } else if (
          automation.stage === "review" &&
          (finalAudit?.automation?.stage === "failed" ||
            finalAudit?.automation?.stage === "cancelled")
        ) {
          const completedAt = yield* nowIso;
          yield* transition({
            thread,
            stage: "failed",
            lastError:
              finalAudit.automation.lastError ??
              `The workflow final audit ended as ${finalAudit.automation.stage}.`,
            completedAt,
          });
        }
        if (automation.stage === "review" || finalAudit?.automation?.stage === "complete") {
          continue;
        }
      }
      if (automation.stage === "complete" || automation.stage === "cancelled") {
        if (
          automation.stage === "cancelled" &&
          automation.taskKind === "planning" &&
          automation.workflowConfig?.mode === "automatic"
        ) {
          const descendants = activeWorkflowThreadsForCancellation({
            workflowId: thread.id,
            projectId,
            threads: tasks,
          });
          if (descendants.length > 0) {
            const cancelledAt = yield* nowIso;
            yield* Effect.forEach(descendants, (descendant) =>
              transition({
                thread: descendant,
                stage: "cancelled",
                leaseExpiresAt: null,
                completedAt: cancelledAt,
              }),
            );
            // Each transition queues another reconciliation. Stop this pass so
            // stale pre-cancellation task snapshots cannot dispatch new work.
            return;
          }
        }
        if (thread.session?.status === "starting" || thread.session?.status === "running") {
          const interruptedAt = yield* nowIso;
          yield* engine.dispatch({
            type: "thread.turn.interrupt",
            commandId: yield* serverCommandId("cancel"),
            threadId: thread.id,
            ...(thread.session.activeTurnId ? { turnId: thread.session.activeTurnId } : {}),
            createdAt: interruptedAt,
          });
          continue;
        }
        if (
          automation.stage === "complete" &&
          automation.taskKind === "planning" &&
          automation.workflowConfig?.mode === "review"
        ) {
          const planText = latestAssistantText(thread);
          const plan = planText ? parseAutomationPlan(planText) : null;
          if (!plan) {
            yield* transition({
              thread,
              stage: "ready",
              phase: "verification",
              leaseExpiresAt: null,
              lastError: "The approved workflow plan is no longer available as valid JSON.",
              feedback:
                "Return the complete corrected executable plan as one fenced JSON block before approval is attempted again.",
              completedAt: null,
            });
            continue;
          }
          const materialized = yield* materializeWorkflow({
            root: thread,
            project,
            policy,
            plan,
          }).pipe(
            Effect.as(true),
            Effect.catchCause((cause) =>
              transition({
                thread,
                stage: "ready",
                phase: "verification",
                leaseExpiresAt: null,
                lastError: Cause.pretty(cause),
                feedback:
                  "The approved plan could not be materialized safely. Correct the collision or invalid graph and return the complete executable plan again.",
                completedAt: null,
              }).pipe(Effect.as(false)),
            ),
          );
          if (!materialized) continue;
        }
        if (
          automation.stage === "complete" &&
          automation.role === "integrator" &&
          automation.workflowId !== null
        ) {
          const workflowRoot = tasks.find((candidate) => candidate.id === automation.workflowId);
          if (workflowRoot?.automation?.workflowConfig?.mode === "review") {
            const merged = yield* validateCompletedTaskBranch(thread).pipe(
              Effect.andThen(mergeIntegrationIntoBase({ thread, project })),
              Effect.as(true),
              Effect.catchCause((cause) =>
                transition({
                  thread,
                  stage: "ready",
                  phase: "implementation",
                  leaseExpiresAt: null,
                  lastError: Cause.pretty(cause),
                  feedback:
                    "The reviewed integration could not be promoted safely. Reconcile the latest base branch in the integration worktree, keep all approved changes, and verify again.",
                  completedAt: null,
                }).pipe(Effect.as(false)),
              ),
            );
            if (!merged) continue;
          }
        }
        if (thread.settledOverride !== "settled" && !hasBlockingRequest(thread)) {
          yield* engine.dispatch({
            type: "thread.settle",
            commandId: yield* serverCommandId("settle-terminal-task"),
            threadId: thread.id,
          });
        }
        continue;
      }
      if (thread.settledOverride === "settled") {
        yield* engine.dispatch({
          type: "thread.unsettle",
          commandId: yield* serverCommandId("reopen-task"),
          threadId: thread.id,
          reason: "user",
        });
        continue;
      }
      if (automation.stage === "needs-input") {
        if (!hasBlockingRequest(thread)) {
          if (
            thread.session?.status === "running" ||
            thread.session?.status === "starting" ||
            automationDispatchCompletion(thread) !== null
          ) {
            yield* transition({ thread, stage: "running" });
          } else {
            yield* retryOrFail({
              thread,
              detail:
                thread.session?.lastError ??
                "The blocking request was cleared after the provider turn stopped without a checkpoint.",
              retryPhase: automation.phase,
            });
          }
        }
        continue;
      }
      if (automation.stage !== "running") continue;
      yield* scheduleLease(thread);
      yield* scheduleStuckCheck({ thread, policy });
      yield* scheduleAdoptionCheck(thread);
      if (hasBlockingRequest(thread)) {
        yield* transition({ thread, stage: "needs-input" });
        continue;
      }
      const currentTime = yield* DateTime.now;
      const currentIso = DateTime.formatIso(currentTime);
      if (automationDispatchStartExpired({ thread, now: currentIso })) {
        yield* retryOrFail({
          thread,
          detail:
            "The provider did not adopt the autonomous turn within five minutes. The queued start was recovered so the project could continue.",
        });
        continue;
      }
      if (automationIsStalled({ thread, policy, now: currentIso })) {
        if (thread.session?.status === "running") {
          yield* engine.dispatch({
            type: "thread.turn.interrupt",
            commandId: yield* serverCommandId("stalled"),
            threadId: thread.id,
            ...(thread.session.activeTurnId ? { turnId: thread.session.activeTurnId } : {}),
            createdAt: currentIso,
          });
        }
        yield* retryOrFail({
          thread,
          detail: `No agent activity was recorded for ${policy.stuckAfterMinutes} minutes. The run was stopped so it could not block the board.`,
        });
        continue;
      }
      if (
        automation.leaseExpiresAt &&
        DateTime.toEpochMillis(DateTime.makeUnsafe(automation.leaseExpiresAt)) <=
          DateTime.toEpochMillis(currentTime)
      ) {
        if (thread.session?.status === "running") {
          const interruptedAt = yield* nowIso;
          yield* engine.dispatch({
            type: "thread.turn.interrupt",
            commandId: yield* serverCommandId("lease-expired"),
            threadId: thread.id,
            ...(thread.session.activeTurnId ? { turnId: thread.session.activeTurnId } : {}),
            createdAt: interruptedAt,
          });
        }
        yield* retryOrFail({ thread, detail: "The autonomous run exceeded its runtime limit." });
        continue;
      }
      const latestTurnFailed =
        thread.session?.status === "error" || thread.latestTurn?.state === "error";
      if (latestTurnFailed) {
        yield* retryOrFail({
          thread,
          detail:
            thread.session?.lastError ??
            (automation.phase === "verification"
              ? "The verification turn failed."
              : "The implementation turn failed."),
        });
        continue;
      }
      const checkpoint = automationDispatchCompletion(thread);
      if (
        !checkpoint ||
        thread.session?.status === "running" ||
        thread.session?.status === "starting" ||
        automationHasActiveSubagents(thread)
      ) {
        continue;
      }
      if (automationCheckpointCapturePending(thread, checkpoint)) {
        continue;
      }
      if (checkpoint.status !== "ready" || thread.latestTurn?.state === "interrupted") {
        yield* retryOrFail({
          thread,
          detail:
            automation.phase === "verification"
              ? `The verification pass did not produce a ready checkpoint (status: ${checkpoint.status}).`
              : `The implementation pass did not produce a ready checkpoint (status: ${checkpoint.status}).`,
        });
        continue;
      }
      if (
        automation.taskKind === "planning" &&
        automation.workflowConfig !== undefined &&
        automation.phase === "implementation"
      ) {
        yield* dispatchRun({
          thread,
          project,
          policy,
          phase: "verification",
        }).pipe(Effect.catchCause((cause) => retryOrFail({ thread, detail: Cause.pretty(cause) })));
        continue;
      }
      if (automation.role === "orchestrator" && automation.phase === "implementation") {
        if (checkpoint.files.length > 0) {
          yield* retryOrFail({
            thread,
            detail:
              "The final orchestrator modified integrated files. Final audit must remain read-only so unreviewed changes cannot bypass workflow integration.",
            retryPhase: "implementation",
          });
          continue;
        }
        const reportText = latestAssistantText(thread);
        const report = reportText ? parseAutomationFinalAuditReport(reportText) : null;
        if (!report) {
          yield* retryOrFail({
            thread,
            detail: "The final orchestrator did not return a valid structured audit verdict.",
            retryPhase: "implementation",
          });
          continue;
        }
        if (report.status === "needs-input") {
          yield* transition({
            thread,
            stage: "needs-input",
            leaseExpiresAt: null,
            lastError: `Final orchestrator needs input: ${report.summary}`,
            feedback: report.summary,
            completedAt: null,
          });
          continue;
        }
        if (report.status === "repair-required") {
          yield* routeFinalAuditRepairs({ audit: thread, project, policy, report, tasks }).pipe(
            Effect.catchCause((cause) =>
              retryOrFail({
                thread,
                detail: Cause.pretty(cause),
                retryPhase: "implementation",
              }),
            ),
          );
          continue;
        }
        const completedAt = yield* nowIso;
        yield* finishSuccessfulRun({
          thread,
          project,
          policy,
          verification: {
            status: "passed",
            summary: report.summary,
            evidence: [
              { check: "Final orchestrator audit", detail: report.summary },
              ...report.remainingRisks.map((risk) => ({
                check: "Remaining risk",
                detail: risk,
              })),
            ],
            completedAt,
          },
        }).pipe(
          Effect.catchCause((cause) =>
            retryOrFail({
              thread,
              detail: Cause.pretty(cause),
              retryPhase: "implementation",
            }),
          ),
        );
        continue;
      }
      if (automation.role === "integrator" && automation.phase === "implementation") {
        const reportText = latestAssistantText(thread);
        const report = reportText ? parseAutomationIntegrationReport(reportText) : null;
        const expectedBranches = resolveAutomationDependencyBranches({ thread, tasks }).branches;
        const reportedBranches = new Set(report?.mergedBranches ?? []);
        if (
          !report ||
          report.status !== "integrated" ||
          expectedBranches.some((branch) => !reportedBranches.has(branch))
        ) {
          yield* retryOrFail({
            thread,
            detail: report
              ? [
                  `Integration agent verdict: ${report.status}. ${report.summary}`,
                  ...expectedBranches
                    .filter((branch) => !reportedBranches.has(branch))
                    .map((branch) => `Missing merged branch evidence: ${branch}`),
                ].join("\n")
              : "The integration agent did not return a valid structured integration report with concrete evidence.",
            retryPhase: "implementation",
          });
          continue;
        }
      }
      if (
        automation.taskKind !== "planning" &&
        automation.phase === "implementation" &&
        policy.requireVerification
      ) {
        yield* dispatchRun({
          thread,
          project,
          policy,
          phase: "verification",
        }).pipe(Effect.catchCause((cause) => retryOrFail({ thread, detail: Cause.pretty(cause) })));
        continue;
      }
      if (automation.taskKind === "planning" && automation.workflowConfig !== undefined) {
        const planText = latestAssistantText(thread);
        const plan = planText ? parseAutomationPlan(planText) : null;
        if (!plan) {
          yield* retryOrFail({
            thread,
            detail:
              "The orchestrator audit did not return a valid executable plan JSON block. Correct the plan shape, dependencies, scopes, and required fields.",
            retryPhase: "verification",
          });
          continue;
        }
        const completedAt = yield* nowIso;
        yield* finishSuccessfulRun({
          thread,
          project,
          policy,
          plan,
          verification: {
            status: "passed",
            summary: plan.summary,
            evidence: [
              {
                check: "Orchestrator plan audit",
                detail: `Validated ${plan.tasks.length} dependency-safe executable tasks against the repository.`,
              },
            ],
            completedAt,
          },
        }).pipe(
          Effect.catchCause((cause) =>
            retryOrFail({
              thread,
              detail: Cause.pretty(cause),
              retryPhase: "verification",
            }),
          ),
        );
        continue;
      }
      if (automation.phase === "verification") {
        if (checkpoint.files.length > 0) {
          yield* retryOrFail({
            thread,
            detail:
              "The independent verifier modified implementation files. Verification must remain read-only; return the task to implementation and verify again from a clean checkpoint.",
            retryPhase: "implementation",
          });
          continue;
        }
        const reportText = latestAssistantText(thread);
        const report = reportText ? parseAutomationVerificationReport(reportText) : null;
        if (!report) {
          yield* retryOrFail({
            thread,
            detail:
              "The verifier did not return a valid evidence report. Return status, summary, and concrete check details in the required JSON shape.",
            retryPhase: "verification",
          });
          continue;
        }
        if (!automationVerificationCoversCriteria(report, automation.acceptanceCriteria)) {
          yield* retryOrFail({
            thread,
            detail:
              "The verifier report did not include an explicitly labeled evidence check for every acceptance criterion.",
            retryPhase: "verification",
          });
          continue;
        }
        if (report.status === "failed") {
          const completedAt = yield* nowIso;
          const verification = {
            status: "failed" as const,
            summary: report.summary,
            evidence: report.checks.map((check) => ({
              check: check.check,
              detail: check.detail,
            })),
            completedAt,
          };
          yield* retryOrFail({
            thread,
            detail: [
              `Independent verification failed: ${report.summary}`,
              ...report.checks.map((check) => `${check.check}: ${check.detail}`),
            ].join("\n"),
            retryPhase: "implementation",
            verification,
          });
          continue;
        }
        const completedAt = yield* nowIso;
        yield* finishSuccessfulRun({
          thread,
          project,
          policy,
          verification: verificationFromReport(report, completedAt),
        }).pipe(
          Effect.catchCause((cause) =>
            retryOrFail({
              thread,
              detail: Cause.pretty(cause),
              retryPhase: "implementation",
            }),
          ),
        );
        continue;
      }
      const completedAt = yield* nowIso;
      yield* finishSuccessfulRun({
        thread,
        project,
        policy,
        verification: {
          status: policy.requireVerification ? "failed" : "skipped",
          summary: policy.requireVerification
            ? "The required verification phase was not run."
            : "Verification was skipped by the project automation policy.",
          evidence: [],
          completedAt,
        },
      }).pipe(
        Effect.catchCause((cause) =>
          retryOrFail({
            thread,
            detail: Cause.pretty(cause),
            retryPhase: "implementation",
          }),
        ),
      );
    }

    if (!policy.enabled) return;
    const refreshed = yield* snapshots.getCommandReadModel();
    const refreshedTasks = refreshed.threads.filter(
      (thread) =>
        thread.projectId === projectId &&
        thread.deletedAt === null &&
        thread.automation !== undefined,
    );
    const terminallyBlockedIds = new Set<ThreadId>();
    for (const thread of refreshedTasks) {
      if (thread.automation?.stage !== "ready" || thread.automation.workflowId === null) continue;
      const blockers = automationDependencyTerminalBlockers({
        thread,
        tasks: refreshedTasks,
      });
      if (blockers.length === 0) continue;
      terminallyBlockedIds.add(thread.id);
      const completedAt = yield* nowIso;
      yield* transition({
        thread,
        stage: "failed",
        leaseExpiresAt: null,
        lastError: blockers.map((blocker) => blocker.detail).join("\n"),
        completedAt,
      });
    }
    const runnableTasks = selectRunnableAutomationTasks({
      tasks: refreshedTasks.filter((thread) => !terminallyBlockedIds.has(thread.id)),
      availableSlots: automationAvailableSlots({ policy, tasks: refreshedTasks }),
    });
    yield* Effect.forEach(
      runnableTasks,
      (thread) => {
        const automation = thread.automation!;
        return dispatchRun({
          thread,
          project,
          policy,
          phase: automation.phase,
        }).pipe(
          Effect.catchCause((cause) =>
            retryOrFail({
              thread,
              detail: Cause.pretty(cause),
              ...(automation.phase === "implementation" ? { attempt: automation.attempt + 1 } : {}),
            }),
          ),
        );
      },
      { concurrency: "unbounded", discard: true },
    );
  });

  const reconcileProjectSafely = (projectId: ProjectId) =>
    reconcileProject(projectId).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("automation reactor failed to reconcile project", {
              projectId,
              cause: Cause.pretty(cause),
            }),
      ),
    );
  const worker = yield* makeKeyedCoalescingWorker({
    merge: () => undefined,
    process: reconcileProjectSafely,
  });
  enqueueProject = (projectId) => worker.enqueue(projectId, undefined);
  const automationProjectByThreadId = new Map<ThreadId, ProjectId>();

  const projectIdForEvent = Effect.fn("AutomationReactor.projectIdForEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.aggregateKind === "project") return event.aggregateId as ProjectId;
    const threadId = event.aggregateId as ThreadId;
    const cachedProjectId = automationProjectByThreadId.get(threadId);
    if (cachedProjectId) return cachedProjectId;
    if (event.type !== "thread.automation-configured") return null;

    const thread = Option.getOrNull(yield* snapshots.getThreadShellById(threadId));
    if (!thread?.automation) return null;
    automationProjectByThreadId.set(threadId, thread.projectId);
    return thread.projectId;
  });

  const shouldReconcile = (event: OrchestrationEvent): boolean =>
    event.type === "project.automation-configured" ||
    event.type === "thread.automation-configured" ||
    event.type === "thread.automation-transitioned" ||
    event.type === "thread.session-set" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.approval-response-requested" ||
    event.type === "thread.user-input-response-requested" ||
    event.type === "thread.deleted";

  const start: AutomationReactorShape["start"] = Effect.fn("AutomationReactor.start")(function* () {
    yield* Effect.gen(function* () {
      const initialModel = yield* snapshots.getCommandReadModel();
      for (const thread of initialModel.threads) {
        if (thread.automation !== undefined) {
          automationProjectByThreadId.set(thread.id, thread.projectId);
        }
      }
      yield* Effect.forEach(
        initialModel.threads.filter(
          (thread) =>
            automationNeedsStartupRecovery(thread) ||
            (thread.automation !== undefined &&
              (thread.session?.status === "starting" || thread.session?.status === "running")),
        ),
        (thread) => {
          const automation = thread.automation!;
          const needsRunRecovery = automationNeedsStartupRecovery(thread);
          return Effect.gen(function* () {
            const recoveredAt = yield* nowIso;
            yield* engine.dispatch({
              type: "thread.session.set",
              commandId: yield* serverCommandId("recover-interrupted-session"),
              threadId: thread.id,
              session: {
                threadId: thread.id,
                status: "stopped",
                providerName: thread.session?.providerName ?? null,
                ...(thread.session?.providerInstanceId !== undefined
                  ? { providerInstanceId: thread.session.providerInstanceId }
                  : {}),
                runtimeMode: thread.session?.runtimeMode ?? thread.runtimeMode,
                activeTurnId: null,
                lastError: thread.session?.lastError ?? null,
                updatedAt: recoveredAt,
              },
              createdAt: recoveredAt,
            });
            if (!needsRunRecovery) return;
            yield* transition({
              thread,
              stage: "ready",
              attempt: Math.max(0, automation.attempt - 1),
              leaseExpiresAt: null,
              lastError: "The FACT3 server restarted before this autonomous turn finished.",
              feedback:
                "Resume from the existing isolated worktree after the recovered provider session is fully stopped. Do not discard durable progress.",
              completedAt: null,
            });
          });
        },
        { discard: true },
      );

      yield* Effect.forkScoped(
        engine.streamDomainEvents.pipe(
          Stream.filter(shouldReconcile),
          Stream.runForEach((event) =>
            projectIdForEvent(event).pipe(
              Effect.flatMap((projectId) =>
                projectId === null ? Effect.void : worker.enqueue(projectId, undefined),
              ),
              Effect.ensuring(
                event.type === "thread.deleted"
                  ? Effect.sync(() => automationProjectByThreadId.delete(event.payload.threadId))
                  : Effect.void,
              ),
              Effect.catchCause((cause) =>
                Cause.hasInterruptsOnly(cause)
                  ? Effect.interrupt
                  : Effect.logWarning("automation reactor could not resolve event project", {
                      eventType: event.type,
                      cause: Cause.pretty(cause),
                    }),
              ),
            ),
          ),
        ),
      );

      const refreshedModel = yield* snapshots.getCommandReadModel();
      yield* Effect.forEach(
        refreshedModel.projects.filter((project) => project.automationPolicy !== undefined),
        (project) => worker.enqueue(project.id, undefined),
        { discard: true },
      );
    }).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.interrupt
          : Effect.logWarning("automation reactor could not hydrate startup state", {
              cause: Cause.pretty(cause),
            }),
      ),
    );
  });

  return {
    start,
    drain: worker.drain,
  } satisfies AutomationReactorShape;
});

export const AutomationReactorLive = Layer.effect(AutomationReactor, make);
