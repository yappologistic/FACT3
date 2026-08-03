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
- how many attempts and runtime minutes a task may use;
- how long a running agent may remain silent before FACT3 stops it as stalled; and
- whether delivery stops at a local commit, pushes a branch, or opens a pull request.

Use **Start** and **Pause** in the board status bar to control scheduling. Pausing prevents queued
tasks from starting; it does not terminate agents that are already working.

## Plan a project goal

Select **Plan project** to give FACT3 one larger outcome. A planning agent inspects the repository
without editing it, then proposes a small execution graph. The proposal includes task ownership,
dependencies, likely paths, model and reasoning assignments, acceptance criteria, and verification
checks.

Review the proposal from its card. **Approve plan & start** creates the real task threads and turns
on Autopilot. **Request changes** sends feedback back through the planning task without starting
implementation.

## Create autonomous tasks

Select **New task**, then provide a clear goal and acceptance criteria. You can also select tasks
that must be approved first. Choose the provider, model, reasoning level, and speed for that task;
these choices do not change the project or chat defaults. FACT3 records dependencies instead of
relying on card order or manual drag-and-drop. Add likely paths when you know them. Autopilot will
not start two tasks with overlapping path ownership at the same time, even when concurrency is
available.

Autonomous tasks require a Git repository with at least one commit. When dedicated worktrees are
enabled, the selected base branch must also exist. If setup is incomplete, the task moves to
**Needs attention** with a short explanation and a recovery step instead of a raw command error.

The board follows the real lifecycle:

- **Queue** contains planned work and work waiting for a dependency or capacity slot.
- **Running** contains implementation and verification turns that are actively executing.
- **Needs attention** contains a failed run or an agent waiting for a decision or permission.
- **Review** contains verified work waiting for a human decision.
- **Done** contains approved or cancelled work that remains available for inspection.

Autopilot starts eligible queued tasks up to the configured concurrency limit. A dependent task
does not start merely because its prerequisite agent stopped; it starts only after the prerequisite
is approved. A running agent that produces no activity for the configured stall window is stopped
and moved to **Needs attention** with the reason preserved for review or retry.

## Inspect and review work

Select a card to open its detail panel. The panel shows the goal, acceptance criteria, attempt and
verification state, recent activity, changed files, worktree, branch, and pull request when one is
available. From there you can open the full diff or Chat for the task.

Select the **Changes** heading or **Open diff** to inspect the complete task diff directly.

The review footer presents one primary action at a time. Delivery must be complete before
**Approve task** appears; otherwise the source-control action is shown instead. Select **Request
changes** to attach precise feedback and return the task to the queue for another autonomous
attempt. Failed tasks can be retried while attempts remain, running tasks can be cancelled, and
completed tasks can be reopened.

## History

The active board keeps the four most recent Done cards visible. Older completed work moves into the
History view alongside archived threads, so completion evidence remains available without widening
the working board. Select a historical card to inspect it, then use **Restore** for archived work or
**Reopen** for completed work that needs another pass.
