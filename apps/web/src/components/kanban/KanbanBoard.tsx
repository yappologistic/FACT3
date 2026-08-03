import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import {
  ArchiveRestoreIcon,
  BotIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  FileCode2Icon,
  GitBranchIcon,
  HistoryIcon,
  MessageSquareTextIcon,
  PanelsTopLeftIcon,
  RotateCcwIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import { useThreadActions } from "~/hooks/useThreadActions";
import { cn } from "~/lib/utils";
import { useEnvironmentQuery } from "~/state/query";
import { useThread } from "~/state/entities";
import { vcsEnvironment } from "~/state/vcs";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import GitActionsControl from "~/components/GitActionsControl";
import {
  deriveComposerActivityDetails,
  deriveLatestComposerActivityTurnId,
} from "~/components/chat/composerActivityDetails";
import { deriveActivePlanState } from "~/session-logic";
import {
  classifyKanbanThread,
  describeKanbanThreadState,
  firstUserGoal,
  groupKanbanThreads,
  latestCheckpointSummary,
  sortKanbanThreads,
  type KanbanActiveLane,
} from "./KanbanBoard.logic";
import { OpenTuiSpinner } from "./OpenTuiSpinner";
import { formatRelativeTimeLabel } from "~/timestampFormat";

const LANE_COPY: Record<
  KanbanActiveLane,
  { readonly label: string; readonly description: string }
> = {
  running: {
    label: "Running",
    description: "Agents working now or waiting for your response.",
  },
  review: {
    label: "Review",
    description: "Work has stopped and is ready to inspect.",
  },
  complete: {
    label: "Complete",
    description: "Work you have explicitly marked complete.",
  },
};

function kanbanThreadKey(thread: Pick<EnvironmentThreadShell, "environmentId" | "id">): string {
  return scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id));
}

function compactModelLabel(model: string): string {
  return model
    .replace(/^openai\//i, "")
    .replace(/^codex[-/]/i, "")
    .replace(/^gpt-/i, "GPT-")
    .replace(/-(sol|terra|luna)$/i, (_, family: string) => {
      return `-${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`;
    });
}

function CardStateIcon(props: {
  readonly lane: KanbanActiveLane | "history";
  readonly stateLabel: string;
}) {
  if (props.lane === "running") {
    return <OpenTuiSpinner name="dots" className="text-primary" label={props.stateLabel} />;
  }
  if (props.lane === "complete") {
    return <CheckCircle2Icon aria-hidden className="size-3.5 text-success" />;
  }
  if (props.lane === "history") {
    return <HistoryIcon aria-hidden className="size-3.5 text-muted-foreground" />;
  }
  return <CircleIcon aria-hidden className="size-3.5 text-muted-foreground/70" />;
}

const KanbanCard = memo(function KanbanCard(props: {
  readonly thread: EnvironmentThreadShell;
  readonly lane: KanbanActiveLane | "history";
  readonly selected: boolean;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const stateLabel = describeKanbanThreadState(props.thread);
  const quietStateLabel =
    props.lane === "complete"
      ? `Updated ${formatRelativeTimeLabel(props.thread.updatedAt)}`
      : props.lane === "history"
        ? `Archived ${formatRelativeTimeLabel(props.thread.archivedAt ?? props.thread.updatedAt)}`
        : stateLabel;
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={() => props.onSelect(props.thread)}
      className={cn(
        "group w-full rounded-[18px] border bg-card/62 p-3.5 text-left shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]",
        "transition-[border-color,background-color,transform,box-shadow] duration-150 ease-out",
        "hover:-translate-y-px hover:border-foreground/16 hover:bg-card/86 hover:shadow-sm",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        props.selected
          ? "border-primary/70 bg-primary/[0.055] shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_24%,transparent)]"
          : "border-foreground/[0.075]",
      )}
    >
      <span className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.07] bg-foreground/[0.035] text-muted-foreground",
            props.lane === "running" && "text-primary",
          )}
        >
          <BotIcon aria-hidden className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-start gap-2">
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground/92">
              {props.thread.title}
            </span>
            <ChevronRightIcon
              aria-hidden
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/35 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/70"
            />
          </span>
          <span className="mt-1 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground/72">
            <GitBranchIcon aria-hidden className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{props.thread.branch ?? "No branch"}</span>
          </span>
        </span>
      </span>
      <span className="mt-3 flex items-center justify-between gap-3 border-t border-foreground/[0.055] pt-2.5">
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          <CardStateIcon lane={props.lane} stateLabel={stateLabel} />
          <span className="truncate">{quietStateLabel}</span>
        </span>
        <span className="max-w-[46%] truncate rounded-full border border-foreground/[0.07] bg-foreground/[0.035] px-2 py-0.5 text-[10px] text-muted-foreground/80">
          {compactModelLabel(props.thread.modelSelection.model)}
        </span>
      </span>
    </button>
  );
});

function LaneEmptyState({ lane }: { readonly lane: KanbanActiveLane }) {
  const copy = LANE_COPY[lane];
  return (
    <div className="flex min-h-40 flex-col items-center justify-center px-6 text-center">
      <CheckCircle2Icon aria-hidden className="mb-2 size-4 text-muted-foreground/35" />
      <p className="text-xs font-medium text-foreground/70">
        Nothing in {copy.label.toLowerCase()}
      </p>
      <p className="mt-1 max-w-48 text-[11px] leading-4 text-muted-foreground/60">
        {copy.description}
      </p>
    </div>
  );
}

const KanbanLaneColumn = memo(function KanbanLaneColumn(props: {
  readonly lane: KanbanActiveLane;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly selectedKey: string | null;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const copy = LANE_COPY[props.lane];
  return (
    <section
      aria-labelledby={`kanban-${props.lane}-heading`}
      className="flex min-h-0 min-w-[17rem] flex-1 flex-col rounded-[20px] border border-foreground/[0.055] bg-foreground/[0.018] p-2.5"
    >
      <header className="mb-2.5 flex items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-2">
          <h2
            id={`kanban-${props.lane}-heading`}
            className="text-xs font-medium text-foreground/88"
          >
            {copy.label}
          </h2>
          <span className="rounded-md bg-foreground/[0.055] px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
            {props.threads.length}
          </span>
        </div>
        <span className="sr-only">{copy.description}</span>
      </header>
      <ScrollArea className="min-h-0 flex-1 pr-1.5">
        <div className="space-y-2.5 pb-4">
          {props.threads.length === 0 ? (
            <LaneEmptyState lane={props.lane} />
          ) : (
            props.threads.map((thread) => (
              <KanbanCard
                key={kanbanThreadKey(thread)}
                thread={thread}
                lane={props.lane}
                selected={props.selectedKey === kanbanThreadKey(thread)}
                onSelect={props.onSelect}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </section>
  );
});

function StatusDot({
  status,
}: {
  readonly status: "completed" | "running" | "pending" | "failed" | "stopped";
}) {
  if (status === "running") {
    return <OpenTuiSpinner name="dots" className="text-primary" />;
  }
  if (status === "completed") {
    return <CheckCircle2Icon aria-hidden className="size-3.5 text-success" />;
  }
  return (
    <CircleIcon
      aria-hidden
      className={cn(
        "size-3.5",
        status === "failed" ? "text-destructive" : "text-muted-foreground/55",
      )}
    />
  );
}

function KanbanInspector(props: {
  readonly threadShell: EnvironmentThreadShell;
  readonly lane: KanbanActiveLane | "history";
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenDiff: (thread: EnvironmentThreadShell, scope: "branch" | "unstaged") => void;
  readonly onClose: () => void;
}) {
  const threadRef = useMemo(
    () => scopeThreadRef(props.threadShell.environmentId, props.threadShell.id),
    [props.threadShell.environmentId, props.threadShell.id],
  );
  const thread = useThread(threadRef);
  const { settleThread, unsettleThread, unarchiveThread } = useThreadActions();
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const gitCwd = thread?.worktreePath ?? props.threadShell.worktreePath;
  const gitStatus = useEnvironmentQuery(
    gitCwd
      ? vcsEnvironment.status({
          environmentId: props.threadShell.environmentId,
          input: { cwd: gitCwd },
        })
      : null,
  );
  const activityTurnId = useMemo(
    () => deriveLatestComposerActivityTurnId(thread?.activities ?? []),
    [thread?.activities],
  );
  const activePlan = useMemo(
    () => deriveActivePlanState(thread?.activities ?? [], activityTurnId ?? undefined),
    [activityTurnId, thread?.activities],
  );
  const details = useMemo(
    () => deriveComposerActivityDetails(thread?.activities ?? [], activityTurnId, activePlan),
    [activePlan, activityTurnId, thread?.activities],
  );
  const checkpoint = useMemo(
    () => latestCheckpointSummary(thread?.checkpoints ?? []),
    [thread?.checkpoints],
  );
  const goal = useMemo(() => firstUserGoal(thread?.messages ?? []), [thread?.messages]);
  const workingFiles = gitStatus.data?.workingTree.files ?? [];
  const checkpointFiles = thread?.checkpoints.at(-1)?.files ?? [];
  const visibleFiles = useMemo(
    () =>
      workingFiles.length > 0
        ? workingFiles.map((file) => ({
            path: file.path,
            insertions: file.insertions,
            deletions: file.deletions,
          }))
        : checkpointFiles.map((file) => ({
            path: file.path,
            insertions: file.additions,
            deletions: file.deletions,
          })),
    [checkpointFiles, workingFiles],
  );

  const runLifecycleAction = useCallback(async () => {
    setLifecyclePending(true);
    const result =
      props.lane === "history"
        ? await unarchiveThread(threadRef)
        : props.lane === "complete"
          ? await unsettleThread(threadRef)
          : await settleThread(threadRef);
    setLifecyclePending(false);
    if (result._tag === "Failure") {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not update work status",
          description: "Resolve any live approval, input, or running agent first, then try again.",
          data: { threadRef },
        }),
      );
    }
  }, [props.lane, settleThread, threadRef, unarchiveThread, unsettleThread]);

  const lifecycleAction =
    props.lane === "history"
      ? { label: "Restore", Icon: ArchiveRestoreIcon }
      : props.lane === "complete"
        ? { label: "Reopen", Icon: RotateCcwIcon }
        : { label: "Mark complete", Icon: CheckCircle2Icon };

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex min-h-0 w-[min(22rem,calc(100%-1rem))] shrink-0 animate-in flex-col border-l border-foreground/[0.07] bg-background/96 shadow-[-16px_0_40px_rgba(0,0,0,0.16)] backdrop-blur-xl duration-200 slide-in-from-right-2 min-[1440px]:static min-[1440px]:w-[22rem] min-[1440px]:bg-background/72 min-[1440px]:shadow-none">
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-5 p-5">
          <header>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5 text-foreground/92">
                  {props.threadShell.title}
                </p>
                <div className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                  <GitBranchIcon aria-hidden className="size-3 shrink-0" />
                  <span className="truncate">{props.threadShell.branch ?? "No branch"}</span>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <span className="rounded-full border border-foreground/[0.07] bg-foreground/[0.035] px-2 py-1 text-[10px] text-muted-foreground">
                  {compactModelLabel(props.threadShell.modelSelection.model)}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  aria-label="Close task details"
                  onClick={props.onClose}
                >
                  <XIcon aria-hidden className="size-3.5" />
                </Button>
              </div>
            </div>
          </header>

          <section
            aria-labelledby="kanban-goal-heading"
            className="border-t border-foreground/[0.07] pt-4"
          >
            <h3 id="kanban-goal-heading" className="text-[11px] font-medium text-foreground/82">
              Goal
            </h3>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">
              {goal ?? "Open the task to add a clear implementation goal."}
            </p>
          </section>

          <section
            aria-labelledby="kanban-progress-heading"
            className="border-t border-foreground/[0.07] pt-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="kanban-progress-heading"
                className="text-[11px] font-medium text-foreground/82"
              >
                Progress
              </h3>
              {details.tasks.length > 0 ? (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {details.tasks.filter((item) => item.status === "completed").length}/
                  {details.tasks.length}
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 space-y-2">
              {details.tasks.length > 0 ? (
                details.tasks.slice(0, 6).map((task) => (
                  <div
                    key={task.id}
                    className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground"
                  >
                    <StatusDot status={task.status} />
                    <span
                      className={cn(
                        "min-w-0 flex-1",
                        task.status === "completed" && "text-muted-foreground/65",
                      )}
                    >
                      {task.title}
                    </span>
                  </div>
                ))
              ) : details.tools.length > 0 ? (
                details.tools.slice(0, 4).map((tool) => (
                  <div
                    key={tool.id}
                    className="flex items-start gap-2 text-[11px] leading-4 text-muted-foreground"
                  >
                    <StatusDot status={tool.status} />
                    <span className="min-w-0 flex-1">{tool.title}</span>
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-muted-foreground/65">
                  No activity has been recorded yet.
                </p>
              )}
            </div>
          </section>

          <section
            aria-labelledby="kanban-changes-heading"
            className="border-t border-foreground/[0.07] pt-4"
          >
            <div className="flex items-center justify-between gap-3">
              <h3
                id="kanban-changes-heading"
                className="text-[11px] font-medium text-foreground/82"
              >
                Changes
              </h3>
              {checkpoint ? (
                <span className="text-[10px] tabular-nums text-muted-foreground">
                  {checkpoint.files} {checkpoint.files === 1 ? "file" : "files"}
                </span>
              ) : null}
            </div>
            <div className="mt-2.5 space-y-2">
              {visibleFiles.length > 0 ? (
                visibleFiles.slice(0, 6).map((file) => (
                  <div key={file.path} className="flex items-center gap-2 text-[11px]">
                    <FileCode2Icon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground/60"
                    />
                    <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground/82">
                      {file.path}
                    </span>
                    {file.insertions === 0 && file.deletions === 0 ? (
                      <span className="shrink-0 text-[10px] text-muted-foreground/65">Changed</span>
                    ) : (
                      <span className="shrink-0 font-mono tabular-nums">
                        <span className="text-success">+{file.insertions}</span>{" "}
                        <span className="text-destructive">-{file.deletions}</span>
                      </span>
                    )}
                  </div>
                ))
              ) : (
                <p className="text-[11px] text-muted-foreground/65">
                  No changed files in the latest checkpoint.
                </p>
              )}
            </div>
          </section>

          <section
            aria-labelledby="kanban-source-control-heading"
            className="border-t border-foreground/[0.07] pt-4"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3
                  id="kanban-source-control-heading"
                  className="text-[11px] font-medium text-foreground/82"
                >
                  Source control
                </h3>
                <p className="mt-1 text-[10px] text-muted-foreground/65">
                  {gitStatus.data?.pr?.state === "open"
                    ? `Pull request #${gitStatus.data.pr.number} is open`
                    : gitStatus.data?.hasWorkingTreeChanges
                      ? "Uncommitted changes"
                      : gitStatus.data?.aheadCount
                        ? `${gitStatus.data.aheadCount} commit${gitStatus.data.aheadCount === 1 ? "" : "s"} ahead`
                        : "Worktree is up to date"}
                </p>
              </div>
              <div className="w-fit shrink-0">
                <GitActionsControl gitCwd={gitCwd} activeThreadRef={threadRef} />
              </div>
            </div>
          </section>
        </div>
      </ScrollArea>

      <div className="grid grid-cols-2 gap-2 border-t border-foreground/[0.07] p-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            props.onOpenDiff(
              props.threadShell,
              gitStatus.data?.hasWorkingTreeChanges ? "unstaged" : "branch",
            )
          }
        >
          <PanelsTopLeftIcon aria-hidden className="size-3.5" />
          Open diff
        </Button>
        <Button variant="outline" size="sm" onClick={() => props.onOpenThread(props.threadShell)}>
          <MessageSquareTextIcon aria-hidden className="size-3.5" />
          Open chat
        </Button>
        <Button
          className="col-span-2"
          variant={props.lane === "review" ? "default" : "outline"}
          size="sm"
          disabled={lifecyclePending || props.lane === "running"}
          onClick={() => void runLifecycleAction()}
        >
          {lifecyclePending ? (
            <OpenTuiSpinner name="dots" />
          ) : (
            <lifecycleAction.Icon aria-hidden className="size-3.5" />
          )}
          {props.lane === "running" ? "Agent is still working" : lifecycleAction.label}
        </Button>
      </div>
    </aside>
  );
}

function HistoryBoard(props: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly loading: boolean;
  readonly error: string | null;
  readonly selectedKey: string | null;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
  readonly onRefresh: () => void;
}) {
  const threads = sortKanbanThreads(props.threads);
  return (
    <section className="min-h-0 min-w-0 flex-1 p-5">
      <div className="mx-auto flex h-full max-w-4xl flex-col">
        <header className="mb-4">
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground/90">
            <HistoryIcon aria-hidden className="size-4 text-muted-foreground" />
            Worktree history
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Archived work from this project. Restore a card to return it to Review.
          </p>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          {props.loading ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-[22px] border border-dashed border-foreground/[0.08] text-center">
              <OpenTuiSpinner
                name="dots"
                className="mb-3 text-primary"
                label="Loading archived worktrees"
              />
              <p className="text-xs font-medium text-foreground/72">Loading history</p>
            </div>
          ) : props.error ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-[22px] border border-dashed border-destructive/20 px-6 text-center">
              <HistoryIcon aria-hidden className="mb-3 size-5 text-destructive/55" />
              <p className="text-xs font-medium text-foreground/72">History could not be loaded</p>
              <p className="mt-1 max-w-sm text-[11px] leading-4 text-muted-foreground/60">
                {props.error}
              </p>
              <Button variant="outline" size="sm" className="mt-3" onClick={props.onRefresh}>
                <RefreshCwIcon aria-hidden className="size-3.5" />
                Try again
              </Button>
            </div>
          ) : threads.length === 0 ? (
            <div className="flex min-h-56 flex-col items-center justify-center rounded-[22px] border border-dashed border-foreground/[0.08] text-center">
              <HistoryIcon aria-hidden className="mb-3 size-5 text-muted-foreground/35" />
              <p className="text-xs font-medium text-foreground/72">No archived worktrees</p>
              <p className="mt-1 text-[11px] text-muted-foreground/60">
                Archived tasks will appear here without crowding the active board.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2.5 pb-5 md:grid-cols-2">
              {threads.map((thread) => (
                <KanbanCard
                  key={kanbanThreadKey(thread)}
                  thread={thread}
                  lane="history"
                  selected={props.selectedKey === kanbanThreadKey(thread)}
                  onSelect={props.onSelect}
                />
              ))}
            </div>
          )}
        </ScrollArea>
      </div>
    </section>
  );
}

export function KanbanBoard(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly archivedThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly archivedThreadsLoading: boolean;
  readonly archivedThreadsError: string | null;
  readonly onRefreshArchivedThreads: () => void;
  readonly historyOpen: boolean;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenDiff: (thread: EnvironmentThreadShell, scope: "branch" | "unstaged") => void;
}) {
  const now = useMemo(() => new Date().toISOString(), [props.threads, props.archivedThreads]);
  const lanes = useMemo(() => groupKanbanThreads(props.threads, now), [now, props.threads]);
  const visibleThreads = useMemo(
    () =>
      props.historyOpen
        ? sortKanbanThreads(props.archivedThreads)
        : lanes.flatMap((lane) => lane.threads),
    [lanes, props.archivedThreads, props.historyOpen],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selectedThread = selectedKey
    ? (visibleThreads.find((thread) => kanbanThreadKey(thread) === selectedKey) ?? null)
    : null;

  useEffect(() => {
    if (selectedKey && !selectedThread) {
      setSelectedKey(null);
    }
  }, [selectedKey, selectedThread]);

  const selectThread = useCallback((thread: EnvironmentThreadShell) => {
    setSelectedKey(kanbanThreadKey(thread));
  }, []);

  return (
    <div
      aria-label={`Worktrees for ${props.project.title}`}
      className="relative flex min-h-0 w-0 flex-1 overflow-hidden bg-background"
    >
      {props.historyOpen ? (
        <HistoryBoard
          threads={props.archivedThreads}
          loading={props.archivedThreadsLoading}
          error={props.archivedThreadsError}
          selectedKey={selectedKey}
          onSelect={selectThread}
          onRefresh={props.onRefreshArchivedThreads}
        />
      ) : (
        <div className="flex min-h-0 w-0 flex-1 gap-3 overflow-x-auto p-4 sm:p-5">
          {lanes.map((lane) => (
            <KanbanLaneColumn
              key={lane.id}
              lane={lane.id}
              threads={lane.threads}
              selectedKey={selectedKey}
              onSelect={selectThread}
            />
          ))}
        </div>
      )}

      {selectedThread ? (
        <KanbanInspector
          key={kanbanThreadKey(selectedThread)}
          threadShell={selectedThread}
          lane={classifyKanbanThread(selectedThread, now)}
          onOpenThread={props.onOpenThread}
          onOpenDiff={props.onOpenDiff}
          onClose={() => setSelectedKey(null)}
        />
      ) : null}
    </div>
  );
}
