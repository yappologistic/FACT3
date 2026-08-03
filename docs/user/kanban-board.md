# Kanban board

The project board is a control surface for autonomous coding work. Each task is a real FACT3
thread with its own goal, acceptance criteria, model, source-control state, and optional isolated
worktree. Board and Chat show the same durable work, so you can move between overview and detail
without creating a second copy of anything.

Select **Board** in the project header to open it. Select **Chat** to return to the current
conversation.

## Configure Autopilot

Open **Autopilot settings** before starting a project workflow. The project policy controls:

- how many agents may run at the same time;
- whether each task gets a dedicated worktree;
- whether FACT3 runs a separate verification pass;
- whether verified work waits for human review;
- how many attempts and runtime minutes a task may use; and
- whether delivery stops at a local commit, pushes a branch, or opens a pull request.

Use **Start** and **Pause** in the board status bar to control scheduling. Pausing prevents queued
tasks from starting; it does not terminate agents that are already working.

## Create autonomous tasks

Select **New task**, then provide a clear goal and acceptance criteria. You can also select tasks
that must be approved first. FACT3 records those dependencies instead of relying on card order or
manual drag-and-drop.

The board follows the real lifecycle:

- **Queue** contains planned work and work waiting for a dependency or capacity slot.
- **Running** contains implementation and verification turns that are actively executing.
- **Needs attention** contains a failed run or an agent waiting for a decision or permission.
- **Review** contains verified work waiting for a human decision.
- **Done** contains approved or cancelled work that remains available for inspection.

Autopilot starts eligible queued tasks up to the configured concurrency limit. A dependent task
does not start merely because its prerequisite agent stopped; it starts only after the prerequisite
is approved.

## Inspect and review work

Select a card to open its detail panel. The panel shows the goal, acceptance criteria, attempt and
verification state, recent activity, changed files, worktree, branch, and pull request when one is
available. From there you can open the full diff or Chat for the task.

Select **Approve** to accept verified work. Select **Request changes** to attach precise feedback
and return the task to the queue for another autonomous attempt. Failed tasks can be retried while
attempts remain, running tasks can be cancelled, and completed tasks can be reopened.

## History

Select **History** to inspect archived project work. Archived threads load only when you open this
view. Select a historical card to inspect it, then use **Restore** if it should return to the active
project.
