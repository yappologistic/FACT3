import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";

import {
  classifyKanbanThread,
  describeKanbanThreadState,
  firstUserGoal,
  groupKanbanThreads,
  latestCheckpointSummary,
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

describe("Kanban board lifecycle", () => {
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

  it("uses the first non-empty user message as the task goal", () => {
    expect(
      firstUserGoal([
        { role: "system", text: "system" },
        { role: "user", text: "  Build the project board.  " },
        { role: "user", text: "Later follow-up" },
      ]),
    ).toBe("Build the project board.");
  });
});
