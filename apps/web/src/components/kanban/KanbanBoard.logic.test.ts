import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyKanbanThread,
  describeEmptyKanbanActivity,
  describeKanbanThreadState,
  firstUserGoal,
  groupKanbanThreads,
  incompleteAutomationDependencies,
  latestCheckpointSummary,
  liveKanbanAutomation,
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
    goal: "Ship the board",
    acceptanceCriteria: [],
    dependencies: [],
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
    verification: { status: "pending", summary: null, completedAt: null },
    startedAt: null,
    completedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

describe("Kanban board lifecycle", () => {
  it("prefers the live shell automation over a stale cached detail", () => {
    const stale = {
      goal: "Ship the board",
      acceptanceCriteria: [],
      dependencies: [],
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
      verification: { status: "running" as const, summary: null, completedAt: null },
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
        completedAt: NOW,
      },
    };

    expect(liveKanbanAutomation({ automation: live }, { automation: stale })).toBe(live);
  });

  it("maps durable automation stages to purposeful board lanes", () => {
    const automation = {
      goal: "Ship the board",
      acceptanceCriteria: [],
      dependencies: [],
      baseBranch: "main",
      phase: "implementation" as const,
      attempt: 0,
      maxAttempts: 2,
      maxRuntimeMinutes: 60,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      lastError: null,
      feedback: null,
      verification: { status: "pending" as const, summary: null, completedAt: null },
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

  it("keeps a queued task blocked until all configured dependencies complete", () => {
    const dependency = thread({
      id: ThreadId.make("dependency"),
      automation: {
        goal: "Build dependency",
        acceptanceCriteria: [],
        dependencies: [],
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
        verification: { status: "pending", summary: null, completedAt: null },
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
});
