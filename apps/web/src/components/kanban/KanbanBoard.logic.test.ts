import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import {
  automationConflictBlockers,
  capCompletedKanbanThreads,
  classifyKanbanThread,
  compactKanbanLaneEmptyLabel,
  describeEmptyKanbanActivity,
  describeKanbanThreadState,
  firstUserGoal,
  groupKanbanThreads,
  incompleteAutomationDependencies,
  isAutomaticWorkflowCoordinator,
  isCancellableAutomaticWorkflowCoordinator,
  isKanbanReviewDeliveryReady,
  isKanbanThreadVerified,
  kanbanStateLabelsByThreadId,
  kanbanInspectorSectionOrder,
  latestCheckpointSummary,
  liveKanbanAutomation,
  parseAutomationPlan,
  presentKanbanAutomationError,
} from "./KanbanBoard.logic";

const NOW = "2026-08-03T10:00:00.000Z";

function thread(
  overrides: Partial<EnvironmentThreadShell> & Pick<EnvironmentThreadShell, "id">,
): EnvironmentThreadShell {
  const { id, ...rest } = overrides;
  return {
    environmentId: EnvironmentId.make("local"),
    id,
    projectId: ProjectId.make("project"),
    title: "Worktree task",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.6-sol" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: "feat/task",
    worktreePath: "D:/worktrees/task",
    latestTurn: null,
    createdAt: "2026-08-03T08:00:00.000Z",
    updatedAt: "2026-08-03T09:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...rest,
  };
}

function automation(): NonNullable<EnvironmentThreadShell["automation"]> {
  return {
    taskKind: "implementation",
    workflowId: null,
    workflowTaskKey: null,
    role: "worker",
    goal: "Ship the board",
    acceptanceCriteria: [],
    dependencies: [],
    changeScopes: [],
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
  };
}

describe("Kanban board lifecycle", () => {
  it("prefers the live shell automation over a stale cached detail", () => {
    const stale = {
      taskKind: "implementation" as const,
      workflowId: null,
      workflowTaskKey: null,
      role: "worker" as const,
      goal: "Ship the board",
      acceptanceCriteria: [],
      dependencies: [],
      changeScopes: [],
      baseBranch: "main",
      stage: "running" as const,
      phase: "verification" as const,
      attempt: 1,
      maxAttempts: 2,
      maxRuntimeMinutes: 60,
      leaseExpiresAt: null,
      lastHeartbeatAt: NOW,
      lastError: null,
      feedback: null,
      verification: {
        status: "running" as const,
        summary: null,
        evidence: [],
        completedAt: null,
      },
      startedAt: NOW,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const live = {
      ...stale,
      stage: "review" as const,
      verification: {
        status: "passed" as const,
        summary: "Verification passed.",
        evidence: [{ check: "Focused tests", detail: "Passed" }],
        completedAt: NOW,
      },
    };

    expect(liveKanbanAutomation({ automation: live }, { automation: stale })).toBe(live);
  });

  it("maps durable automation stages to purposeful board lanes", () => {
    const automation = {
      taskKind: "implementation" as const,
      workflowId: null,
      workflowTaskKey: null,
      role: "worker" as const,
      goal: "Ship the board",
      acceptanceCriteria: [],
      dependencies: [],
      changeScopes: [],
      baseBranch: "main",
      phase: "implementation" as const,
      attempt: 0,
      maxAttempts: 2,
      maxRuntimeMinutes: 60,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastError: null,
      feedback: null,
      verification: {
        status: "pending" as const,
        summary: null,
        evidence: [],
        completedAt: null,
      },
      startedAt: null,
      completedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const queued = thread({
      id: ThreadId.make("queued"),
      automation: { ...automation, stage: "ready" },
    });
    const needsInput = thread({
      id: ThreadId.make("needs-input"),
      automation: { ...automation, stage: "needs-input" },
    });
    const review = thread({
      id: ThreadId.make("review"),
      automation: { ...automation, stage: "review" },
    });

    expect(classifyKanbanThread(queued, NOW)).toBe("queue");
    expect(classifyKanbanThread(needsInput, NOW)).toBe("attention");
    expect(classifyKanbanThread(review, NOW)).toBe("review");
    expect(describeKanbanThreadState(queued)).toBe("Queued");
  });

  it("keeps an automatic workflow root visibly coordinating until integration finishes", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    };
    const root = thread({
      id: ThreadId.make("workflow-root"),
      automation: {
        ...automation(),
        taskKind: "planning",
        workflowId: ThreadId.make("workflow-root"),
        role: "orchestrator",
        workflowConfig: {
          mode: "automatic",
          roles: {
            orchestrator: selection,
            planner: selection,
            worker: selection,
            verifier: selection,
            integrator: selection,
            visual: selection,
          },
        },
        stage: "review",
      },
    });

    expect(classifyKanbanThread(root, NOW)).toBe("running");
    expect(describeKanbanThreadState(root)).toBe("Coordinating");
    expect(isAutomaticWorkflowCoordinator(root.automation)).toBe(true);
    expect(isCancellableAutomaticWorkflowCoordinator(root.automation)).toBe(true);
    expect(
      isCancellableAutomaticWorkflowCoordinator({ ...root.automation!, stage: "needs-input" }),
    ).toBe(true);
    expect(
      isCancellableAutomaticWorkflowCoordinator({ ...root.automation!, stage: "cancelled" }),
    ).toBe(false);
  });

  it("requires a clean integration worktree before human approval", () => {
    const base = {
      taskKind: "implementation" as const,
      workflowIntegration: true,
      gitStatusAvailable: true,
      deliveryMode: "pull-request" as const,
      pullRequestOpen: false,
      aheadCount: 3,
    };

    expect(isKanbanReviewDeliveryReady({ ...base, hasWorkingTreeChanges: true })).toBe(false);
    expect(isKanbanReviewDeliveryReady({ ...base, hasWorkingTreeChanges: false })).toBe(true);
  });

  it("only calls review work verified when verification evidence passed", () => {
    const legacy = thread({ id: ThreadId.make("legacy-review") });
    const unverified = thread({
      id: ThreadId.make("unverified-review"),
      automation: { ...automation(), stage: "review" },
    });
    const verified = thread({
      id: ThreadId.make("verified-review"),
      automation: {
        ...automation(),
        stage: "review",
        verification: {
          status: "passed",
          summary: "Focused tests passed.",
          evidence: [{ check: "Focused tests", detail: "Passed" }],
          completedAt: NOW,
        },
      },
    });

    expect(isKanbanThreadVerified(legacy)).toBe(false);
    expect(isKanbanThreadVerified(unverified)).toBe(false);
    expect(isKanbanThreadVerified(verified)).toBe(true);
    expect(describeKanbanThreadState(legacy)).toBe("Awaiting review");
    expect(describeKanbanThreadState(unverified)).toBe("Ready for review");
    expect(describeKanbanThreadState(verified)).toBe("Verified · ready for review");
  });

  it("keeps a queued task blocked until all configured dependencies complete", () => {
    const dependency = thread({
      id: ThreadId.make("dependency"),
      automation: {
        taskKind: "implementation",
        workflowId: null,
        workflowTaskKey: null,
        role: "worker",
        goal: "Build dependency",
        acceptanceCriteria: [],
        dependencies: [],
        changeScopes: ["apps/web/src/components"],
        baseBranch: "main",
        stage: "running",
        phase: "implementation",
        attempt: 1,
        maxAttempts: 2,
        maxRuntimeMinutes: 60,
        leaseExpiresAt: null,
        lastHeartbeatAt: NOW,
        lastError: null,
        feedback: null,
        verification: { status: "pending", summary: null, evidence: [], completedAt: null },
        startedAt: NOW,
        completedAt: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    });
    const dependent = thread({
      id: ThreadId.make("dependent"),
      automation: {
        ...dependency.automation!,
        goal: "Build dependent",
        stage: "ready",
        attempt: 0,
        dependencies: [dependency.id],
      },
    });

    expect(incompleteAutomationDependencies(dependent, [dependency, dependent])).toEqual([
      dependency,
    ]);
    const completedDependency = {
      ...dependency,
      automation: { ...dependency.automation!, stage: "complete" as const },
    };
    expect(incompleteAutomationDependencies(dependent, [completedDependency, dependent])).toEqual(
      [],
    );
  });

  it("does not present an automatic workflow coordinator as a dependency blocker", () => {
    const selection = {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    };
    const coordinator = thread({
      id: ThreadId.make("workflow-root"),
      automation: {
        ...automation(),
        taskKind: "planning",
        workflowId: ThreadId.make("workflow-root"),
        role: "orchestrator",
        workflowConfig: {
          mode: "automatic",
          roles: {
            orchestrator: selection,
            planner: selection,
            worker: selection,
            verifier: selection,
            integrator: selection,
            visual: selection,
          },
        },
        stage: "review",
      },
    });
    const dependent = thread({
      id: ThreadId.make("implementation"),
      automation: {
        ...automation(),
        workflowId: coordinator.id,
        dependencies: [coordinator.id],
      },
    });

    expect(incompleteAutomationDependencies(dependent, [coordinator, dependent])).toEqual([]);
  });

  it("identifies scope conflicts only against active work", () => {
    const active = thread({
      id: ThreadId.make("active-scope"),
      automation: {
        ...automation(),
        stage: "running",
        changeScopes: ["apps/web/src/components"],
      },
    });
    const queued = thread({
      id: ThreadId.make("queued-scope"),
      automation: {
        ...automation(),
        changeScopes: ["apps/web/src/components/kanban/**"],
      },
    });
    expect(automationConflictBlockers(queued, [active, queued])).toEqual([active]);
    expect(
      automationConflictBlockers(
        { ...queued, automation: { ...queued.automation!, stage: "planned" } },
        [active],
      ),
    ).toEqual([]);

    const global = {
      ...queued,
      id: ThreadId.make("global-scope"),
      automation: { ...queued.automation!, changeScopes: ["**/*"] },
    };
    const partialSegment = {
      ...queued,
      id: ThreadId.make("partial-segment-scope"),
      automation: {
        ...queued.automation!,
        changeScopes: ["apps/web/src/components/Kanban*.tsx"],
      },
    };
    const activeFile = {
      ...active,
      automation: {
        ...active.automation!,
        changeScopes: ["apps/web/src/components/KanbanBoard.tsx"],
      },
    };
    expect(automationConflictBlockers(global, [activeFile])).toEqual([activeFile]);
    expect(automationConflictBlockers(partialSegment, [activeFile])).toEqual([activeFile]);
  });

  it("builds dependency labels once for the complete project shell set", () => {
    const dependency = thread({
      id: ThreadId.make("label-dependency"),
      title: "Dependency",
      automation: { ...automation(), stage: "running" },
    });
    const dependent = thread({
      id: ThreadId.make("label-dependent"),
      automation: {
        ...automation(),
        stage: "ready",
        dependencies: [dependency.id],
      },
    });

    expect(kanbanStateLabelsByThreadId([dependency, dependent]).get(dependent.id)).toBe(
      "Blocked by 1 task",
    );

    const missingDependency = {
      ...dependent,
      id: ThreadId.make("label-missing-dependency"),
      automation: {
        ...dependent.automation!,
        dependencies: [ThreadId.make("not-in-current-shell-set")],
      },
    };
    expect(kanbanStateLabelsByThreadId([missingDependency]).get(missingDependency.id)).toBe(
      "Queued",
    );
  });

  it("keeps live and waiting threads in Running", () => {
    const live = thread({
      id: ThreadId.make("live"),
      session: {
        threadId: ThreadId.make("live"),
        status: "running",
        providerName: "Codex",
        runtimeMode: "full-access",
        activeTurnId: null,
        lastError: null,
        updatedAt: NOW,
      },
    });
    const waiting = thread({ id: ThreadId.make("waiting"), hasPendingUserInput: true });

    expect(classifyKanbanThread(live, NOW)).toBe("running");
    expect(classifyKanbanThread(waiting, NOW)).toBe("running");
    expect(describeKanbanThreadState(waiting)).toBe("Needs input");
  });

  it("uses durable settlement for Complete and archive state for History", () => {
    const complete = thread({
      id: ThreadId.make("complete"),
      settledOverride: "settled",
      settledAt: NOW,
    });
    const archived = thread({ id: ThreadId.make("archived"), archivedAt: NOW });

    expect(classifyKanbanThread(complete, NOW)).toBe("complete");
    expect(classifyKanbanThread(archived, NOW)).toBe("history");
  });

  it("puts stopped active work in Review and sorts each lane by recent activity", () => {
    const older = thread({ id: ThreadId.make("older"), updatedAt: "2026-08-03T08:30:00.000Z" });
    const newer = thread({ id: ThreadId.make("newer"), updatedAt: "2026-08-03T09:30:00.000Z" });

    const review = groupKanbanThreads([older, newer], NOW).find((lane) => lane.id === "review");
    expect(review?.threads.map((item) => item.id)).toEqual([newer.id, older.id]);
  });
});

describe("Kanban board summaries", () => {
  it("decodes a valid AI project plan and rejects dependency cycles", () => {
    const valid = {
      summary: "Ship the autonomous board in two safe slices.",
      tasks: [
        {
          key: "contracts",
          title: "Add contracts",
          goal: "Define the durable data model.",
          acceptanceCriteria: ["Contract tests pass"],
          dependsOn: [],
          changeScopes: ["packages/contracts/src/**"],
          role: "worker",
          model: "gpt-5.6-sol",
          reasoningEffort: "high",
          verification: ["vp test run packages/contracts/src/orchestration.test.ts"],
        },
        {
          key: "ui",
          title: "Build the board UI",
          goal: "Render the new workflow.",
          acceptanceCriteria: ["Focused UI tests pass"],
          dependsOn: ["contracts"],
          changeScopes: ["apps/web/src/components/kanban/**"],
          role: "worker",
          model: "gpt-5.6-terra",
          reasoningEffort: "medium",
          verification: ["vp test run apps/web/src/components/kanban"],
        },
      ],
    };
    expect(
      parseAutomationPlan(`Plan ready.\n\`\`\`json\n${JSON.stringify(valid)}\n\`\`\``),
    ).toEqual(valid);
    const cyclic = {
      ...valid,
      tasks: valid.tasks.map((task, index) => ({
        ...task,
        dependsOn: [valid.tasks[index === 0 ? 1 : 0]!.key],
      })),
    };
    expect(parseAutomationPlan(JSON.stringify(cyclic))).toBeNull();
  });

  it("caps Done without losing access to older completed work", () => {
    const completed = Array.from({ length: 6 }, (_, index) =>
      thread({ id: ThreadId.make(`done-${index}`), updatedAt: `2026-08-03T09:0${index}:00.000Z` }),
    );
    expect(capCompletedKanbanThreads(completed, 4)).toEqual({
      visible: completed.slice(0, 4),
      overflow: completed.slice(4),
    });
  });

  it("summarizes the latest checkpoint", () => {
    expect(
      latestCheckpointSummary([
        { files: [{ path: "old.ts", additions: 1, deletions: 1 }] },
        {
          files: [
            { path: "board.tsx", additions: 40, deletions: 2 },
            { path: "board.test.ts", additions: 18, deletions: 0 },
          ],
        },
      ]),
    ).toEqual({ files: 2, additions: 58, deletions: 2 });
  });

  it("keeps the latest meaningful changes when verification changes no files", () => {
    expect(
      latestCheckpointSummary([
        { files: [{ path: "utility.ts", additions: 12, deletions: 1 }] },
        { files: [] },
      ]),
    ).toEqual({ files: 1, additions: 12, deletions: 1 });
  });

  it("uses the first non-empty user message as the task goal", () => {
    expect(
      firstUserGoal([
        { role: "system", text: "system" },
        { role: "user", text: "  Build the project board.  " },
        { role: "user", text: "Later follow-up" },
      ]),
    ).toBe("Build the project board.");
  });

  it("explains empty activity from durable lifecycle state", () => {
    expect(describeEmptyKanbanActivity({ ...automation(), stage: "cancelled" })).toBe(
      "Run cancelled. Earlier changes remain available below.",
    );
    expect(describeEmptyKanbanActivity({ ...automation(), stage: "ready" })).toBe(
      "Waiting for Autopilot to start this task.",
    );
    expect(describeEmptyKanbanActivity(undefined)).toBe("No activity has been recorded yet.");
  });

  it("uses distinct compact empty states for each lane", () => {
    expect(
      ["queue", "running", "attention", "review", "complete"].map((lane) =>
        compactKanbanLaneEmptyLabel(
          lane as "queue" | "running" | "attention" | "review" | "complete",
        ),
      ),
    ).toEqual([
      "No queued tasks",
      "No agents running",
      "No blockers",
      "Nothing awaiting review",
      "Nothing completed yet",
    ]);
  });

  it("orders inspector information around the task's current decision", () => {
    expect(kanbanInspectorSectionOrder("running", "implementation")).toEqual([
      "activity",
      "run",
      "goal",
    ]);
    expect(kanbanInspectorSectionOrder("review", "planning")).toEqual([
      "plan",
      "run",
      "goal",
      "activity",
    ]);
    expect(kanbanInspectorSectionOrder("failed", "implementation")).toEqual([
      "run",
      "activity",
      "goal",
    ]);
    expect(kanbanInspectorSectionOrder("ready", "planning")).toEqual([
      "goal",
      "plan",
      "run",
      "activity",
    ]);
  });

  it("turns Git setup failures into clear recovery guidance", () => {
    expect(
      presentKanbanAutomationError(
        "GitCommandError: Git command failed in GitWorkflowService.createWorktree (D:/empty): Failed to resolve the VCS driver. { [cause]: No supported VCS repository was detected at D:/empty. at file:///server.mjs:1:1",
      ),
    ).toEqual({
      title: "Git is not set up for this project",
      detail: "Autopilot needs a Git repository so each task can work safely in isolation.",
      recovery: "Initialize Git, create the first commit, then retry the task.",
    });

    expect(
      presentKanbanAutomationError(
        "GitCommandError: git worktree add failed because HEAD does not have any commits yet at file:///server.mjs:1:1",
      ).title,
    ).toBe("Create the first commit before starting");
  });

  it("never exposes a server stack trace in the board", () => {
    const presentation = presentKanbanAutomationError(
      "GitCommandError: Git command failed in GitVcsDriver.createWorktree (D:/repo): git worktree add failed at file:///D:/FACT3/apps/server/dist/bin.mjs:32537:66",
    );
    expect(presentation.title).toBe("FACT3 could not create the task worktree");
    expect(presentation.detail).not.toContain("file:///");

    const genericPresentation = presentKanbanAutomationError(
      "Provider failed to start at AutomationReactor.dispatchRun (file:///D:/FACT3/apps/server/dist/bin.mjs:89129:11)",
    );
    expect(genericPresentation.detail).toBe("Provider failed to start");
  });
});
