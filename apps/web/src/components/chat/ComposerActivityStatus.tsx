import {
  BotIcon,
  CheckIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleIcon,
  EyeIcon,
  FileSearchIcon,
  GlobeIcon,
  HammerIcon,
  ListTodoIcon,
  SquarePenIcon,
  TerminalIcon,
  WrenchIcon,
} from "lucide-react";
import { memo, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { ThinkingOrb } from "thinking-orbs";

import { cn } from "~/lib/utils";
import {
  FLOATING_SQUIRCLE_ITEM_CLASS_NAME,
  FLOATING_SQUIRCLE_SURFACE_CLASS_NAME,
} from "../ui/floatingSquircle";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { SubagentActivityIndicator, SubagentAvatar } from "./SubagentActivityIndicator";
import {
  formatComposerToolData,
  type ComposerActivityDetails,
  type ComposerActivityItemStatus,
  type ComposerSubagentActivityItem,
  type ComposerTaskActivityItem,
  type ComposerToolActivityItem,
} from "./composerActivityDetails";

type ActivitySection = "tools" | "subagents" | "tasks";

const ACTIVITY_SECTIONS: ReadonlyArray<{
  readonly value: ActivitySection;
  readonly label: string;
  readonly Icon: ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
}> = [
  { value: "tools", label: "Tool calls", Icon: TerminalIcon },
  { value: "subagents", label: "Sub-agents", Icon: BotIcon },
  { value: "tasks", label: "Tasks", Icon: ListTodoIcon },
];

export const ACTIVITY_SECTION_ITEM_CLASS_NAME = FLOATING_SQUIRCLE_ITEM_CLASS_NAME;

function statusCopy(status: ComposerActivityItemStatus): string {
  switch (status) {
    case "pending":
      return "Pending";
    case "running":
      return "Working";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
  }
}

function statusTextClass(status: ComposerActivityItemStatus): string {
  if (status === "failed") return "text-destructive";
  if (status === "completed") return "text-emerald-500 dark:text-emerald-400";
  return "text-muted-foreground";
}

function StaticStatusIcon({ status }: { readonly status: ComposerActivityItemStatus }) {
  if (status === "completed") {
    return <CheckIcon aria-hidden className="size-3.5 text-emerald-500 dark:text-emerald-400" />;
  }
  if (status === "failed" || status === "stopped") {
    return <CircleAlertIcon aria-hidden className="size-3.5 text-destructive" />;
  }
  return <CircleIcon aria-hidden className="size-3.5 text-muted-foreground/55" />;
}

function toolActivityIcon(item: ComposerToolActivityItem) {
  switch (item.itemType) {
    case "command_execution":
      return TerminalIcon;
    case "file_change":
      return SquarePenIcon;
    case "web_search":
      return GlobeIcon;
    case "image_view":
      return EyeIcon;
  }

  const label = `${item.title} ${item.detail ?? ""}`.toLowerCase();
  if (/\b(?:web|browser|url|https?)\b/u.test(label)) return GlobeIcon;
  if (/\b(?:edit|patch|write|create|delete|move|rename|change)\b/u.test(label)) {
    return SquarePenIcon;
  }
  if (/\b(?:read|view|inspect|open|image|screenshot)\b/u.test(label)) return EyeIcon;
  if (/\b(?:search(?:ing|ed)?|find|grep|rg)\b/u.test(label)) return FileSearchIcon;
  if (/\b(?:command|terminal|shell|exec|run)\b/u.test(label)) return TerminalIcon;

  if (item.itemType === "mcp_tool_call") return WrenchIcon;
  if (item.itemType === "dynamic_tool_call") return HammerIcon;
  return WrenchIcon;
}

function ToolActivityIcon({ item }: { readonly item: ComposerToolActivityItem }) {
  if (item.status === "failed" || item.status === "stopped") {
    return <StaticStatusIcon status={item.status} />;
  }
  const Icon = toolActivityIcon(item);
  return (
    <Icon
      aria-hidden
      className={cn(
        "size-3.5",
        item.status === "running" ? "text-foreground/85" : "text-muted-foreground",
      )}
    />
  );
}

function ActivityRowShell(props: {
  readonly title: string;
  readonly titleAccessory?: ReactNode;
  readonly detail?: string;
  readonly status: ComposerActivityItemStatus;
  readonly leading: ReactNode;
  readonly detailKind?: "command";
  readonly expanded?: boolean;
  readonly expandable?: boolean;
  readonly onToggle?: () => void;
  readonly children?: ReactNode;
}) {
  const statusLabel = statusCopy(props.status);
  const content = (
    <>
      <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground/[0.055]">
        {props.leading}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="min-w-0 truncate text-[13px] font-normal text-foreground/90">
            {props.title}
          </span>
          {props.titleAccessory}
        </span>
        {props.detail ? (
          <span
            className={cn(
              "mt-0.5 block truncate text-[11px] text-muted-foreground",
              props.detailKind === "command" && "font-mono",
            )}
          >
            {props.detail}
          </span>
        ) : null}
      </span>
      {props.status === "completed" ? (
        <span className="sr-only">{statusLabel}</span>
      ) : (
        <span className={cn("shrink-0 text-[10px]", statusTextClass(props.status))}>
          {statusLabel}
        </span>
      )}
      {props.expandable ? (
        <ChevronRightIcon
          aria-hidden
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-150 motion-reduce:transition-none",
            props.expanded && "rotate-90",
          )}
        />
      ) : null}
    </>
  );

  return (
    <li className="activity-panel-row border-b border-border/45 last:border-b-0">
      {props.expandable ? (
        <button
          aria-expanded={props.expanded}
          className="flex min-h-12 w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left outline-none transition-colors hover:bg-foreground/[0.035] focus-visible:bg-foreground/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          onClick={props.onToggle}
          type="button"
        >
          {content}
        </button>
      ) : (
        <div className="flex min-h-12 items-center gap-2.5 px-3 py-2">{content}</div>
      )}
      {props.expanded && props.children ? (
        <div className="activity-panel-row-detail px-3 pb-3 pl-12">{props.children}</div>
      ) : null}
    </li>
  );
}

function formatSubagentModel(model: string): string {
  return model.replace(/^gpt-/iu, "GPT-").replace(/-(sol|terra|luna)$/iu, (_, family: string) => {
    return `-${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()}`;
  });
}

const REASONING_EFFORT_LABELS: Readonly<Record<string, string>> = {
  none: "None",
  minimal: "Minimal",
  low: "Low",
  medium: "Medium",
  high: "High",
  xhigh: "Extra High",
  max: "Max",
  ultra: "Ultra",
};

function formatReasoningEffort(reasoningEffort: string): string {
  return REASONING_EFFORT_LABELS[reasoningEffort.toLowerCase()] ?? reasoningEffort;
}

function SubagentRuntimePill(props: {
  readonly model?: string;
  readonly reasoningEffort?: string;
}) {
  if (!props.model && !props.reasoningEffort) return null;
  const modelLabel = props.model ? formatSubagentModel(props.model) : null;
  const reasoningLabel = props.reasoningEffort
    ? formatReasoningEffort(props.reasoningEffort)
    : null;
  const accessibleLabel = [
    modelLabel ? `Model ${modelLabel}` : null,
    reasoningLabel ? `${reasoningLabel} reasoning` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <span
      aria-label={accessibleLabel}
      className="flex max-w-52 shrink-0 items-center overflow-hidden rounded-full border border-border/55 bg-foreground/[0.045] text-[10px] font-normal leading-4 text-muted-foreground"
      data-subagent-runtime="true"
      title={accessibleLabel}
    >
      {modelLabel ? <span className="truncate px-2 py-px">{modelLabel}</span> : null}
      {reasoningLabel ? (
        <span
          className={cn(
            "shrink-0 px-2 py-px",
            modelLabel && "border-l border-border/50 text-muted-foreground/85",
          )}
        >
          {reasoningLabel}
        </span>
      ) : null}
    </span>
  );
}

export const ToolActivityRow = memo(function ToolActivityRow(props: {
  readonly item: ComposerToolActivityItem;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ActivityRowShell
      {...(props.item.detail ? { detail: props.item.detail } : {})}
      {...(props.item.detailKind ? { detailKind: props.item.detailKind } : {})}
      expandable
      expanded={expanded}
      leading={<ToolActivityIcon item={props.item} />}
      onToggle={() => setExpanded((value) => !value)}
      status={props.item.status}
      title={props.item.title}
    >
      <div className="rounded-xl border border-border/45 bg-background/55 p-2.5">
        <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/75">
          Full tool call
        </div>
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-4 text-foreground/75">
          {formatComposerToolData(props.item.rawData)}
        </pre>
      </div>
    </ActivityRowShell>
  );
});

export const SubagentActivityRow = memo(function SubagentActivityRow(props: {
  readonly avatarIndex: number;
  readonly item: ComposerSubagentActivityItem;
  readonly theme: "light" | "dark";
}) {
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(props.item.prompt || props.item.result);
  return (
    <ActivityRowShell
      detail={
        props.item.prompt
          ? props.item.prompt.replace(/\s+/g, " ")
          : props.item.result
            ? props.item.result.replace(/\s+/g, " ")
            : props.item.status === "running"
              ? "Working on the assigned task"
              : "Assignment complete"
      }
      expandable={hasDetails}
      expanded={expanded}
      leading={
        props.item.status === "running" ? (
          <ThinkingOrb
            aria-label={`${props.item.name} is working`}
            size={20}
            speed={0.85}
            state="composing"
            theme={props.theme}
          />
        ) : props.item.status === "completed" ? (
          <SubagentAvatar index={props.avatarIndex} />
        ) : (
          <StaticStatusIcon status={props.item.status} />
        )
      }
      onToggle={() => setExpanded((value) => !value)}
      status={props.item.status}
      title={props.item.name}
      titleAccessory={
        <SubagentRuntimePill
          {...(props.item.model ? { model: props.item.model } : {})}
          {...(props.item.reasoningEffort ? { reasoningEffort: props.item.reasoningEffort } : {})}
        />
      }
    >
      <div className="space-y-2 rounded-xl border border-border/45 bg-background/55 p-2.5 text-[11px] leading-4">
        <div>
          <div className="mb-1 font-medium text-muted-foreground">Assignment</div>
          <div className="whitespace-pre-wrap text-foreground/75">
            {props.item.prompt ?? props.item.name}
          </div>
        </div>
        {props.item.result ? (
          <div className="border-t border-border/40 pt-2">
            <div className="mb-1 font-medium text-muted-foreground">Result</div>
            <div className="whitespace-pre-wrap text-foreground/75">{props.item.result}</div>
          </div>
        ) : null}
      </div>
    </ActivityRowShell>
  );
});

const TaskActivityRow = memo(function TaskActivityRow(props: {
  readonly item: ComposerTaskActivityItem;
  readonly theme: "light" | "dark";
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ActivityRowShell
      {...(props.item.detail ? { detail: props.item.detail } : {})}
      expandable={Boolean(props.item.detail)}
      expanded={expanded}
      leading={
        props.item.status === "running" ? (
          <ThinkingOrb
            aria-label={`${props.item.title} is in progress`}
            size={20}
            state="searching"
            theme={props.theme}
          />
        ) : (
          <StaticStatusIcon status={props.item.status} />
        )
      }
      onToggle={() => setExpanded((value) => !value)}
      status={props.item.status}
      title={props.item.title}
    >
      {props.item.detail ? (
        <div className="rounded-xl border border-border/45 bg-background/55 p-2.5 text-[11px] leading-4 text-foreground/75">
          {props.item.detail}
        </div>
      ) : null}
    </ActivityRowShell>
  );
});

function EmptyActivitySection({ label }: { readonly label: string }) {
  return (
    <div className="flex min-h-24 items-center justify-center px-6 text-center text-[12px] text-muted-foreground">
      No {label.toLowerCase()} were reported for this turn.
    </div>
  );
}

function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

function completedActivityDetail(details: ComposerActivityDetails): string {
  const labels = [
    details.tools.length > 0 ? countLabel(details.tools.length, "tool call") : null,
    details.subagents.length > 0
      ? countLabel(details.subagents.length, "sub-agent", "sub-agents")
      : null,
    details.tasks.length > 0 ? countLabel(details.tasks.length, "task") : null,
  ].filter((value): value is string => value !== null);
  return labels.length > 0 ? labels.join(" · ") : "Response complete";
}

function ComposerActivityPanel(props: {
  readonly details: ComposerActivityDetails;
  readonly isActive: boolean;
  readonly theme: "light" | "dark";
}) {
  const initialSection = useMemo<ActivitySection>(() => {
    if (props.details.tools.length > 0) return "tools";
    if (props.details.subagents.length > 0) return "subagents";
    return "tasks";
  }, [props.details.subagents.length, props.details.tools.length]);
  const [section, setSection] = useState<ActivitySection>(initialSection);
  const sectionDefinition =
    ACTIVITY_SECTIONS.find((candidate) => candidate.value === section) ?? ACTIVITY_SECTIONS[0]!;
  const SectionIcon = sectionDefinition.Icon;
  const itemCount =
    section === "tools"
      ? props.details.tools.length
      : section === "subagents"
        ? props.details.subagents.length
        : props.details.tasks.length;

  return (
    <div className="composer-activity-panel w-[min(38rem,calc(100vw-2rem))] overflow-hidden rounded-[34px] border">
      <PopoverTitle className="sr-only">Agent activity details</PopoverTitle>
      <div className="flex min-h-12 items-center justify-between gap-3 px-3.5">
        <Select
          onValueChange={(value) => value && setSection(value as ActivitySection)}
          value={section}
        >
          <SelectTrigger
            aria-label="Activity category"
            className="-ml-1 min-h-8 w-auto min-w-36 rounded-[16px] border-transparent bg-transparent px-2 text-[13px] font-normal shadow-none before:hidden hover:bg-foreground/[0.045]"
            size="sm"
          >
            <SectionIcon aria-hidden className="size-3.5 text-muted-foreground" />
            <SelectValue>{sectionDefinition.label}</SelectValue>
          </SelectTrigger>
          <SelectPopup
            align="start"
            className="min-w-44"
            popupClassName={cn(
              "composer-activity-panel-menu",
              FLOATING_SQUIRCLE_SURFACE_CLASS_NAME,
            )}
            positionerClassName="z-[80]"
            side="bottom"
            sideOffset={5}
          >
            {ACTIVITY_SECTIONS.map(({ value, label, Icon }) => {
              const count =
                value === "tools"
                  ? props.details.tools.length
                  : value === "subagents"
                    ? props.details.subagents.length
                    : props.details.tasks.length;
              return (
                <SelectItem className={ACTIVITY_SECTION_ITEM_CLASS_NAME} key={value} value={value}>
                  <span className="flex items-center gap-2">
                    <Icon aria-hidden className="size-3.5" />
                    <span>{label}</span>
                    <span className="ml-auto pl-4 text-[11px] tabular-nums text-muted-foreground">
                      {count}
                    </span>
                  </span>
                </SelectItem>
              );
            })}
          </SelectPopup>
        </Select>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {props.isActive ? `${itemCount} live` : `${itemCount} total`}
        </span>
      </div>

      <div className="mx-2 mb-2 overflow-hidden rounded-[28px] border border-border/55 bg-foreground/[0.025]">
        <ul
          aria-live={props.isActive ? "polite" : "off"}
          className="activity-panel-list max-h-[19rem] overflow-y-auto overscroll-contain"
        >
          {section === "tools" ? (
            props.details.tools.length > 0 ? (
              props.details.tools.map((item) => <ToolActivityRow item={item} key={item.id} />)
            ) : (
              <EmptyActivitySection label="Tool calls" />
            )
          ) : null}
          {section === "subagents" ? (
            props.details.subagents.length > 0 ? (
              props.details.subagents.map((item, index) => (
                <SubagentActivityRow
                  avatarIndex={index}
                  item={item}
                  key={item.id}
                  theme={props.theme}
                />
              ))
            ) : (
              <EmptyActivitySection label="Sub-agents" />
            )
          ) : null}
          {section === "tasks" ? (
            props.details.tasks.length > 0 ? (
              props.details.tasks.map((item) => (
                <TaskActivityRow item={item} key={item.id} theme={props.theme} />
              ))
            ) : (
              <EmptyActivitySection label="Tasks" />
            )
          ) : null}
        </ul>
      </div>
    </div>
  );
}

export const ComposerActivityStatus = memo(function ComposerActivityStatus(props: {
  readonly activity: {
    readonly title: string;
    readonly detail?: string;
    readonly detailKind?: "command";
  };
  readonly activeSubagentCount: number;
  readonly completionState?: "completed" | "interrupted" | "error";
  readonly details: ComposerActivityDetails;
  readonly isActive: boolean;
  readonly theme: "light" | "dark";
}) {
  const visibleActivity = props.isActive
    ? props.activity
    : {
        title:
          props.completionState === "error"
            ? "Agent stopped with an error"
            : props.completionState === "interrupted"
              ? "Agent stopped working"
              : "Agent finished working",
        detail: completedActivityDetail(props.details),
      };
  const displayedSubagentCount = props.isActive
    ? props.activeSubagentCount
    : props.details.subagents.length;
  const statusLabel = [
    visibleActivity.title,
    visibleActivity.detail,
    displayedSubagentCount > 0
      ? `${displayedSubagentCount} ${displayedSubagentCount === 1 ? "sub-agent" : "sub-agents"}${props.isActive ? " running" : ""}`
      : null,
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="flex justify-center px-4 pb-2 sm:px-5 sm:pb-2.5">
      <span aria-live="polite" className="sr-only">
        {statusLabel}
      </span>
      <Popover>
        <PopoverTrigger
          render={
            <button
              aria-label={`${statusLabel}. Open activity details`}
              className="composer-activity-status grid w-full max-w-[38rem] min-w-0 cursor-pointer grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-full border px-2.5 py-1.5 text-left text-[13px] outline-none transition-[border-color,background-color,box-shadow] hover:border-foreground/20 hover:bg-background/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background sm:px-3"
              data-chat-composer-activity="true"
              type="button"
            >
              <ThinkingOrb
                aria-hidden="true"
                className={cn(props.isActive && "thinking-orb-motion")}
                paused={!props.isActive}
                size={64}
                state="composing"
                style={{ width: 32, height: 32, flex: "none" }}
                theme={props.theme}
              />
              <span aria-hidden="true" className="composer-activity-copy min-w-0">
                <span
                  className="composer-activity-copy-line block truncate"
                  key={visibleActivity.title}
                >
                  {visibleActivity.title}
                </span>
                {visibleActivity.detail ? (
                  <span
                    className={cn(
                      "composer-activity-copy-detail block truncate text-[12px] text-muted-foreground",
                      visibleActivity.detailKind === "command" && "font-mono",
                    )}
                    key={visibleActivity.detail}
                  >
                    {visibleActivity.detail}
                  </span>
                ) : null}
              </span>
              <SubagentActivityIndicator count={displayedSubagentCount} />
            </button>
          }
        />
        <PopoverPopup
          align="center"
          className="composer-activity-popover-shell max-w-none p-0 before:hidden"
          side="top"
          sideOffset={8}
          viewportClassName="overflow-visible p-0! [--viewport-inline-padding:0px]"
        >
          <ComposerActivityPanel
            details={props.details}
            isActive={props.isActive}
            theme={props.theme}
          />
        </PopoverPopup>
      </Popover>
    </div>
  );
});
