import {
  CommandId,
  MessageId,
  type OrchestrationEvent,
  type OrchestrationProject,
  type OrchestrationProjectAutomationPolicy,
  type OrchestrationThread,
  type ProjectId,
  type ThreadId,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
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
import { GitVcsDriver } from "../../vcs/GitVcsDriver.ts";
import { VcsStatusBroadcaster } from "../../vcs/VcsStatusBroadcaster.ts";
import { OrchestrationEngineService } from "../Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../Services/ProjectionSnapshotQuery.ts";
import { AutomationReactor, type AutomationReactorShape } from "../Services/AutomationReactor.ts";
import {
  automationAvailableSlots,
  automationDispatchCompletion,
  automationIsStalled,
  automationStuckDeadline,
  buildAutomationPrompt,
  resolveAutomationDependencyBranches,
  selectRunnableAutomationTasks,
} from "../AutomationReactor.logic.ts";

const nowIso = Effect.map(DateTime.now, DateTime.formatIso);

class AutomationDependencyMaterializationError extends Data.TaggedError(
  "AutomationDependencyMaterializationError",
)<{
  readonly message: string;
}> {}

function hasBlockingRequest(thread: OrchestrationThread): boolean {
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
    }
    if (activity.kind === "approval.resolved" || activity.kind === "user-input.resolved") {
      open.delete(requestId);
    }
  }
  return open.size > 0;
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const engine = yield* OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery;
  const gitWorkflow = yield* GitWorkflowService;
  const git = yield* GitVcsDriver;
  const vcsStatus = yield* VcsStatusBroadcaster;
  const scheduledLeases = new Map<ThreadId, string>();
  const scheduledStuckChecks = new Map<ThreadId, string>();

  const serverCommandId = (label: string) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((id) => CommandId.make(`server:automation:${label}:${id}`)),
    );
  const messageId = crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(MessageId.make));

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
    yield* engine.dispatch({
      type: "thread.meta.update",
      commandId: yield* serverCommandId("worktree"),
      threadId: input.thread.id,
      branch: worktree.worktree.refName,
      worktreePath: worktree.worktree.path,
    });
    yield* vcsStatus.refreshStatus(worktree.worktree.path).pipe(Effect.ignoreCause({ log: true }));
  });

  const retryOrFail = Effect.fn("AutomationReactor.retryOrFail")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly detail: string;
    readonly attempt?: number;
  }) {
    const automation = input.thread.automation!;
    const attempt = input.attempt ?? automation.attempt;
    if (attempt < automation.maxAttempts) {
      yield* transition({
        thread: input.thread,
        stage: "ready",
        attempt,
        leaseExpiresAt: null,
        lastError: input.detail,
      });
      return;
    }
    const completedAt = yield* nowIso;
    yield* transition({
      thread: input.thread,
      stage: "failed",
      attempt,
      leaseExpiresAt: null,
      lastError: input.detail,
      completedAt,
      ...(automation.phase === "verification"
        ? {
            verification: {
              status: "failed" as const,
              summary: input.detail,
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
    if (input.phase === "implementation") {
      yield* prepareWorktree(input);
    }
    const startedAt = yield* nowIso;
    const expiresAt = DateTime.formatIso(
      DateTime.add(DateTime.makeUnsafe(startedAt), {
        minutes: input.thread.automation!.maxRuntimeMinutes,
      }),
    );
    const attempt =
      input.phase === "implementation"
        ? input.thread.automation!.attempt + 1
        : input.thread.automation!.attempt;
    yield* transition({
      thread: input.thread,
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
              completedAt: null,
            },
          }
        : {}),
    });
    const transitionedThread: OrchestrationThread = {
      ...input.thread,
      automation: {
        ...input.thread.automation!,
        stage: "running",
        phase: input.phase,
        attempt,
        leaseExpiresAt: expiresAt,
        lastHeartbeatAt: startedAt,
      },
    };
    yield* scheduleLease(transitionedThread);
    yield* scheduleStuckCheck({ thread: transitionedThread, policy: input.policy });
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: yield* serverCommandId(`turn-${input.phase}`),
      threadId: input.thread.id,
      message: {
        messageId: yield* messageId,
        role: "user",
        text: buildAutomationPrompt({ ...input, thread: transitionedThread }),
        attachments: [],
      },
      modelSelection: input.thread.modelSelection,
      titleSeed: input.thread.title,
      runtimeMode: input.thread.runtimeMode,
      interactionMode: input.thread.interactionMode,
      createdAt: startedAt,
    });
  });

  const finishSuccessfulRun = Effect.fn("AutomationReactor.finishSuccessfulRun")(function* (input: {
    readonly thread: OrchestrationThread;
    readonly policy: OrchestrationProjectAutomationPolicy;
  }) {
    const completedAt = yield* nowIso;
    const planning = input.thread.automation?.taskKind === "planning";
    const stage = planning || input.policy.requireReview ? "review" : "complete";
    yield* transition({
      thread: input.thread,
      stage,
      leaseExpiresAt: null,
      completedAt,
      verification: {
        status: "passed",
        summary: planning
          ? "The project plan is ready for approval."
          : "The autonomous verification turn completed successfully.",
        completedAt,
      },
    });
    if (stage === "complete") {
      yield* engine.dispatch({
        type: "thread.settle",
        commandId: yield* serverCommandId("settle"),
        threadId: input.thread.id,
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
      if (automation.stage === "complete" || automation.stage === "cancelled") {
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
        if (!hasBlockingRequest(thread) && thread.session?.status === "running") {
          yield* transition({ thread, stage: "running" });
        }
        continue;
      }
      if (automation.stage !== "running") continue;
      yield* scheduleLease(thread);
      yield* scheduleStuckCheck({ thread, policy });
      if (hasBlockingRequest(thread)) {
        yield* transition({ thread, stage: "needs-input" });
        continue;
      }
      const currentTime = yield* DateTime.now;
      const currentIso = DateTime.formatIso(currentTime);
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
        yield* transition({
          thread,
          stage: "failed",
          leaseExpiresAt: null,
          lastError: `No agent activity was recorded for ${policy.stuckAfterMinutes} minutes. The run was stopped so it could not block the board.`,
          completedAt: currentIso,
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
        thread.session?.status === "starting"
      ) {
        continue;
      }
      if (checkpoint.status === "error" || thread.latestTurn?.state === "interrupted") {
        yield* retryOrFail({
          thread,
          detail:
            automation.phase === "verification"
              ? "The verification pass did not complete successfully."
              : "The implementation pass did not complete successfully.",
        });
        continue;
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
      yield* finishSuccessfulRun({ thread, policy });
    }

    if (!policy.enabled) return;
    const refreshed = yield* snapshots.getCommandReadModel();
    const refreshedTasks = refreshed.threads.filter(
      (thread) =>
        thread.projectId === projectId &&
        thread.deletedAt === null &&
        thread.automation !== undefined,
    );
    const runnableTasks = selectRunnableAutomationTasks({
      tasks: refreshedTasks,
      availableSlots: automationAvailableSlots({ policy, tasks: refreshedTasks }),
    });
    for (const thread of runnableTasks) {
      const automation = thread.automation!;
      yield* dispatchRun({
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
    }
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
  const worker = yield* makeDrainableWorker(reconcileProjectSafely);
  enqueueProject = worker.enqueue;

  const projectIdForEvent = Effect.fn("AutomationReactor.projectIdForEvent")(function* (
    event: OrchestrationEvent,
  ) {
    if (event.aggregateKind === "project") return event.aggregateId as ProjectId;
    const model = yield* snapshots.getCommandReadModel();
    return model.threads.find((thread) => thread.id === event.aggregateId)?.projectId ?? null;
  });

  const shouldReconcile = (event: OrchestrationEvent): boolean =>
    event.type === "project.automation-configured" ||
    event.type === "thread.automation-configured" ||
    event.type === "thread.automation-transitioned" ||
    event.type === "thread.session-set" ||
    event.type === "thread.turn-diff-completed" ||
    event.type === "thread.activity-appended" ||
    event.type === "thread.approval-response-requested" ||
    event.type === "thread.user-input-response-requested";

  const start: AutomationReactorShape["start"] = Effect.fn("AutomationReactor.start")(function* () {
    yield* Effect.forkScoped(
      engine.streamDomainEvents.pipe(
        Stream.filter(shouldReconcile),
        Stream.runForEach((event) =>
          projectIdForEvent(event).pipe(
            Effect.flatMap((projectId) =>
              projectId === null ? Effect.void : worker.enqueue(projectId),
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
    yield* snapshots.getCommandReadModel().pipe(
      Effect.flatMap((model) =>
        Effect.forEach(
          model.projects.filter((project) => project.automationPolicy !== undefined),
          (project) => worker.enqueue(project.id),
          { discard: true },
        ),
      ),
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
