import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type {
  ModelSelection,
  OrchestrationAutomationStage,
  ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { useAtomValue } from "@effect/atom-react";
import {
  AlertTriangleIcon,
  ArchiveRestoreIcon,
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  FileCode2Icon,
  GitBranchIcon,
  HistoryIcon,
  ListTodoIcon,
  MessageSquareTextIcon,
  PanelsTopLeftIcon,
  PauseIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Settings2Icon,
  ShieldCheckIcon,
  SparklesIcon,
  XCircleIcon,
  XIcon,
} from "lucide-react";
import { memo, useCallback, useEffect, useMemo, useState } from "react";

import GitActionsControl from "~/components/GitActionsControl";
import {
  deriveComposerActivityDetailsWithSubagentHistory,
  deriveLatestComposerActivityTurnId,
  type ComposerSubagentActivityItem,
} from "~/components/chat/composerActivityDetails";
import { SubagentAvatar, SubagentAvatarStack } from "~/components/chat/SubagentActivityIndicator";
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
import { useCheckpointDiff } from "~/lib/checkpointDiffState";
import { getDiffLineStat, getRenderablePatch, resolveFileDiffPath } from "~/lib/diffRendering";
import { cn, newThreadId } from "~/lib/utils";
import { deriveActivePlanState } from "~/session-logic";
import { useThread } from "~/state/entities";
import { projectEnvironment } from "~/state/projects";
import { useEnvironmentQuery } from "~/state/query";
import { threadEnvironment } from "~/state/threads";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";
import { formatRelativeTimeLabel } from "~/timestampFormat";
import {
  DEFAULT_AUTOMATION_POLICY,
  KanbanAutomationSettingsDialog,
  KanbanNewTaskDialog,
} from "./KanbanAutomationDialogs";
import { KanbanProjectGoalDialog } from "./KanbanProjectGoalDialog";
import {
  automationConflictBlockers,
  capCompletedKanbanThreads,
  classifyKanbanThread,
  describeKanbanThreadState,
  describeEmptyKanbanActivity,
  firstUserGoal,
  groupKanbanThreads,
  incompleteAutomationDependencies,
  liveKanbanAutomation,
  parseAutomationPlan,
  presentKanbanAutomationError,
  sortKanbanThreads,
  type AutomationPlanTask,
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

function resolvePlanModelSelection(
  task: AutomationPlanTask,
  providers: ReadonlyArray<ServerProvider>,
  fallback: ModelSelection,
): ModelSelection | null {
  const provider = providers.find(
    (candidate) =>
      candidate.enabled &&
      candidate.installed &&
      candidate.availability !== "unavailable" &&
      candidate.models.some((model) => model.slug === task.model),
  );
  if (!provider) return task.model === fallback.model ? fallback : null;
  const effortOptionId = provider.driver.toLowerCase().includes("claude")
    ? "effort"
    : "reasoningEffort";
  const fallbackOptions =
    provider.instanceId === fallback.instanceId ? (fallback.options ?? []) : [];
  return {
    instanceId: provider.instanceId,
    model: task.model,
    options: [
      ...fallbackOptions.filter((option) => option.id !== effortOptionId),
      { id: effortOptionId, value: task.reasoningEffort },
    ],
  };
}

function stateLabelForThread(
  thread: EnvironmentThreadShell,
  allThreads: ReadonlyArray<EnvironmentThreadShell>,
): string {
  const blocked = incompleteAutomationDependencies(thread, allThreads);
  if (thread.automation?.stage === "ready" && blocked.length > 0) {
    return `Blocked by ${blocked.length} ${blocked.length === 1 ? "task" : "tasks"}`;
  }
  const conflicts = automationConflictBlockers(thread, allThreads);
  if (conflicts.length > 0) {
    return `Waiting for ${conflicts[0]!.title}`;
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
  const subagentCount = props.thread.subagentCount ?? 0;
  const quietStateLabel =
    props.lane === "history"
      ? props.thread.archivedAt
        ? `Archived ${formatRelativeTimeLabel(props.thread.archivedAt)}`
        : `Completed ${formatRelativeTimeLabel(
            props.thread.automation?.completedAt ?? props.thread.updatedAt,
          )}`
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
        "group isolate w-full overflow-hidden rounded-[20px] border bg-card/62 bg-clip-padding p-3.5 text-left shadow-[0_1px_0_color-mix(in_oklab,var(--foreground)_4%,transparent)]",
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
          {props.thread.automation?.taskKind === "planning" ? (
            <SparklesIcon aria-hidden className="size-3.5" />
          ) : (
            <ListTodoIcon aria-hidden className="size-3.5" />
          )}
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
        {subagentCount > 0 ? (
          <span
            aria-label={`${subagentCount} sub-agent${subagentCount === 1 ? "" : "s"} used by this task`}
            className="flex shrink-0 items-center rounded-full border border-foreground/[0.08] bg-foreground/[0.03] px-1.5 py-0.5"
          >
            <SubagentAvatarStack animated={props.lane === "running"} count={subagentCount} />
          </span>
        ) : (
          <span className="max-w-[46%] truncate rounded-full border border-foreground/[0.07] bg-foreground/[0.035] px-2 py-0.5 text-[10px] text-muted-foreground/80">
            {compactModelLabel(props.thread.modelSelection.model)}
          </span>
        )}
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
  readonly compact: boolean;
  readonly hiddenCount?: number;
  readonly selectedKey: string | null;
  readonly onSelect: (thread: EnvironmentThreadShell) => void;
  readonly onShowHistory: () => void;
}) {
  const copy = LANE_COPY[props.lane];
  return (
    <section
      aria-labelledby={`kanban-${props.lane}-heading`}
      className={cn(
        "flex min-h-0 flex-col rounded-[20px] border border-foreground/[0.055] bg-foreground/[0.018] p-2.5 transition-[min-width,flex-basis,background-color] duration-200 motion-reduce:transition-none",
        props.compact ? "min-w-[9.5rem] flex-[0_0_9.5rem]" : "min-w-[16.5rem] flex-1",
      )}
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
      <ScrollArea className={cn("min-h-0 flex-1", !props.compact && "pr-1.5")}>
        <div className="space-y-2.5 pb-4">
          {props.threads.length === 0 ? (
            props.compact ? (
              <p className="px-1 py-3 text-[10px] leading-4 text-muted-foreground/55">
                {props.lane === "attention" ? "No blockers" : "No work here"}
              </p>
            ) : (
              <LaneEmptyState lane={props.lane} />
            )
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
          {props.hiddenCount ? (
            <Button
              variant="ghost"
              size="xs"
              className="w-full justify-center text-muted-foreground"
              onClick={props.onShowHistory}
            >
              <HistoryIcon aria-hidden className="size-3.5" />
              {props.hiddenCount} more in History
            </Button>
          ) : null}
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

function KanbanSubagentsSection(props: {
  readonly subagents: ReadonlyArray<ComposerSubagentActivityItem>;
}) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const anyRunning = props.subagents.some((item) => item.status === "running");
  const panelId = "kanban-subagents-panel";

  return (
    <section
      aria-labelledby="kanban-subagents-heading"
      className="border-t border-foreground/[0.07] pt-4"
    >
      <button
        type="button"
        aria-controls={panelId}
        aria-expanded={open}
        className="group/subagents flex w-full items-center justify-between gap-3 rounded-[12px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          <span
            id="kanban-subagents-heading"
            className="block text-[11px] font-medium text-foreground/82"
          >
            Sub-agents
          </span>
          <span className="mt-0.5 block text-[10px] text-muted-foreground/62">
            {anyRunning ? "Working in parallel" : "Work completed"}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full border border-foreground/[0.08] bg-foreground/[0.03] py-1 pl-2 pr-1.5 transition-colors group-hover/subagents:border-foreground/15 group-hover/subagents:bg-foreground/[0.05] motion-reduce:transition-none">
          <span aria-hidden="true">
            <SubagentAvatarStack animated={anyRunning} count={props.subagents.length} />
          </span>
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3 text-muted-foreground/55 transition-transform duration-150 motion-reduce:transition-none",
              open && "rotate-90",
            )}
          />
          <span className="sr-only">
            {props.subagents.length} sub-agent{props.subagents.length === 1 ? "" : "s"}
          </span>
        </span>
      </button>

      {open ? (
        <div
          id={panelId}
          className="mt-2.5 space-y-1.5 animate-in fade-in duration-150 motion-reduce:animate-none"
        >
          {props.subagents.map((subagent, index) => {
            const expanded = expandedId === subagent.id;
            const detailId = `kanban-subagent-${index}-detail`;
            return (
              <div
                key={subagent.id}
                className="overflow-hidden rounded-[14px] border border-foreground/[0.065] bg-foreground/[0.018]"
              >
                <button
                  type="button"
                  aria-controls={detailId}
                  aria-expanded={expanded}
                  className="flex w-full items-center gap-2.5 px-2.5 py-2 text-left outline-none transition-colors hover:bg-foreground/[0.025] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
                  onClick={() =>
                    setExpandedId((current) => (current === subagent.id ? null : subagent.id))
                  }
                >
                  <SubagentAvatar animated={subagent.status === "running"} index={index} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11px] font-medium text-foreground/84">
                      {subagent.name}
                    </span>
                    {subagent.model || subagent.reasoningEffort ? (
                      <span className="mt-0.5 block truncate text-[9px] text-muted-foreground/62">
                        {[
                          subagent.model ? compactModelLabel(subagent.model) : null,
                          subagent.reasoningEffort,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </span>
                  <StatusDot status={subagent.status} />
                  <ChevronRightIcon
                    aria-hidden
                    className={cn(
                      "size-3 shrink-0 text-muted-foreground/45 transition-transform duration-150 motion-reduce:transition-none",
                      expanded && "rotate-90",
                    )}
                  />
                </button>
                {expanded ? (
                  <div
                    id={detailId}
                    className="space-y-2 border-t border-foreground/[0.055] px-3 py-2.5 text-[10px] leading-4 text-muted-foreground/76 animate-in fade-in duration-150 motion-reduce:animate-none"
                  >
                    <div>
                      <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/52">
                        Assignment
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap">
                        {subagent.prompt ??
                          `The runtime identified this assignment as “${subagent.name}” but did not report its full prompt.`}
                      </p>
                    </div>
                    {subagent.result ? (
                      <div>
                        <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/52">
                          Result
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap">{subagent.result}</p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
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
  readonly project: EnvironmentProject;
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
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const configureThreadAutomation = useAtomCommand(threadEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const configureProjectAutomation = useAtomCommand(projectEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const serverConfig = useAtomValue(
    serverEnvironment.configValueAtom(props.threadShell.environmentId),
  );
  const [lifecyclePending, setLifecyclePending] = useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = useState(false);
  const automation = liveKanbanAutomation(props.threadShell, thread);
  const automationError = useMemo(
    () => (automation?.lastError ? presentKanbanAutomationError(automation.lastError) : null),
    [automation?.lastError],
  );
  const policy = props.project.automationPolicy ?? DEFAULT_AUTOMATION_POLICY;
  const proposedExecution = useMemo(() => {
    if (automation?.taskKind !== "planning" || !thread) return null;
    const assistant = thread.messages
      .toReversed()
      .find((message) => message.role === "assistant" && !message.streaming && message.text.trim());
    const proposedPlan = thread.proposedPlans.toReversed().find((plan) => !plan.implementedAt);
    return parseAutomationPlan(assistant?.text ?? proposedPlan?.planMarkdown ?? "");
  }, [automation?.taskKind, thread]);
  const proposedModelSelections = useMemo(
    () =>
      proposedExecution?.tasks.map((task) =>
        resolvePlanModelSelection(
          task,
          serverConfig?.providers ?? [],
          props.threadShell.modelSelection,
        ),
      ) ?? [],
    [proposedExecution, props.threadShell.modelSelection, serverConfig?.providers],
  );
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
    () =>
      deriveComposerActivityDetailsWithSubagentHistory(
        thread?.activities ?? [],
        activityTurnId,
        activePlan,
      ),
    [activePlan, activityTurnId, thread?.activities],
  );
  const latestCheckpoint = thread?.checkpoints.at(-1) ?? null;
  const fullThreadDiff = useCheckpointDiff(
    {
      environmentId: props.threadShell.environmentId,
      threadId: props.threadShell.id,
      fromTurnCount: latestCheckpoint === null ? null : 0,
      toTurnCount: latestCheckpoint?.checkpointTurnCount ?? null,
      ignoreWhitespace: false,
      cacheScope: `kanban:${props.threadShell.id}`,
    },
    { enabled: automation?.taskKind !== "planning" },
  );
  const goal = automation?.goal ?? firstUserGoal(thread?.messages ?? []);
  const blockedDependencies = incompleteAutomationDependencies(props.threadShell, props.allThreads);
  const conflictBlockers = automationConflictBlockers(props.threadShell, props.allThreads);
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
  const fullThreadFiles = useMemo(() => {
    const patch = getRenderablePatch(fullThreadDiff.data?.diff, `kanban:${props.threadShell.id}`);
    if (patch?.kind !== "files") return [];
    return patch.files.map((file) => {
      const stats = getDiffLineStat([file]);
      return {
        path: resolveFileDiffPath(file),
        insertions: stats.additions,
        deletions: stats.deletions,
      };
    });
  }, [fullThreadDiff.data?.diff, props.threadShell.id]);
  const visibleFiles = useMemo(
    () =>
      workingFiles.length > 0
        ? workingFiles.map((file) => ({
            path: file.path,
            insertions: file.insertions,
            deletions: file.deletions,
          }))
        : fullThreadDiff.data
          ? fullThreadFiles
          : fullThreadDiff.error
            ? checkpointFiles.map((file) => ({
                path: file.path,
                insertions: file.additions,
                deletions: file.deletions,
              }))
            : [],
    [checkpointFiles, fullThreadDiff.data, fullThreadDiff.error, fullThreadFiles, workingFiles],
  );
  const canOpenDiff = visibleFiles.length > 0;
  const sourceControlSummary = automationError
    ? automationError.title === "Git is not set up for this project"
      ? "Git setup required"
      : "Source-control status unavailable"
    : gitStatus.error
      ? "Source-control status unavailable"
      : gitStatus.data?.pr?.state === "open"
        ? `Pull request #${gitStatus.data.pr.number} is open`
        : gitStatus.data?.hasWorkingTreeChanges
          ? "Uncommitted changes"
          : gitStatus.data?.aheadCount
            ? `${gitStatus.data.aheadCount} commit${gitStatus.data.aheadCount === 1 ? "" : "s"} ahead`
            : "Worktree is up to date";

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
        attempt: number;
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

  const approveProposedExecution = useCallback(async () => {
    if (
      !automation ||
      automation.taskKind !== "planning" ||
      automation.stage !== "review" ||
      !proposedExecution ||
      proposedModelSelections.some((selection) => selection === null)
    ) {
      return;
    }
    setLifecyclePending(true);
    const restorePolicy = async () => {
      if (!policy.enabled) return;
      await configureProjectAutomation({
        environmentId: props.threadShell.environmentId,
        input: {
          projectId: props.project.id,
          policy,
        },
      });
    };
    const ids = new Map(proposedExecution.tasks.map((task) => [task.key, newThreadId()]));
    const createdIds: ReturnType<typeof newThreadId>[] = [];
    const rollback = async () => {
      for (const threadId of createdIds.toReversed()) {
        await deleteThread({
          environmentId: props.threadShell.environmentId,
          input: { threadId },
        });
      }
      await restorePolicy();
    };
    if (policy.enabled) {
      const pauseResult = await configureProjectAutomation({
        environmentId: props.threadShell.environmentId,
        input: {
          projectId: props.project.id,
          policy: { ...policy, enabled: false },
        },
      });
      if (pauseResult._tag === "Failure") {
        setLifecyclePending(false);
        showLifecycleError();
        return;
      }
    }
    for (const [index, task] of proposedExecution.tasks.entries()) {
      const threadId = ids.get(task.key)!;
      const modelSelection = proposedModelSelections[index]!;
      const createdAt = new Date(Date.now() + index).toISOString();
      const createResult = await createThread({
        environmentId: props.threadShell.environmentId,
        input: {
          threadId,
          projectId: props.project.id,
          title: task.title,
          modelSelection: modelSelection!,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: automation.baseBranch,
          worktreePath: null,
          createdAt,
        },
      });
      if (createResult._tag === "Failure") {
        await rollback();
        setLifecyclePending(false);
        showLifecycleError();
        return;
      }
      createdIds.push(threadId);
      const configureResult = await configureThreadAutomation({
        environmentId: props.threadShell.environmentId,
        input: {
          threadId,
          automation: {
            taskKind: "implementation",
            goal: task.goal,
            acceptanceCriteria: [
              ...task.acceptanceCriteria,
              ...task.verification.map((check) => `Verification: ${check}`),
            ],
            dependencies: task.dependsOn.map((key) => ids.get(key)!),
            changeScopes: task.changeScopes,
            baseBranch: automation.baseBranch,
            stage: "ready",
            phase: "implementation",
            attempt: 0,
            maxAttempts: policy.defaultMaxAttempts,
            maxRuntimeMinutes: policy.defaultMaxRuntimeMinutes,
            leaseExpiresAt: null,
            lastHeartbeatAt: null,
            lastError: null,
            feedback: null,
            verification: { status: "pending", summary: null, completedAt: null },
            startedAt: null,
            completedAt: null,
            createdAt,
            updatedAt: createdAt,
          },
        },
      });
      if (configureResult._tag === "Failure") {
        await rollback();
        setLifecyclePending(false);
        showLifecycleError();
        return;
      }
    }
    const completedAt = new Date().toISOString();
    const transitionResult = await transitionAutomation({
      environmentId: props.threadShell.environmentId,
      input: {
        threadId: props.threadShell.id,
        expectedStage: "review",
        stage: "complete",
        completedAt,
      },
    });
    if (transitionResult._tag === "Failure") {
      await rollback();
      setLifecyclePending(false);
      showLifecycleError();
      return;
    }
    const enableResult = await configureProjectAutomation({
      environmentId: props.threadShell.environmentId,
      input: {
        projectId: props.project.id,
        policy: { ...policy, enabled: true },
      },
    });
    if (enableResult._tag === "Failure") {
      toastManager.add({
        type: "warning",
        title: "Plan approved; Autopilot is still paused",
        description: "The tasks are safely queued. Start Autopilot when you are ready.",
      });
    }
    setLifecyclePending(false);
    toastManager.add({
      type: "success",
      title: "Plan approved",
      description: `${proposedExecution.tasks.length} autonomous tasks are ready to run.`,
    });
  }, [
    automation,
    configureProjectAutomation,
    configureThreadAutomation,
    createThread,
    deleteThread,
    policy,
    proposedExecution,
    proposedModelSelections,
    props.project.id,
    props.threadShell.environmentId,
    props.threadShell.id,
    transitionAutomation,
  ]);

  const reviewDeliveryReady =
    automation?.taskKind === "planning" ||
    (gitStatus.data != null &&
      !gitStatus.data.hasWorkingTreeChanges &&
      (policy.deliveryMode !== "pull-request" || gitStatus.data.pr?.state === "open") &&
      (policy.deliveryMode !== "push-branch" || !gitStatus.data.aheadCount));
  const reviewNeedsDelivery = automation?.stage === "review" && !reviewDeliveryReady;

  const primaryAction = automation
    ? automation.stage === "planned"
      ? { label: "Queue task", Icon: PlayIcon, run: () => transition("ready") }
      : automation.stage === "needs-input"
        ? {
            label: "Open chat",
            Icon: MessageSquareTextIcon,
            run: async () => props.onOpenThread(props.threadShell),
          }
        : automation.stage === "review" && automation.taskKind === "planning"
          ? proposedExecution && proposedModelSelections.every((selection) => selection !== null)
            ? {
                label: "Approve plan & start",
                Icon: SparklesIcon,
                run: approveProposedExecution,
              }
            : null
          : automation.stage === "review" && reviewDeliveryReady
            ? {
                label: "Approve task",
                Icon: CheckCircle2Icon,
                run: () => transition("complete", { completedAt: new Date().toISOString() }),
              }
            : automation.stage === "failed"
              ? {
                  label: "Retry",
                  Icon: RotateCcwIcon,
                  run: () =>
                    transition("ready", { attempt: 0, lastError: null, completedAt: null }),
                }
              : automation.stage === "complete" || automation.stage === "cancelled"
                ? {
                    label: "Reopen",
                    Icon: RotateCcwIcon,
                    run: () =>
                      transition("ready", {
                        phase: "implementation",
                        attempt: 0,
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

            {automation?.taskKind === "planning" ? (
              <section
                aria-labelledby="kanban-plan-heading"
                className="border-t border-foreground/[0.07] pt-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <h3
                    id="kanban-plan-heading"
                    className="text-[11px] font-medium text-foreground/82"
                  >
                    Proposed execution
                  </h3>
                  {proposedExecution ? (
                    <span className="text-[10px] tabular-nums text-muted-foreground">
                      {proposedExecution.tasks.length} tasks
                    </span>
                  ) : null}
                </div>
                {proposedExecution ? (
                  <>
                    <p className="mt-2 text-[11px] leading-4 text-muted-foreground/72">
                      {proposedExecution.summary}
                    </p>
                    <ol className="mt-3 space-y-2">
                      {proposedExecution.tasks.map((task, index) => {
                        const modelAvailable = proposedModelSelections[index] !== null;
                        return (
                          <li
                            key={task.key}
                            className="rounded-[14px] border border-foreground/[0.065] bg-foreground/[0.02] px-3 py-2.5"
                          >
                            <div className="flex items-start gap-2.5">
                              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055] text-[10px] tabular-nums text-muted-foreground">
                                {index + 1}
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="text-[11px] font-medium leading-4 text-foreground/84">
                                  {task.title}
                                </p>
                                <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground/68">
                                  <span
                                    className={cn(
                                      "rounded-full border px-1.5 py-0.5",
                                      modelAvailable
                                        ? "border-foreground/[0.07] bg-foreground/[0.03]"
                                        : "border-destructive/20 bg-destructive/[0.04] text-destructive",
                                    )}
                                  >
                                    {compactModelLabel(task.model)} · {task.reasoningEffort}
                                  </span>
                                  {task.dependsOn.length > 0 ? (
                                    <span>after {task.dependsOn.join(", ")}</span>
                                  ) : (
                                    <span>can start immediately</span>
                                  )}
                                </div>
                                <p className="mt-1.5 truncate font-mono text-[9px] text-muted-foreground/55">
                                  {task.changeScopes.join(" · ")}
                                </p>
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                    {proposedModelSelections.some((selection) => selection === null) ? (
                      <p className="mt-2.5 rounded-[12px] border border-destructive/15 bg-destructive/[0.035] px-3 py-2 text-[10px] leading-4 text-destructive">
                        One or more proposed models are unavailable in this environment. Open the
                        planning response and ask the agent to use an installed model.
                      </p>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 text-[11px] leading-4 text-muted-foreground/65">
                    {automation.stage === "running" || automation.stage === "ready"
                      ? "The planning agent is inspecting the repository. Its task graph will appear here for approval."
                      : "No valid structured plan was found. Open the planning response to inspect or revise it."}
                  </p>
                )}
              </section>
            ) : null}

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
                {automation.changeScopes.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[10px] text-muted-foreground/60">Change scope</p>
                    <p className="mt-1.5 truncate font-mono text-[10px] text-muted-foreground/75">
                      {automation.changeScopes.join(" · ")}
                    </p>
                    {conflictBlockers.length > 0 ? (
                      <p className="mt-1.5 text-[10px] leading-4 text-warning">
                        Waiting for {conflictBlockers.map((item) => item.title).join(", ")} to leave
                        these paths.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                {automationError ? (
                  <div
                    role="alert"
                    className="mt-3 rounded-[14px] border border-destructive/15 bg-destructive/[0.035] px-3 py-2.5"
                  >
                    <p className="text-[11px] font-medium leading-4 text-destructive-foreground/88">
                      {automationError.title}
                    </p>
                    <p className="mt-1 text-[10px] leading-4 text-destructive-foreground/72">
                      {automationError.detail}
                    </p>
                    {automationError.recovery ? (
                      <p className="mt-1.5 text-[10px] leading-4 text-muted-foreground/78">
                        {automationError.recovery}
                      </p>
                    ) : null}
                  </div>
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

            {details.subagents.length > 0 ? (
              <KanbanSubagentsSection subagents={details.subagents} />
            ) : null}

            {automation?.taskKind !== "planning" ? (
              <section
                aria-labelledby="kanban-changes-heading"
                className="border-t border-foreground/[0.07] pt-4"
              >
                {canOpenDiff ? (
                  <button
                    type="button"
                    aria-label="Open this task's complete diff"
                    className="group/changes flex w-full items-center justify-between gap-3 rounded-[10px] text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() =>
                      props.onOpenDiff(
                        props.threadShell,
                        gitStatus.data?.hasWorkingTreeChanges ? "unstaged" : "branch",
                      )
                    }
                  >
                    <span
                      id="kanban-changes-heading"
                      className="text-[11px] font-medium text-foreground/82 group-hover/changes:text-foreground"
                    >
                      Changes
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        {visibleFiles.length} {visibleFiles.length === 1 ? "file" : "files"}
                      </span>
                      <ChevronRightIcon
                        aria-hidden
                        className="size-3.5 text-muted-foreground/45 transition-transform group-hover/changes:translate-x-0.5 group-hover/changes:text-muted-foreground motion-reduce:transition-none"
                      />
                    </span>
                  </button>
                ) : (
                  <div className="flex items-center justify-between gap-3">
                    <span
                      id="kanban-changes-heading"
                      className="text-[11px] font-medium text-foreground/82"
                    >
                      Changes
                    </span>
                    {!fullThreadDiff.isPending || workingFiles.length > 0 ? (
                      <span className="text-[10px] tabular-nums text-muted-foreground">
                        0 files
                      </span>
                    ) : null}
                  </div>
                )}
                <div className="mt-2.5 space-y-2">
                  {fullThreadDiff.isPending && workingFiles.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground/65">
                      Calculating the complete task diff…
                    </p>
                  ) : visibleFiles.length > 0 ? (
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
            ) : null}

            {automation?.taskKind !== "planning" ? (
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
                      {sourceControlSummary}
                    </p>
                  </div>
                  {automation?.stage === "review" ? (
                    <span
                      className={cn(
                        "rounded-full border px-2 py-1 text-[10px]",
                        reviewDeliveryReady
                          ? "border-success/18 bg-success/[0.045] text-success"
                          : "border-warning/18 bg-warning/[0.045] text-warning",
                      )}
                    >
                      {reviewDeliveryReady ? "Ready" : "Delivery needed"}
                    </span>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </ScrollArea>

        <div className="grid grid-cols-2 gap-2 border-t border-foreground/[0.07] p-4">
          {automation?.taskKind !== "planning" && canOpenDiff ? (
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
          ) : null}
          <Button
            className={cn((automation?.taskKind === "planning" || !canOpenDiff) && "col-span-2")}
            variant="outline"
            size="sm"
            onClick={() => props.onOpenThread(props.threadShell)}
          >
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
          {reviewNeedsDelivery ? (
            <div className="col-span-1 flex min-w-0 items-center justify-end">
              <GitActionsControl gitCwd={gitCwd} activeThreadRef={threadRef} />
            </div>
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
              className={cn(
                automation?.stage === "review" && !reviewNeedsDelivery ? "" : "col-span-2",
              )}
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
            Project history
          </h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Older completed work and archived tasks, kept off the active board without losing
            detail.
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
              <p className="text-xs font-medium text-foreground/72">No project history</p>
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
  readonly onOpenGoal: () => void;
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
          <span className="text-xs font-medium text-foreground/84">
            Autopilot{" "}
            <span className={policy.enabled ? "text-success" : "text-destructive"}>
              {policy.enabled ? "on" : "off"}
            </span>
          </span>
          <span className="text-[10px] tabular-nums text-muted-foreground/62">
            {activeCount}/{policy.createWorktrees ? policy.maxConcurrentRuns : 1} running
            {queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="xs" onClick={props.onOpenGoal}>
          <SparklesIcon aria-hidden className="size-3.5" />
          Plan project
        </Button>
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
  readonly onHistoryOpenChange: (open: boolean) => void;
  readonly newTaskOpen: boolean;
  readonly onNewTaskOpenChange: (open: boolean) => void;
  readonly baseBranch: string;
  readonly modelSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
  readonly onOpenDiff: (thread: EnvironmentThreadShell, scope: "branch" | "unstaged") => void;
}) {
  const now = useMemo(() => new Date().toISOString(), [props.threads, props.archivedThreads]);
  const lanes = useMemo(() => groupKanbanThreads(props.threads, now), [now, props.threads]);
  const completed = lanes.find((lane) => lane.id === "complete")?.threads ?? [];
  const completedCap = useMemo(() => capCompletedKanbanThreads(completed, 4), [completed]);
  const visibleLanes = useMemo(
    () =>
      lanes.map((lane) =>
        lane.id === "complete" ? { ...lane, threads: completedCap.visible } : lane,
      ),
    [completedCap.visible, lanes],
  );
  const historyThreads = useMemo(() => {
    const byKey = new Map(
      [...completedCap.overflow, ...props.archivedThreads].map((thread) => [
        kanbanThreadKey(thread),
        thread,
      ]),
    );
    return [...byKey.values()];
  }, [completedCap.overflow, props.archivedThreads]);
  const visibleThreads = useMemo(
    () =>
      props.historyOpen
        ? sortKanbanThreads(historyThreads)
        : visibleLanes.flatMap((lane) => lane.threads),
    [historyThreads, props.historyOpen, visibleLanes],
  );
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [goalOpen, setGoalOpen] = useState(false);
  const boardIsEmpty = visibleLanes.every((lane) => lane.threads.length === 0);
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
            onOpenGoal={() => setGoalOpen(true)}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        ) : null}
        {props.historyOpen ? (
          <HistoryBoard
            threads={historyThreads}
            loading={props.archivedThreadsLoading}
            error={props.archivedThreadsError}
            selectedKey={selectedKey}
            onSelect={selectThread}
            onRefresh={props.onRefreshArchivedThreads}
          />
        ) : boardIsEmpty ? (
          <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto p-5 pt-[clamp(3rem,10vh,7rem)]">
            <div className="w-full max-w-md rounded-[24px] border border-foreground/[0.065] bg-foreground/[0.018] px-7 py-8 text-center">
              <span className="mx-auto flex size-10 items-center justify-center rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.035] text-muted-foreground">
                <ListTodoIcon aria-hidden className="size-4.5" />
              </span>
              <h2 className="mt-4 text-sm font-medium text-foreground/88">
                No autonomous work yet
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-[11px] leading-5 text-muted-foreground/70">
                Plan a project goal for FACT3 to break down, or add one focused task yourself.
              </p>
              <div className="mt-5 flex items-center justify-center gap-2">
                <Button size="sm" onClick={() => setGoalOpen(true)}>
                  <SparklesIcon aria-hidden className="size-3.5" />
                  Plan project
                </Button>
                <Button variant="outline" size="sm" onClick={() => props.onNewTaskOpenChange(true)}>
                  <ListTodoIcon aria-hidden className="size-3.5" />
                  New task
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 min-w-0 flex-1 gap-3 overflow-x-auto p-4 sm:p-5">
            {visibleLanes.map((lane) => (
              <KanbanLaneColumn
                key={lane.id}
                lane={lane.id}
                threads={lane.threads}
                allThreads={props.threads}
                compact={lane.threads.length === 0}
                hiddenCount={lane.id === "complete" ? completedCap.overflow.length : 0}
                selectedKey={selectedKey}
                onSelect={selectThread}
                onShowHistory={() => props.onHistoryOpenChange(true)}
              />
            ))}
          </div>
        )}
      </div>

      {selectedThread ? (
        <KanbanInspector
          key={kanbanThreadKey(selectedThread)}
          project={props.project}
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
        providers={props.providers}
        settings={props.settings}
      />
      <KanbanProjectGoalDialog
        key={`goal:${props.project.environmentId}:${props.project.id}:${props.baseBranch}`}
        open={goalOpen}
        onOpenChange={setGoalOpen}
        project={props.project}
        baseBranch={props.baseBranch}
        modelSelection={props.modelSelection}
        providers={props.providers}
        settings={props.settings}
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
