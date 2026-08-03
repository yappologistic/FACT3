import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ModelSelection, OrchestrationAutomationStage } from "@t3tools/contracts";
import {
  AlertTriangleIcon,
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
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  ShieldCheckIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import GitActionsControl from "~/components/GitActionsControl";
import {
  deriveComposerActivityDetails,
  deriveLatestComposerActivityTurnId,
} from "~/components/chat/composerActivityDetails";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useThreadActions } from "~/hooks/useThreadActions";
import { cn } from "~/lib/utils";
import { deriveActivePlanState } from "~/session-logic";
import { useThread } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  DEFAULT_AUTOMATION_POLICY,
  KanbanAutomationSettingsDialog,
  KanbanNewTaskDialog,
} from "./KanbanAutomationDialogs";
import {
  classifyKanbanThread,
  describeKanbanThreadState,
  describeEmptyKanbanActivity,
  firstUserGoal,
  groupKanbanThreads,
  incompleteAutomationDependencies,
  latestCheckpointSummary,
  liveKanbanAutomation,
  sortKanbanThreads,
  type KanbanActiveLane,
} from "./KanbanBoard.logic";
import { OpenTuiSpinner } from "./OpenTuiSpinner";

const LANE_COPY: Record<
  KanbanActiveLane,
  { readonly label: string; readonly description: string }
> = {
  queue: {
    label: "Queue",
    description: "Ready work starts when dependencies and capacity allow.",
  },
  running: {
    label: "Running",
    description: "Agents are implementing or verifying these tasks.",
  },
  attention: {
    label: "Needs attention",
    description: "A decision, permission, or retry is required.",
  },
  review: {
    label: "Review",
    description: "Verified work is waiting for a human decision.",
  },
  complete: {
    label: "Done",
    description: "Approved and cancelled work remains available for inspection.",
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

function stateLabelForThread(
  thread: EnvironmentThreadShell,
  allThreads: ReadonlyArray<EnvironmentThreadShell>,
): string {
  const blocked = incompleteAutomationDependencies(thread, allThreads);
  if (thread.automation?.stage === "ready" && blocked.length > 0) {
    return `Blocked by ${blocked.length} ${blocked.length === 1 ? "task" : "tasks"}`;
  }
  return describeKanbanThreadState(thread);
}

function CardStateIcon(props: {
  readonly thread: EnvironmentThreadShell;
  readonly lane: KanbanActiveLane | "history";
  readonly stateLabel: string;
}) {
  if (props.lane === "running") {
    return <OpenTuiSpinner name="dots" className="text-primary" label={props.stateLabel} />;
  }
  if (props.lane === "attention") {
    return <AlertTriangleIcon aria-hidden className="size-3.5 text-warning" />;
  }
  if (props.lane === "complete") {
    return props.thread.automation?.stage === "cancelled" ? (
      <XCircleIcon aria-hidden className="size-3.5 text-muted-foreground" />
    ) : (
      <CheckCircle2Icon aria-hidden className="size-3.5 text-success" />
    );
  }
  if (props.lane === "review") {
    return <ShieldCheckIcon aria-hidden className="size-3.5 text-success" />;
  }
  if (props.lane === "history") {
    return <HistoryIcon aria-hidden className="size-3.5 text-muted-foreground" />;
  }
  return <CircleIcon aria-hidden className="size-3.5 text-muted-foreground/70" />;
}

const KanbanCard = memo(function KanbanCard(props: {
  readonly thread: EnvironmentThreadShell;
  readonly allThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly lane: KanbanActiveLane | "history";
  readonly selected: boolean;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const stateLabel = stateLabelForThread(props.thread, props.allThreads);
  const quietStateLabel =
    props.lane === "history"
      ? `Archived ${formatRelativeTimeLabel(props.thread.archivedAt ?? props.thread.updatedAt)}`
      : props.lane === "complete" && props.thread.automation?.stage !== "cancelled"
        ? `Completed ${formatRelativeTimeLabel(
            props.thread.automation?.completedAt ?? props.thread.updatedAt,
          )}`
        : stateLabel;
  return (
    <button
      type="button"
      aria-pressed={props.selected}
      onClick={() => props.onSelect(props.thread)}
      className={cn(
        "group w-full rounded-[18px] border bg-card/62 p-3.5 text-left shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]",
        "transition-[border-color,background-color,transform,box-shadow] duration-150 ease-out motion-reduce:transform-none motion-reduce:transition-none",
        "hover:-translate-y-px hover:border-foreground/16 hover:bg-card/86 hover:shadow-sm",
        "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        props.selected
          ? "border-primary/70 bg-primary/[0.055] shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_24%,transparent)]"
          : props.lane === "attention"
            ? "border-warning/20"
            : "border-foreground/[0.075]",
      )}
    >
      <span className="flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-[10px] border border-foreground/[0.07] bg-foreground/[0.035] text-muted-foreground",
            props.lane === "running" && "text-primary",
            props.lane === "attention" && "text-warning",
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
              className="mt-0.5 size-3.5 shrink-0 text-muted-foreground/35 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/70 motion-reduce:transition-none"
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
          <CardStateIcon thread={props.thread} lane={props.lane} stateLabel={stateLabel} />
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
  readonly allThreads: ReadonlyArray<EnvironmentThreadShell>;
  readonly selectedKey: string | null;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
}) {
  const copy = LANE_COPY[props.lane];
  return (
    <section
      aria-labelledby={`kanban-${props.lane}-heading`}
      className="flex min-h-0 min-w-[16.5rem] flex-1 flex-col rounded-[20px] border border-foreground/[0.055] bg-foreground/[0.018] p-2.5"
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
                allThreads={props.allThreads}
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
  if (status === "running") return <OpenTuiSpinner name="dots" className="text-primary" />;
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

function RequestChangesDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly pending: boolean;
  readonly onSubmit: (feedback: string) => void;
}) {
  const [feedback, setFeedback] = useState("");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">Request changes</DialogTitle>
          <DialogDescription>
            The task returns to the queue with this feedback attached to its next implementation
            pass.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Textarea
            value={feedback}
            onChange={(event) => setFeedback(event.target.value)}
            placeholder="Describe the exact correction and how you will judge it."
            className="min-h-28"
            autoFocus
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => props.onSubmit(feedback.trim())}
            disabled={feedback.trim().length === 0 || props.pending}
          >
            {props.pending ? <OpenTuiSpinner name="dots" /> : null}
            Requeue task
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function KanbanInspector(props: {
  readonly threadShell: EnvironmentThreadShell;
  readonly allThreads: ReadonlyArray<EnvironmentThreadShell>;
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
  const transitionAutomation = useAtomCommand(threadEnvironment.transitionAutomation, {
    reportFailure: false,
  });
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const automation = liveKanbanAutomation(props.threadShell, thread);
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
  const goal = automation?.goal ?? firstUserGoal(thread?.messages ?? []);
  const blockedDependencies = incompleteAutomationDependencies(props.threadShell, props.allThreads);
  const dependencyById = useMemo(
    () => new Map(props.allThreads.map((candidate) => [candidate.id, candidate])),
    [props.allThreads],
  );
  const workingFiles = gitStatus.data?.workingTree.files ?? [];
  const checkpointFiles = useMemo(
    () =>
      thread?.checkpoints.toReversed().find((candidate) => candidate.files.length > 0)?.files ??
      thread?.checkpoints.at(-1)?.files ??
      [],
    [thread?.checkpoints],
  );
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

  const showLifecycleError = () =>
    toastManager.add(
      stackedThreadToast({
        type: "error",
        title: "Could not update task",
        description: "The task changed before this action completed. Review its latest state.",
        data: { threadRef },
      }),
    );

  const transition = useCallback(
    async (
      stage: OrchestrationAutomationStage,
      extra: Partial<{
        phase: "implementation" | "verification";
        feedback: string | null;
        completedAt: string | null;
        lastError: string | null;
        verification: NonNullable<EnvironmentThreadShell["automation"]>["verification"];
      }> = {},
    ) => {
      if (!automation) return false;
      setLifecyclePending(true);
      const result = await transitionAutomation({
        environmentId: props.threadShell.environmentId,
        input: {
          threadId: props.threadShell.id,
          expectedStage: automation.stage,
          stage,
          ...extra,
        },
      });
      setLifecyclePending(false);
      if (result._tag === "Failure") {
        showLifecycleError();
        return false;
      }
      return true;
    },
    [automation, props.threadShell.environmentId, props.threadShell.id, transitionAutomation],
  );

  const runLegacyLifecycleAction = useCallback(async () => {
    setLifecyclePending(true);
    const result =
      props.lane === "history"
        ? await unarchiveThread(threadRef)
        : props.lane === "complete"
          ? await unsettleThread(threadRef)
          : await settleThread(threadRef);
    setLifecyclePending(false);
    if (result._tag === "Failure") showLifecycleError();
  }, [props.lane, settleThread, threadRef, unarchiveThread, unsettleThread]);

  const primaryAction = automation
    ? automation.stage === "planned"
      ? { label: "Queue task", Icon: PlayIcon, run: () => transition("ready") }
      : automation.stage === "needs-input"
        ? {
            label: "Open chat",
            Icon: MessageSquareTextIcon,
            run: async () => props.onOpenThread(props.threadShell),
          }
        : automation.stage === "review"
          ? {
              label: "Approve",
              Icon: CheckCircle2Icon,
              run: () => transition("complete", { completedAt: new Date().toISOString() }),
            }
          : automation.stage === "failed"
            ? {
                label: "Retry",
                Icon: RotateCcwIcon,
                run: () => transition("ready", { lastError: null, completedAt: null }),
              }
            : automation.stage === "complete" || automation.stage === "cancelled"
              ? {
                  label: "Reopen",
                  Icon: RotateCcwIcon,
                  run: () =>
                    transition("ready", {
                      phase: "implementation",
                      feedback: null,
                      completedAt: null,
                      lastError: null,
                      verification: {
                        status: "pending",
                        summary: null,
                        completedAt: null,
                      },
                    }),
                }
              : null
    : null;

  const legacyAction =
    props.lane === "history"
      ? { label: "Restore", Icon: ArchiveRestoreIcon }
      : props.lane === "complete"
        ? { label: "Reopen", Icon: RotateCcwIcon }
        : { label: "Mark complete", Icon: CheckCircle2Icon };

  return (
    <>
      <aside className="absolute inset-y-0 right-0 z-30 flex min-h-0 w-[min(23rem,calc(100%-1rem))] shrink-0 animate-in flex-col border-l border-foreground/[0.07] bg-background/96 shadow-[-16px_0_40px_rgba(0,0,0,0.16)] backdrop-blur-xl duration-200 slide-in-from-right-2 motion-reduce:animate-none min-[1600px]:static min-[1600px]:w-[23rem] min-[1600px]:bg-background/72 min-[1600px]:shadow-none">
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
              {automation && automation.acceptanceCriteria.length > 0 ? (
                <ul className="mt-2.5 space-y-1.5">
                  {automation.acceptanceCriteria.map((criterion) => (
                    <li
                      key={criterion}
                      className="flex gap-2 text-[11px] leading-4 text-muted-foreground/82"
                    >
                      <CircleIcon aria-hidden className="mt-1 size-2 shrink-0" />
                      <span>{criterion}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </section>

            {automation ? (
              <section
                aria-labelledby="kanban-run-heading"
                className="border-t border-foreground/[0.07] pt-4"
              >
                <h3 id="kanban-run-heading" className="text-[11px] font-medium text-foreground/82">
                  Autonomous run
                </h3>
                <dl className="mt-2.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[11px]">
                  <dt className="text-muted-foreground/60">State</dt>
                  <dd className="text-foreground/82">
                    {stateLabelForThread(props.threadShell, props.allThreads)}
                  </dd>
                  <dt className="text-muted-foreground/60">Attempt</dt>
                  <dd className="text-foreground/82">
                    {automation.attempt} of {automation.maxAttempts}
                  </dd>
                  <dt className="text-muted-foreground/60">Verification</dt>
                  <dd className="capitalize text-foreground/82">
                    {automation.verification.status}
                  </dd>
                </dl>
                {automation.dependencies.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[10px] text-muted-foreground/60">Dependencies</p>
                    <div className="mt-1.5 space-y-1.5">
                      {automation.dependencies.map((dependencyId) => {
                        const dependency = dependencyById.get(dependencyId);
                        const pending = blockedDependencies.some(
                          (candidate) => candidate.id === dependencyId,
                        );
                        return (
                          <div
                            key={dependencyId}
                            className="flex items-center gap-2 text-[11px] text-muted-foreground/82"
                          >
                            {pending ? (
                              <CircleIcon aria-hidden className="size-3 text-muted-foreground/45" />
                            ) : (
                              <CheckCircle2Icon aria-hidden className="size-3 text-success" />
                            )}
                            <span className="truncate">
                              {dependency?.title ?? "Unavailable task"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null}
                {automation.lastError ? (
                  <p className="mt-3 rounded-[12px] border border-destructive/15 bg-destructive/[0.035] px-3 py-2 text-[11px] leading-4 text-destructive-foreground/82">
                    {automation.lastError}
                  </p>
                ) : automation.verification.summary ? (
                  <p className="mt-3 text-[11px] leading-4 text-muted-foreground/72">
                    {automation.verification.summary}
                  </p>
                ) : null}
              </section>
            ) : null}

            <section
              aria-labelledby="kanban-progress-heading"
              className="border-t border-foreground/[0.07] pt-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3
                  id="kanban-progress-heading"
                  className="text-[11px] font-medium text-foreground/82"
                >
                  Live activity
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
                    {describeEmptyKanbanActivity(automation)}
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
                        <span className="shrink-0 text-[10px] text-muted-foreground/65">
                          Changed
                        </span>
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
                    No changed files were recorded for this task.
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

          {automation?.stage === "review" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={lifecyclePending}
              onClick={() => setRequestChangesOpen(true)}
            >
              Request changes
            </Button>
          ) : null}
          {automation?.stage === "ready" ? (
            <Button
              variant="outline"
              size="sm"
              disabled={lifecyclePending}
              onClick={() => void transition("planned")}
            >
              <PauseIcon aria-hidden className="size-3.5" />
              Pause
            </Button>
          ) : null}
          {automation?.stage === "running" ? (
            <Button
              className="col-span-2"
              variant="destructive-outline"
              size="sm"
              disabled={lifecyclePending}
              onClick={() =>
                void transition("cancelled", { completedAt: new Date().toISOString() })
              }
            >
              {lifecyclePending ? (
                <OpenTuiSpinner name="dots" />
              ) : (
                <XCircleIcon aria-hidden className="size-3.5" />
              )}
              Cancel run
            </Button>
          ) : primaryAction ? (
            <Button
              className={cn(automation?.stage === "review" ? "" : "col-span-2")}
              size="sm"
              disabled={lifecyclePending}
              onClick={() => void primaryAction.run()}
            >
              {lifecyclePending ? (
                <OpenTuiSpinner name="dots" />
              ) : (
                <primaryAction.Icon aria-hidden className="size-3.5" />
              )}
              {primaryAction.label}
            </Button>
          ) : !automation ? (
            <Button
              className="col-span-2"
              variant={props.lane === "review" ? "default" : "outline"}
              size="sm"
              disabled={lifecyclePending || props.lane === "running"}
              onClick={() => void runLegacyLifecycleAction()}
            >
              {lifecyclePending ? (
                <OpenTuiSpinner name="dots" />
              ) : (
                <legacyAction.Icon aria-hidden className="size-3.5" />
              )}
              {props.lane === "running" ? "Agent is still working" : legacyAction.label}
            </Button>
          ) : null}
        </div>
      </aside>

      <RequestChangesDialog
        open={requestChangesOpen}
        onOpenChange={setRequestChangesOpen}
        pending={lifecyclePending}
        onSubmit={(feedback) => {
          void transition("ready", {
            phase: "implementation",
            feedback,
            completedAt: null,
            lastError: null,
            verification: { status: "pending", summary: null, completedAt: null },
          }).then((succeeded) => {
            if (succeeded) setRequestChangesOpen(false);
          });
        }}
      />
    </>
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
            Archived work from this project. Restore a card to return it to the active board.
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
                  allThreads={threads}
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

function AutomationControlBar(props: {
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onOpenSettings: () => void;
}) {
  const configureAutomation = useAtomCommand(projectEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const [pending, setPending] = useState(false);
  const policy = props.project.automationPolicy ?? DEFAULT_AUTOMATION_POLICY;
  const activeCount = props.threads.filter(
    (thread) =>
      thread.automation?.stage === "running" || thread.automation?.stage === "needs-input",
  ).length;
  const queuedCount = props.threads.filter((thread) => thread.automation?.stage === "ready").length;

  const toggle = async () => {
    setPending(true);
    const result = await configureAutomation({
      environmentId: props.project.environmentId,
      input: {
        projectId: props.project.id,
        policy: { ...policy, enabled: !policy.enabled },
      },
    });
    setPending(false);
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "Could not update Autopilot",
        description: "Queued tasks were left unchanged.",
      });
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 border-b border-foreground/[0.06] px-4 py-2.5 sm:px-5">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              policy.enabled ? "bg-success" : "bg-muted-foreground/35",
            )}
          />
          <span className="text-xs font-medium text-foreground/84">
            Autopilot {policy.enabled ? "on" : "off"}
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/62">
            {activeCount}/{policy.createWorktrees ? policy.maxConcurrentRuns : 1} running
            {queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
          </span>
        </div>
        <p className="mt-0.5 truncate text-[10px] text-muted-foreground/58">
          {policy.enabled
            ? "Dependencies and capacity decide what starts next."
            : "Queued work is held until you turn Autopilot on."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={() => void toggle()} disabled={pending}>
          {pending ? <OpenTuiSpinner name="dots" /> : policy.enabled ? <PauseIcon /> : <PlayIcon />}
          {policy.enabled ? "Pause" : "Start"}
        </Button>
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Autopilot settings"
          onClick={props.onOpenSettings}
        >
          <Settings2Icon aria-hidden className="size-3.5" />
        </Button>
      </div>
    </div>
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
  readonly newTaskOpen: boolean;
  readonly onNewTaskOpenChange: (open: boolean) => void;
  readonly baseBranch: string;
  readonly modelSelection: ModelSelection | null;
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
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectedThread = selectedKey
    ? (visibleThreads.find((thread) => kanbanThreadKey(thread) === selectedKey) ?? null)
    : null;

  useEffect(() => {
    if (selectedKey && !selectedThread) setSelectedKey(null);
  }, [selectedKey, selectedThread]);

  const selectThread = useCallback((thread: EnvironmentThreadShell) => {
    setSelectedKey(kanbanThreadKey(thread));
  }, []);

  return (
    <div
      aria-label={`Autonomous work for ${props.project.title}`}
      className="relative flex min-h-0 min-w-0 flex-1 self-stretch overflow-hidden bg-background"
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {!props.historyOpen ? (
          <AutomationControlBar
            project={props.project}
            threads={props.threads}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : null}
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
          <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-4 sm:p-5">
            {lanes.map((lane) => (
              <KanbanLaneColumn
                key={lane.id}
                lane={lane.id}
                threads={lane.threads}
                allThreads={props.threads}
                selectedKey={selectedKey}
                onSelect={selectThread}
              />
            ))}
          </div>
        )}
      </div>

      {selectedThread ? (
        <KanbanInspector
          key={kanbanThreadKey(selectedThread)}
          threadShell={selectedThread}
          allThreads={props.threads}
          lane={classifyKanbanThread(selectedThread, now)}
          onOpenThread={props.onOpenThread}
          onOpenDiff={props.onOpenDiff}
          onClose={() => setSelectedKey(null)}
        />
      ) : null}

      <KanbanNewTaskDialog
        key={`${props.project.environmentId}:${props.project.id}:${props.baseBranch}`}
        open={props.newTaskOpen}
        onOpenChange={props.onNewTaskOpenChange}
        project={props.project}
        threads={props.threads}
        baseBranch={props.baseBranch}
        modelSelection={props.modelSelection}
      />
      <KanbanAutomationSettingsDialog
        key={`${props.project.environmentId}:${props.project.id}:${JSON.stringify(props.project.automationPolicy ?? DEFAULT_AUTOMATION_POLICY)}`}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        project={props.project}
      />
    </div>
  );
}
