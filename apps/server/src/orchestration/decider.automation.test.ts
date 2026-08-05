import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  EventId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThreadAutomation,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";
import { createEmptyReadModel, projectEvent } from "./projector.ts";

const NOW = "2026-08-03T12:00:00.000Z";
const projectId = ProjectId.make("automation-project");
const threadA = ThreadId.make("automation-a");
const threadB = ThreadId.make("automation-b");

const automation = (dependencies: ReadonlyArray<ThreadId> = []): OrchestrationThreadAutomation => ({
  taskKind: "implementation",
  workflowId: null,
  workflowTaskKey: null,
  role: "worker",
  goal: "Implement the autonomous task",
  acceptanceCriteria: ["Focused tests pass"],
  dependencies,
  changeScopes: ["apps/server/src/orchestration"],
  baseBranch: "main",
  stage: "ready",
  phase: "implementation",
  attempt: 0,
  maxAttempts: 2,
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
});

function event(input: {
  readonly sequence: number;
  readonly type: OrchestrationEvent["type"];
  readonly aggregateKind: OrchestrationEvent["aggregateKind"];
  readonly aggregateId: ProjectId | ThreadId;
  readonly payload: unknown;
}): OrchestrationEvent {
  return {
    sequence: input.sequence,
    eventId: EventId.make(`automation-event-${input.sequence}`),
    type: input.type,
    aggregateKind: input.aggregateKind,
    aggregateId: input.aggregateId,
    occurredAt: NOW,
    commandId: CommandId.make(`automation-command-${input.sequence}`),
    causationEventId: null,
    correlationId: null,
    metadata: {},
    payload: input.payload,
  } as OrchestrationEvent;
}

const seed = Effect.gen(function* () {
  let model = createEmptyReadModel(NOW);
  model = yield* projectEvent(
    model,
    event({
      sequence: 1,
      type: "project.created",
      aggregateKind: "project",
      aggregateId: projectId,
      payload: {
        projectId,
        title: "Automation",
        workspaceRoot: "/tmp/automation",
        defaultModelSelection: null,
        scripts: [],
        createdAt: NOW,
        updatedAt: NOW,
      },
    }),
  );
  for (const [index, threadId] of [threadA, threadB].entries()) {
    model = yield* projectEvent(
      model,
      event({
        sequence: index + 2,
        type: "thread.created",
        aggregateKind: "thread",
        aggregateId: threadId,
        payload: {
          threadId,
          projectId,
          title: `Task ${index + 1}`,
          modelSelection: {
            instanceId: ProviderInstanceId.make("codex"),
            model: "gpt-5.6-sol",
          },
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: "main",
          worktreePath: null,
          createdAt: NOW,
          updatedAt: NOW,
        },
      }),
    );
  }
  return model;
});

function decide(command: OrchestrationCommand, readModel: OrchestrationReadModel) {
  return decideOrchestrationCommand({ command, readModel });
}

type PlannedEvent = OrchestrationEvent extends infer Event
  ? Event extends OrchestrationEvent
    ? Omit<Event, "sequence">
    : never
  : never;

function singleEvent(result: unknown): PlannedEvent {
  return (Array.isArray(result) ? result[0]! : result) as PlannedEvent;
}

function sequenced(result: unknown, sequence: number): OrchestrationEvent {
  return { ...singleEvent(result), sequence } as OrchestrationEvent;
}

it.layer(NodeServices.layer)("automation decider", (it) => {
  it.effect("persists bounded project policy and thread automation state", () =>
    Effect.gen(function* () {
      const model = yield* seed;
      const policyEvent = yield* decide(
        {
          type: "project.automation.configure",
          commandId: CommandId.make("configure-project"),
          projectId,
          policy: {
            enabled: true,
            maxConcurrentRuns: 3,
            defaultMaxAttempts: 2,
            defaultMaxRuntimeMinutes: 60,
            stuckAfterMinutes: 15,
            createWorktrees: true,
            requireVerification: true,
            requireReview: true,
            deliveryMode: "pull-request",
          },
          updatedAt: NOW,
        },
        model,
      );
      expect(singleEvent(policyEvent).type).toBe("project.automation-configured");

      const configuredA = yield* decide(
        {
          type: "thread.automation.configure",
          commandId: CommandId.make("configure-prerequisite"),
          threadId: threadA,
          automation: automation(),
          updatedAt: NOW,
        },
        model,
      );
      const withConfiguredA = yield* projectEvent(model, sequenced(configuredA, 4));
      const configured = yield* decide(
        {
          type: "thread.automation.configure",
          commandId: CommandId.make("configure-thread"),
          threadId: threadB,
          automation: automation([threadA]),
          updatedAt: NOW,
        },
        withConfiguredA,
      );
      const configuredSingle = singleEvent(configured);
      expect(configuredSingle.type).toBe("thread.automation-configured");
      if (configuredSingle.type === "thread.automation-configured") {
        expect(configuredSingle.payload.automation.dependencies).toEqual([threadA]);
      }
    }),
  );

  it.effect("rejects self dependencies and dependency cycles", () =>
    Effect.gen(function* () {
      const model = yield* seed;
      const selfError = yield* Effect.flip(
        decide(
          {
            type: "thread.automation.configure",
            commandId: CommandId.make("self-dependency"),
            threadId: threadA,
            automation: automation([threadA]),
            updatedAt: NOW,
          },
          model,
        ),
      );
      expect(selfError.message).toContain("cannot depend on itself");

      const configureB = yield* decide(
        {
          type: "thread.automation.configure",
          commandId: CommandId.make("configure-b"),
          threadId: threadB,
          automation: automation(),
          updatedAt: NOW,
        },
        model,
      );
      const withB = yield* projectEvent(model, sequenced(configureB, 4));
      const configureA = yield* decide(
        {
          type: "thread.automation.configure",
          commandId: CommandId.make("a-depends-b"),
          threadId: threadA,
          automation: automation([threadB]),
          updatedAt: NOW,
        },
        withB,
      );
      const withA = yield* projectEvent(withB, sequenced(configureA, 5));
      const cycleError = yield* Effect.flip(
        decide(
          {
            type: "thread.automation.configure",
            commandId: CommandId.make("b-depends-a"),
            threadId: threadB,
            automation: automation([threadA]),
            updatedAt: NOW,
          },
          withA,
        ),
      );
      expect(cycleError.message).toContain("cannot contain a cycle");
    }),
  );

  it.effect("rejects dependencies that are not autonomous tasks", () =>
    Effect.gen(function* () {
      const model = yield* seed;
      const error = yield* Effect.flip(
        decide(
          {
            type: "thread.automation.configure",
            commandId: CommandId.make("non-automation-dependency"),
            threadId: threadB,
            automation: automation([threadA]),
            updatedAt: NOW,
          },
          model,
        ),
      );
      expect(error.message).toContain("not configured for automation");
    }),
  );

  it.effect("enforces stage transitions and optimistic stage checks", () =>
    Effect.gen(function* () {
      const model = yield* seed;
      const configuredEvent = yield* decide(
        {
          type: "thread.automation.configure",
          commandId: CommandId.make("configure-transition"),
          threadId: threadA,
          automation: automation(),
          updatedAt: NOW,
        },
        model,
      );
      const configured = yield* projectEvent(model, sequenced(configuredEvent, 4));

      const staleError = yield* Effect.flip(
        decide(
          {
            type: "thread.automation.transition",
            commandId: CommandId.make("stale-transition"),
            threadId: threadA,
            expectedStage: "review",
            stage: "complete",
            updatedAt: NOW,
          },
          configured,
        ),
      );
      expect(staleError.message).toContain("moved from 'review' to 'ready'");

      const invalidError = yield* Effect.flip(
        decide(
          {
            type: "thread.automation.transition",
            commandId: CommandId.make("invalid-transition"),
            threadId: threadA,
            expectedStage: "ready",
            stage: "complete",
            updatedAt: NOW,
          },
          configured,
        ),
      );
      expect(invalidError.message).toContain("cannot move from 'ready' to 'complete'");

      const paused = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("pause-transition"),
          threadId: threadA,
          expectedStage: "ready",
          stage: "planned",
          updatedAt: NOW,
        },
        configured,
      );
      const pausedModel = yield* projectEvent(configured, sequenced(paused, 5));
      const resumed = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("resume-transition"),
          threadId: threadA,
          expectedStage: "planned",
          stage: "ready",
          updatedAt: NOW,
        },
        pausedModel,
      );
      expect(singleEvent(resumed).type).toBe("thread.automation-transitioned");

      const running = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("start-transition"),
          threadId: threadA,
          expectedStage: "ready",
          stage: "running",
          phase: "implementation",
          attempt: 1,
          updatedAt: NOW,
        },
        configured,
      );
      expect(singleEvent(running).type).toBe("thread.automation-transitioned");

      const runningModel = yield* projectEvent(configured, sequenced(running, 5));
      const retry = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("retry-transition"),
          threadId: threadA,
          expectedStage: "running",
          stage: "ready",
          phase: "implementation",
          lastError: "Provider process exited unexpectedly",
          updatedAt: NOW,
        },
        runningModel,
      );
      expect(singleEvent(retry).type).toBe("thread.automation-transitioned");

      const review = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("review-transition"),
          threadId: threadA,
          expectedStage: "running",
          stage: "review",
          updatedAt: NOW,
        },
        runningModel,
      );
      const reviewModel = yield* projectEvent(runningModel, sequenced(review, 6));
      const failedCoordination = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("coordination-failed-transition"),
          threadId: threadA,
          expectedStage: "review",
          stage: "failed",
          lastError: "Integration failed",
          updatedAt: NOW,
        },
        reviewModel,
      );
      expect(singleEvent(failedCoordination).type).toBe("thread.automation-transitioned");
      const failedModel = yield* projectEvent(reviewModel, sequenced(failedCoordination, 7));
      const recoveredCompletion = yield* decide(
        {
          type: "thread.automation.transition",
          commandId: CommandId.make("coordination-recovered-completion"),
          threadId: threadA,
          expectedStage: "failed",
          stage: "complete",
          lastError: null,
          completedAt: NOW,
          updatedAt: NOW,
        },
        failedModel,
      );
      expect(singleEvent(recoveredCompletion).type).toBe("thread.automation-transitioned");
    }),
  );
});
