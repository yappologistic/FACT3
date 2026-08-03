import type { ModelSelection } from "@t3tools/contracts";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import { useState } from "react";

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
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { newThreadId } from "~/lib/utils";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { DEFAULT_AUTOMATION_POLICY } from "./KanbanAutomationDialogs";
import { OpenTuiSpinner } from "./OpenTuiSpinner";

function shortPlanTitle(goal: string): string {
  const compact = goal.replace(/\s+/g, " ").trim();
  return `Plan · ${compact.length > 52 ? `${compact.slice(0, 49)}…` : compact}`;
}

export function KanbanProjectGoalDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: EnvironmentProject;
  readonly baseBranch: string;
  readonly modelSelection: ModelSelection | null;
}) {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const configureAutomation = useAtomCommand(threadEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const [goal, setGoal] = useState("");
  const [baseBranch, setBaseBranch] = useState(props.baseBranch);
  const [submitting, setSubmitting] = useState(false);
  const policy = props.project.automationPolicy ?? DEFAULT_AUTOMATION_POLICY;
  const canSubmit =
    props.modelSelection !== null &&
    goal.trim().length > 0 &&
    baseBranch.trim().length > 0 &&
    !submitting;

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
        title: shortPlanTitle(goal),
        modelSelection: props.modelSelection,
        runtimeMode: "auto",
        interactionMode: "plan",
        branch: baseBranch.trim(),
        worktreePath: null,
        createdAt,
      },
    });
    if (createResult._tag === "Failure") {
      setSubmitting(false);
      toastManager.add({
        type: "error",
        title: "Could not create project plan",
        description: "No planning task was added. Try again.",
      });
      return;
    }
    const configureResult = await configureAutomation({
      environmentId: props.project.environmentId,
      input: {
        threadId,
        automation: {
          taskKind: "planning",
          goal: goal.trim(),
          acceptanceCriteria: [
            "The plan contains dependency-safe tasks with narrow ownership scopes.",
            "Every task has an explicit model, acceptance criteria, and verification evidence.",
          ],
          dependencies: [],
          changeScopes: [],
          baseBranch: baseBranch.trim(),
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
      await deleteThread({
        environmentId: props.project.environmentId,
        input: { threadId },
      });
      setSubmitting(false);
      toastManager.add({
        type: "error",
        title: "Could not configure project plan",
        description: "The incomplete planning thread was removed.",
      });
      return;
    }
    setSubmitting(false);
    setGoal("");
    props.onOpenChange(false);
    toastManager.add({
      type: "success",
      title: policy.enabled ? "Planning started" : "Planning task queued",
      description: policy.enabled
        ? "The planning agent is inspecting the repository. Review its proposal before any implementation starts."
        : "Start Autopilot when you want the planning agent to inspect the repository.",
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !submitting && props.onOpenChange(open)}>
      <DialogPopup className="max-w-xl overflow-hidden">
        <DialogHeader>
          <DialogTitle className="text-lg">Plan a project goal</DialogTitle>
          <DialogDescription>
            Give FACT3 one outcome. A planning agent will inspect the repository and propose a
            dependency-safe execution plan for your approval. It will not edit files.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4">
          <div>
            <Label htmlFor="kanban-project-goal" className="mb-1.5 block text-xs font-medium">
              Project goal
            </Label>
            <Textarea
              id="kanban-project-goal"
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Build an accessible project settings experience with persistence, tests, and migration safety."
              className="min-h-32"
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="kanban-plan-base-branch" className="mb-1.5 block text-xs font-medium">
              Plan from branch
            </Label>
            <Input
              id="kanban-plan-base-branch"
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
            />
          </div>
          <div className="rounded-[14px] border border-foreground/[0.07] bg-foreground/[0.025] px-3.5 py-3 text-[11px] leading-4 text-muted-foreground">
            The proposal will assign task order, likely file ownership, the model and reasoning
            level, plus verification checks. Implementation begins only after you approve it.
          </div>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? <OpenTuiSpinner name="dots" /> : null}
            {policy.enabled ? "Start planning" : "Queue planning task"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
