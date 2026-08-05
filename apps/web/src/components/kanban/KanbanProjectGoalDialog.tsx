import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type {
  ModelSelection,
  OrchestrationAutonomousWorkflowMode,
  OrchestrationAutonomousWorkflowRoles,
  ServerProvider,
} from "@t3tools/contracts";
import type { UnifiedSettings } from "@t3tools/contracts/settings";
import { ChevronRightIcon, WorkflowIcon } from "lucide-react";
import { useMemo, useState } from "react";

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
import { Radio, RadioGroup } from "~/components/ui/radio-group";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { cn, newThreadId } from "~/lib/utils";
import { projectEnvironment } from "~/state/projects";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { DEFAULT_AUTOMATION_POLICY } from "./KanbanAutomationDialogs";
import { OpenTuiSpinner } from "./OpenTuiSpinner";
import {
  KanbanModelSelectionControls,
  resolveKanbanModelSelection,
} from "./KanbanModelSelectionControls";
import { KanbanBranchValidationMessage, useKanbanBranchValidation } from "./KanbanBranchValidation";

type ConfigurableWorkflowRole = Exclude<keyof OrchestrationAutonomousWorkflowRoles, "orchestrator">;
type WorkflowRoleOverrides = Partial<
  Pick<OrchestrationAutonomousWorkflowRoles, ConfigurableWorkflowRole>
>;

export const WORKFLOW_ROLE_DEFINITIONS: ReadonlyArray<{
  readonly role: ConfigurableWorkflowRole;
  readonly label: string;
  readonly description: string;
}> = [
  {
    role: "planner",
    label: "Planner",
    description: "Turns the objective into dependency-safe tasks and ownership scopes.",
  },
  {
    role: "worker",
    label: "Workers",
    description: "Implement the planned tasks in isolated worktrees.",
  },
  {
    role: "verifier",
    label: "Verifier",
    description: "Checks acceptance criteria and records fresh evidence.",
  },
  {
    role: "integrator",
    label: "Integrator",
    description: "Combines verified branches, resolves conflicts, and checks the result.",
  },
  {
    role: "visual",
    label: "Visual specialist",
    description: "Handles UI work and visual QA when the plan needs it.",
  },
];

export function resolveWorkflowRoles(
  orchestrator: ModelSelection,
  overrides: WorkflowRoleOverrides,
): OrchestrationAutonomousWorkflowRoles {
  return {
    orchestrator,
    planner: overrides.planner ?? orchestrator,
    worker: overrides.worker ?? orchestrator,
    verifier: overrides.verifier ?? orchestrator,
    integrator: overrides.integrator ?? orchestrator,
    visual: overrides.visual ?? orchestrator,
  };
}

function shortPlanTitle(goal: string): string {
  const compact = goal.replace(/\s+/g, " ").trim();
  return `Workflow · ${compact.length > 48 ? `${compact.slice(0, 45)}…` : compact}`;
}

function RequiredLabel(props: { readonly htmlFor: string; readonly children: string }) {
  return (
    <Label
      htmlFor={props.htmlFor}
      className="mb-1.5 flex w-full items-center justify-between text-[12px] font-medium leading-4 text-foreground/78"
    >
      <span>{props.children}</span>
      <span className="text-[10px] font-normal uppercase tracking-wide text-muted-foreground/72">
        Required
      </span>
    </Label>
  );
}

export function KanbanProjectGoalDialog(props: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly project: EnvironmentProject;
  readonly baseBranch: string;
  readonly modelSelection: ModelSelection | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly settings: UnifiedSettings;
}) {
  const createThread = useAtomCommand(threadEnvironment.create, { reportFailure: false });
  const deleteThread = useAtomCommand(threadEnvironment.delete, { reportFailure: false });
  const configureThreadAutomation = useAtomCommand(threadEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const configureProjectAutomation = useAtomCommand(projectEnvironment.configureAutomation, {
    reportFailure: false,
  });
  const [goal, setGoal] = useState("");
  const [baseBranch, setBaseBranch] = useState(props.baseBranch);
  const [mode, setMode] = useState<OrchestrationAutonomousWorkflowMode>("review");
  const [orchestrator, setOrchestrator] = useState<ModelSelection | null>(() =>
    resolveKanbanModelSelection(props.providers, props.modelSelection),
  );
  const [roleOverrides, setRoleOverrides] = useState<WorkflowRoleOverrides>({});
  const [submitting, setSubmitting] = useState(false);
  const branchValidation = useKanbanBranchValidation(props.project, baseBranch);
  const policy = props.project.automationPolicy ?? DEFAULT_AUTOMATION_POLICY;
  const workflowRoles = useMemo(
    () => (orchestrator ? resolveWorkflowRoles(orchestrator, roleOverrides) : null),
    [orchestrator, roleOverrides],
  );
  const customRoleCount = Object.keys(roleOverrides).length;
  const canSubmit =
    workflowRoles !== null && goal.trim().length > 0 && branchValidation.canContinue && !submitting;

  const setCustomRole = (role: ConfigurableWorkflowRole, selection: ModelSelection | null) => {
    setRoleOverrides((current) => {
      const next = { ...current };
      if (selection) next[role] = selection;
      else delete next[role];
      return next;
    });
  };

  const reset = () => {
    setGoal("");
    setBaseBranch(props.baseBranch);
    setMode("review");
    setOrchestrator(resolveKanbanModelSelection(props.providers, props.modelSelection));
    setRoleOverrides({});
  };

  const submit = async () => {
    if (!canSubmit || workflowRoles === null) return;
    setSubmitting(true);
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const objective = goal.trim();
    const branch = baseBranch.trim();
    const workflowPolicy = {
      ...policy,
      enabled: true,
      createWorktrees: true,
      requireVerification: true,
    };
    const policyNeedsUpdate =
      !policy.enabled || !policy.createWorktrees || !policy.requireVerification;
    const enableResult = policyNeedsUpdate
      ? await configureProjectAutomation({
          environmentId: props.project.environmentId,
          input: { projectId: props.project.id, policy: workflowPolicy },
        })
      : null;
    if (enableResult?._tag === "Failure") {
      setSubmitting(false);
      toastManager.add({
        type: "error",
        title: "Could not prepare autonomous workflow",
        description:
          "FACT3 did not queue any work because dedicated worktrees and verification could not be enabled safely.",
      });
      return;
    }
    const createResult = await createThread({
      environmentId: props.project.environmentId,
      input: {
        threadId,
        projectId: props.project.id,
        title: shortPlanTitle(objective),
        modelSelection: workflowRoles.orchestrator,
        runtimeMode: "full-access",
        interactionMode: "plan",
        branch,
        worktreePath: null,
        createdAt,
      },
    });
    if (createResult._tag === "Failure") {
      setSubmitting(false);
      toastManager.add({
        type: "error",
        title: "Could not start autonomous workflow",
        description: "No workflow was created. Try again.",
      });
      return;
    }
    const configureResult = await configureThreadAutomation({
      environmentId: props.project.environmentId,
      input: {
        threadId,
        automation: {
          taskKind: "planning",
          workflowId: threadId,
          workflowTaskKey: null,
          role: "orchestrator",
          workflowConfig: { mode, roles: workflowRoles },
          goal: objective,
          acceptanceCriteria: [
            "The plan contains dependency-safe tasks with narrow ownership scopes.",
            "Every task has explicit acceptance criteria and verification evidence.",
            "Verified task branches are integrated and the combined result is checked.",
          ],
          dependencies: [],
          changeScopes: [],
          baseBranch: branch,
          stage: "ready",
          phase: "implementation",
          attempt: 0,
          maxAttempts: policy.defaultMaxAttempts,
          maxRuntimeMinutes: policy.defaultMaxRuntimeMinutes,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          lastError: null,
          feedback: null,
          verification: { status: "pending", summary: null, evidence: [], completedAt: null },
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
        title: "Could not configure autonomous workflow",
        description: "The incomplete workflow was removed so it will not clutter the board.",
      });
      return;
    }

    setSubmitting(false);
    reset();
    props.onOpenChange(false);
    toastManager.add({
      type: "success",
      title: "Autonomous workflow started",
      description:
        mode === "automatic"
          ? "FACT3 is planning the work and will continue through verified integration."
          : "FACT3 is planning the work and will pause at the configured review checkpoints.",
    });
  };

  return (
    <Dialog open={props.open} onOpenChange={(open) => !submitting && props.onOpenChange(open)}>
      <DialogPopup className="max-w-[42rem] overflow-hidden">
        <DialogHeader className="gap-1.5 px-6 pb-3.5 pt-5">
          <DialogTitle className="flex items-center gap-2 text-base font-medium leading-5">
            <WorkflowIcon aria-hidden className="size-4 text-muted-foreground" />
            Autonomous workflow
          </DialogTitle>
          <DialogDescription className="max-w-[37rem] text-[12px] leading-5 text-muted-foreground/76">
            Describe one outcome. FACT3 will plan the work, create isolated worktrees, coordinate
            agents, verify the result, and integrate it according to your review mode.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-4 px-6 pb-4 pt-0">
          <div>
            <RequiredLabel htmlFor="kanban-workflow-objective">Objective</RequiredLabel>
            <Textarea
              id="kanban-workflow-objective"
              required
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="Build an accessible project settings experience with persistence, tests, and migration safety."
              className="min-h-24"
              autoFocus
            />
          </div>
          <div>
            <RequiredLabel htmlFor="kanban-workflow-base-branch">Base branch</RequiredLabel>
            <Input
              id="kanban-workflow-base-branch"
              required
              value={baseBranch}
              onChange={(event) => setBaseBranch(event.target.value)}
              aria-describedby="kanban-workflow-base-branch-status"
            />
            <KanbanBranchValidationMessage
              id="kanban-workflow-base-branch-status"
              validation={branchValidation}
            />
          </div>

          <div>
            <p
              id="kanban-workflow-mode-label"
              className="mb-1.5 text-[12px] font-medium leading-4 text-foreground/78"
            >
              Autonomy mode
            </p>
            <RadioGroup
              value={mode}
              onValueChange={(value) => setMode(value as OrchestrationAutonomousWorkflowMode)}
              aria-labelledby="kanban-workflow-mode-label"
              className="grid gap-2 sm:grid-cols-2"
            >
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-[12px] border px-3 py-2.5 transition-colors",
                  mode === "review"
                    ? "border-primary/30 bg-primary/[0.045]"
                    : "border-foreground/[0.07] bg-foreground/[0.018] hover:bg-foreground/[0.035]",
                )}
              >
                <Radio value="review" className="mt-0.5" />
                <span>
                  <span className="block text-[12px] font-medium text-foreground/84">
                    Review checkpoints
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground/74">
                    Pause after planning and before final integration.
                  </span>
                </span>
              </label>
              <label
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 rounded-[12px] border px-3 py-2.5 transition-colors",
                  mode === "automatic"
                    ? "border-primary/30 bg-primary/[0.045]"
                    : "border-foreground/[0.07] bg-foreground/[0.018] hover:bg-foreground/[0.035]",
                )}
              >
                <Radio value="automatic" className="mt-0.5" />
                <span>
                  <span className="block text-[12px] font-medium text-foreground/84">
                    Fully autonomous
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-4 text-muted-foreground/74">
                    Continue through verified integration without routine review.
                  </span>
                </span>
              </label>
            </RadioGroup>
          </div>

          <KanbanModelSelectionControls
            providers={props.providers}
            settings={props.settings}
            value={orchestrator}
            onChange={setOrchestrator}
            label="Orchestrator runtime"
            triggerAriaLabel="Choose provider and model for the orchestrator"
            helpText="Coordinates the workflow. Provider, model, reasoning, and speed settings are preserved for this role."
          />

          <details className="group rounded-[12px] border border-foreground/[0.07] bg-foreground/[0.018] px-3 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[12px] font-medium leading-4 text-foreground/78 outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              <span className="flex items-center gap-2">
                <ChevronRightIcon
                  aria-hidden
                  className="size-3.5 text-muted-foreground/68 transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none"
                />
                Customize agent roles
              </span>
              <span className="text-[11px] font-normal text-muted-foreground/72">
                {customRoleCount > 0
                  ? `${customRoleCount} ${customRoleCount === 1 ? "override" : "overrides"}`
                  : "Inherits by default"}
              </span>
            </summary>
            <div className="mt-3 divide-y divide-foreground/[0.055] border-t border-foreground/[0.055] pt-1">
              {WORKFLOW_ROLE_DEFINITIONS.map((definition) => {
                const selection = roleOverrides[definition.role];
                return (
                  <div key={definition.role} className="py-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[12px] font-medium text-foreground/84">
                          {definition.label}
                        </p>
                        <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground/72">
                          {definition.description}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="shrink-0"
                        onClick={() =>
                          setCustomRole(definition.role, selection ? null : orchestrator)
                        }
                        disabled={!orchestrator}
                      >
                        {selection ? "Use orchestrator" : "Customize"}
                      </Button>
                    </div>
                    {selection ? (
                      <div className="mt-3 border-t border-foreground/[0.055] pt-3">
                        <KanbanModelSelectionControls
                          providers={props.providers}
                          settings={props.settings}
                          value={selection}
                          onChange={(nextSelection) =>
                            setCustomRole(definition.role, nextSelection)
                          }
                          label={`${definition.label} runtime`}
                          triggerAriaLabel={`Choose provider and model for ${definition.label.toLowerCase()}`}
                          helpText="This role overrides the orchestrator runtime for this workflow."
                        />
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </details>

          <p className="border-t border-foreground/[0.065] pt-3 text-[11px] leading-4 text-muted-foreground/76">
            {mode === "automatic"
              ? "Fully autonomous continues through verified integration; permissions and unresolved decisions still pause it."
              : "Review checkpoints pause after planning and before final integration so you decide what ships."}{" "}
            Starting enables Autopilot, dedicated worktrees, and verification for this project.
          </p>
        </DialogPanel>
        <DialogFooter className="bg-muted/44 px-6 py-3.5">
          <Button variant="ghost" onClick={() => props.onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            className="disabled:bg-foreground/[0.06] disabled:text-muted-foreground/60 disabled:opacity-100"
            onClick={() => void submit()}
            disabled={!canSubmit}
          >
            {submitting ? <OpenTuiSpinner name="dots" /> : <WorkflowIcon aria-hidden />}
            {mode === "automatic" ? "Start and auto-integrate" : "Start with checkpoints"}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
