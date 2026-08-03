import type {
  ModelSelection,
  OrchestrationProjectAutomationPolicy,
  ThreadId,
} from "@t3tools/contracts";
import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import { useMemo, useState, type ReactNode } from "react";

import { projectEnvironment } from "~/state/projects";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { newThreadId } from "~/lib/utils";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { OpenTuiSpinner } from "./OpenTuiSpinner";

export const DEFAULT_AUTOMATION_POLICY: OrchestrationProjectAutomationPolicy = {
  enabled: false,
  maxConcurrentRuns: 3,
  defaultMaxAttempts: 2,
  defaultMaxRuntimeMinutes: 120,
  createWorktrees: true,
  requireVerification: true,
  requireReview: true,
  deliveryMode: "local-commit",
};

function commandError(title: string, description: string) {
  toastManager.add({ type: "error", title, description });
}

function FieldLabel(props: { readonly htmlFor: string; readonly children: ReactNode }) {
  return (
    <Label htmlFor={props.htmlFor} className="mb-1.5 block text-xs font-medium text-foreground/82">
      {props.children}
    </Label>
  );
}

export function KanbanNewTaskDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: EnvironmentProject;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly baseBranch: string;
  readonly modelSelection: ModelSelection | null;
}) {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const configureAutomation = useAtomCommand(threadEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [criteria, setCriteria] = useState("");
  const [baseBranch, setBaseBranch] = useState(props.baseBranch);
  const [dependencies, setDependencies] = useState<ReadonlySet<ThreadId>>(new Set());
  const [maxAttempts, setMaxAttempts] = useState(
    props.project.automationPolicy?.defaultMaxAttempts ??
      DEFAULT_AUTOMATION_POLICY.defaultMaxAttempts,
  );
  const [maxRuntimeMinutes, setMaxRuntimeMinutes] = useState(
    props.project.automationPolicy?.defaultMaxRuntimeMinutes ??
      DEFAULT_AUTOMATION_POLICY.defaultMaxRuntimeMinutes,
  );
  const [submitting, setSubmitting] = useState(false);
  const dependencyOptions = useMemo(
    () =>
      props.threads.filter(
        (thread) =>
          thread.automation !== undefined &&
          thread.automation.stage !== "cancelled" &&
          thread.automation.stage !== "complete",
      ),
    [props.threads],
  );
  const canSubmit =
    props.modelSelection !== null &&
    title.trim().length > 0 &&
    goal.trim().length > 0 &&
    baseBranch.trim().length > 0 &&
    !submitting;

  const reset = () => {
    setTitle("");
    setGoal("");
    setCriteria("");
    setBaseBranch(props.baseBranch);
    setDependencies(new Set());
    setMaxAttempts(
      props.project.automationPolicy?.defaultMaxAttempts ??
        DEFAULT_AUTOMATION_POLICY.defaultMaxAttempts,
    );
    setMaxRuntimeMinutes(
      props.project.automationPolicy?.defaultMaxRuntimeMinutes ??
        DEFAULT_AUTOMATION_POLICY.defaultMaxRuntimeMinutes,
    );
  };

  const submit = async () => {
    if (!canSubmit || props.modelSelection === null) return;
    setSubmitting(true);
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const createResult = await createThread({
      environmentId: props.project.environmentId,
      input: {
        threadId,
        projectId: props.project.id,
        title: title.trim(),
        modelSelection: props.modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: baseBranch.trim(),
        worktreePath: null,
        createdAt,
      },
    });
    if (createResult._tag === "Failure") {
      setSubmitting(false);
      commandError("Could not create task", "The task thread was not created. Try again.");
      return;
    }

    const automationResult = await configureAutomation({
      environmentId: props.project.environmentId,
      input: {
        threadId,
        automation: {
          goal: goal.trim(),
          acceptanceCriteria: criteria
            .split("\n")
            .map((item) => item.trim().replace(/^[-*]\s*/, ""))
            .filter(Boolean),
          dependencies: [...dependencies],
          baseBranch: baseBranch.trim(),
          stage: "ready",
          phase: "implementation",
          attempt: 0,
          maxAttempts,
          maxRuntimeMinutes,
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
    if (automationResult._tag === "Failure") {
      await deleteThread({
        environmentId: props.project.environmentId,
        input: { threadId },
      });
      setSubmitting(false);
      commandError(
        "Could not configure task",
        "The incomplete task was rolled back so it will not clutter the board.",
      );
      return;
    }

    setSubmitting(false);
    props.onOpenChange(false);
    reset();
    toastManager.add({
      type: "success",
      title: props.project.automationPolicy?.enabled ? "Task queued" : "Task ready",
      description: props.project.automationPolicy?.enabled
        ? "Autopilot will start it when its dependencies and concurrency slot are ready."
        : "Turn on Autopilot when you want FACT3 to start queued work.",
    });
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={(open) => {
        if (!submitting) props.onOpenChange(open);
      }}
    >
      <DialogPopup className="max-w-xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-lg">New autonomous task</DialogTitle>
          <DialogDescription>
            Create one durable work item. FACT3 will run it in a dedicated worktree when Autopilot
            has capacity.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div>
            <FieldLabel htmlFor="kanban-task-title">Task name</FieldLabel>
            <Input
              id="kanban-task-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Implement account settings"
              autoFocus
            />
          </div>
          <div>
            <FieldLabel htmlFor="kanban-task-goal">Goal</FieldLabel>
            <Textarea
              id="kanban-task-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Describe the outcome the agent owns, including the user-facing behavior."
              className="min-h-24"
            />
          </div>
          <div>
            <FieldLabel htmlFor="kanban-task-criteria">Acceptance criteria</FieldLabel>
            <Textarea
              id="kanban-task-criteria"
              value={criteria}
              onChange={(event) => setCriteria(event.target.value)}
              placeholder={
                "One testable condition per line\nKeyboard navigation works\nFocused tests pass"
              }
              className="min-h-20"
            />
          </div>

          {dependencyOptions.length > 0 ? (
            <fieldset>
              <legend className="mb-1.5 text-xs font-medium text-foreground/82">Wait for</legend>
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.018] p-1.5">
                {dependencyOptions.map((thread) => {
                  const checked = dependencies.has(thread.id);
                  return (
                    <label
                      key={thread.id}
                      className="flex cursor-pointer items-center gap-2 rounded-[10px] px-2.5 py-2 text-xs text-foreground/82 hover:bg-foreground/[0.045]"
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(nextChecked) =>
                          setDependencies((current) => {
                            const next = new Set(current);
                            if (nextChecked) next.add(thread.id);
                            else next.delete(thread.id);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1 truncate">{thread.title}</span>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          ) : null}

          <details className="group rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.018] p-3">
            <summary className="cursor-pointer select-none text-xs font-medium text-foreground/78">
              Run limits
            </summary>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <FieldLabel htmlFor="kanban-task-base-branch">Base branch</FieldLabel>
                <Input
                  id="kanban-task-base-branch"
                  value={baseBranch}
                  onChange={(event) => setBaseBranch(event.target.value)}
                />
              </div>
              <div>
                <FieldLabel htmlFor="kanban-task-attempts">Attempts</FieldLabel>
                <Input
                  id="kanban-task-attempts"
                  nativeInput
                  type="number"
                  min={1}
                  max={5}
                  value={maxAttempts}
                  onChange={(event) =>
                    setMaxAttempts(Math.max(1, Math.min(5, Number(event.target.value) || 1)))
                  }
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="kanban-task-runtime">Runtime limit (minutes)</FieldLabel>
                <Input
                  id="kanban-task-runtime"
                  nativeInput
                  type="number"
                  min={5}
                  max={1440}
                  value={maxRuntimeMinutes}
                  onChange={(event) =>
                    setMaxRuntimeMinutes(
                      Math.max(5, Math.min(1440, Number(event.target.value) || 5)),
                    )
                  }
                />
              </div>
            </div>
          </details>

          <p className="text-[11px] leading-4 text-muted-foreground/72">
            Uses {props.modelSelection?.model ?? "the project default model"} with full access.
            Routine work proceeds automatically; provider approval and user-input requests still
            stop in Needs attention.
          </p>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? <OpenTuiSpinner name="dots" /> : null}
            Create task
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function PolicyToggle(props: {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.018] px-3.5 py-3">
      <span>
        <span className="block text-xs font-medium text-foreground/84">{props.label}</span>
        <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground/68">
          {props.description}
        </span>
      </span>
      <Switch checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </label>
  );
}

export function KanbanAutomationSettingsDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: EnvironmentProject;
}) {
  const configureAutomation = useAtomCommand(projectEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const [policy, setPolicy] = useState<OrchestrationProjectAutomationPolicy>(
    props.project.automationPolicy ?? DEFAULT_AUTOMATION_POLICY,
  );
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await configureAutomation({
      environmentId: props.project.environmentId,
      input: { projectId: props.project.id, policy },
    });
    setSaving(false);
    if (result._tag === "Failure") {
      commandError("Could not save Autopilot settings", "No settings were changed. Try again.");
      return;
    }
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !saving && props.onOpenChange(open)}>
      <DialogPopup className="max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-lg">Autopilot settings</DialogTitle>
          <DialogDescription>
            Bound parallel work, verification, review, and delivery for this project.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="kanban-policy-concurrency">Parallel runs</FieldLabel>
              <Input
                id="kanban-policy-concurrency"
                nativeInput
                type="number"
                min={1}
                max={8}
                value={policy.maxConcurrentRuns}
                disabled={!policy.createWorktrees}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    maxConcurrentRuns: Math.max(1, Math.min(8, Number(event.target.value) || 1)),
                  }))
                }
              />
            </div>
            <div>
              <FieldLabel htmlFor="kanban-policy-delivery">Finish with</FieldLabel>
              <Select
                value={policy.deliveryMode}
                onValueChange={(deliveryMode) => {
                  if (deliveryMode !== null) {
                    setPolicy((current) => ({ ...current, deliveryMode }));
                  }
                }}
              >
                <SelectTrigger id="kanban-policy-delivery">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value="local-commit">Local commit</SelectItem>
                  <SelectItem value="push-branch">Pushed branch</SelectItem>
                  <SelectItem value="pull-request">Pull request</SelectItem>
                </SelectPopup>
              </Select>
            </div>
          </div>

          <PolicyToggle
            label="Dedicated worktrees"
            description="Isolate concurrent agents so their edits cannot collide."
            checked={policy.createWorktrees}
            onCheckedChange={(createWorktrees) =>
              setPolicy((current) => ({ ...current, createWorktrees }))
            }
          />
          <PolicyToggle
            label="Verification pass"
            description="Run a separate evidence-focused turn before review."
            checked={policy.requireVerification}
            onCheckedChange={(requireVerification) =>
              setPolicy((current) => ({ ...current, requireVerification }))
            }
          />
          <PolicyToggle
            label="Human review gate"
            description="Stop completed work in Review instead of marking it done."
            checked={policy.requireReview}
            onCheckedChange={(requireReview) =>
              setPolicy((current) => ({ ...current, requireReview }))
            }
          />

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <FieldLabel htmlFor="kanban-policy-attempts">Default attempts</FieldLabel>
              <Input
                id="kanban-policy-attempts"
                nativeInput
                type="number"
                min={1}
                max={5}
                value={policy.defaultMaxAttempts}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    defaultMaxAttempts: Math.max(1, Math.min(5, Number(event.target.value) || 1)),
                  }))
                }
              />
            </div>
            <div>
              <FieldLabel htmlFor="kanban-policy-runtime">Default runtime (minutes)</FieldLabel>
              <Input
                id="kanban-policy-runtime"
                nativeInput
                type="number"
                min={5}
                max={1440}
                value={policy.defaultMaxRuntimeMinutes}
                onChange={(event) =>
                  setPolicy((current) => ({
                    ...current,
                    defaultMaxRuntimeMinutes: Math.max(
                      5,
                      Math.min(1440, Number(event.target.value) || 5),
                    ),
                  }))
                }
              />
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving ? <OpenTuiSpinner name="dots" /> : null}
            Save settings
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
