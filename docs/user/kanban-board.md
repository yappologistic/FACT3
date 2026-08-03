# Kanban board

The project board gives you one place to follow several coding tasks that are running in separate
worktrees. It uses the same threads, checkpoints, and source-control state as Chat, so moving
between the two views does not create a second copy of the work.

Select **Board** in the project header to open it. Select **Chat** to return to the current
conversation.

## Start parallel work

Select **New worktree** to prepare an isolated thread from the project's default branch. Describe
the task in Chat and send the message to create the worktree and start the agent. Repeat this for
work that can safely run in parallel.

The board groups work by its real lifecycle:

- **Running** contains agents that are starting, working, or waiting for your input or approval.
- **Review** contains stopped work that is ready for you to inspect.
- **Complete** contains work that you have explicitly marked complete.

These states are not drag-and-drop labels. They follow the underlying agent and thread state so the
board cannot imply that work is running or finished when it is not.

## Review a task

Select a card to open its detail panel. The panel shows the original goal, current plan or recent
activity, changed files, and source-control status. From there you can open the diff, return to the
full chat, or use the existing commit, push, and pull-request controls for that worktree.

When the work is accepted, select **Mark complete**. You can reopen a completed task if more work is
needed.

## History

Select **History** to inspect archived project work. Archived threads load only when you open this
view. Select a historical card to inspect it, then use **Restore** if it should return to the active
project.
