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

## Run an autonomous workflow

Select **Autonomous workflow** to give FACT3 one larger outcome. Choose the base branch and the
orchestrator model, then decide whether FACT3 should stop at review checkpoints or continue through
verified integration automatically. Planning is read-only: the planner inspects the repository and
the orchestrator audits its dependency graph before any implementation work begins.

Starting a workflow turns on Autopilot, dedicated worktrees, and verification for the project. You
can still pause new dispatches from the board without interrupting agents that are already running.

Open **Customize agent roles** when different work needs different models. Planner, worker,
verifier, integrator, and visual-specialist roles inherit the orchestrator by default, including its
reasoning and speed options. An override changes only that role.

In review mode, approve the proposed plan before task work begins and approve the integrated result
before it reaches the base branch. In fully autonomous mode, FACT3 materializes the approved graph,
runs eligible tasks in parallel worktrees, verifies each result with the selected verifier, resolves
integration conflicts in a dedicated integration worktree, and fast-forwards the verified result to
the base branch when the primary checkout is clean and still on that branch. Unsafe repository state
always moves the workflow to **Needs attention** instead of overwriting local work.

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

Verification evidence lists the focused checks reported by the independent verifier. A successful
agent turn without valid evidence is retried within the task's attempt budget; it is not presented as
verified work.

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
