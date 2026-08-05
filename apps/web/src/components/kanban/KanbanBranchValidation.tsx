import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { VcsListRefsResult } from "@t3tools/contracts";
import { AlertTriangleIcon, CheckCircle2Icon } from "lucide-react";
import { useDeferredValue } from "react";

import { cn } from "~/lib/utils";
import { useBranches } from "~/state/queries";
import { OpenTuiSpinner } from "./OpenTuiSpinner";

export type KanbanBranchValidation = {
  readonly status: "empty" | "checking" | "valid" | "missing" | "not-repository" | "unavailable";
  readonly message: string;
  readonly canContinue: boolean;
};

export function resolveKanbanBranchValidation(input: {
  readonly branch: string;
  readonly data: VcsListRefsResult | null;
  readonly error: string | null;
  readonly pending: boolean;
}): KanbanBranchValidation {
  const branch = input.branch.trim();
  if (branch.length === 0) {
    return { status: "empty", message: "Enter an existing local branch.", canContinue: false };
  }
  if (input.data === null) {
    if (input.pending) {
      return { status: "checking", message: "Checking this branch…", canContinue: false };
    }
    if (input.error) {
      return {
        status: "unavailable",
        message:
          "Branch verification is temporarily unavailable. FACT3 will check again before creating worktrees.",
        canContinue: true,
      };
    }
    return { status: "checking", message: "Checking this branch…", canContinue: false };
  }
  if (!input.data.isRepo) {
    return {
      status: "not-repository",
      message: "This project is not a Git repository, so worktrees cannot be created yet.",
      canContinue: false,
    };
  }
  if (!input.data.refs.some((ref) => ref.name === branch && ref.isRemote !== true)) {
    return {
      status: "missing",
      message: "Branch not found. Choose an existing local branch before starting.",
      canContinue: false,
    };
  }
  return {
    status: "valid",
    message: "Branch found. Worktrees start here and verified changes return here.",
    canContinue: true,
  };
}

export function useKanbanBranchValidation(
  project: EnvironmentProject,
  branchValue: string,
): KanbanBranchValidation {
  const branch = branchValue.trim();
  const deferredBranch = useDeferredValue(branch);
  const result = useBranches({
    environmentId: project.environmentId,
    cwd: project.workspaceRoot,
    query: deferredBranch,
  });
  return resolveKanbanBranchValidation({
    branch,
    data: branch === deferredBranch ? result.data : null,
    error: result.error,
    pending: result.isPending || branch !== deferredBranch,
  });
}

export function KanbanBranchValidationMessage(props: {
  readonly id: string;
  readonly validation: KanbanBranchValidation;
}) {
  const invalid =
    props.validation.status === "missing" || props.validation.status === "not-repository";
  return (
    <p
      id={props.id}
      role={invalid ? "alert" : undefined}
      className={cn(
        "mt-1.5 flex items-start gap-1.5 text-[11px] leading-4 text-muted-foreground/76",
        props.validation.status === "valid" && "text-success",
        invalid && "text-destructive",
        props.validation.status === "unavailable" && "text-warning",
      )}
    >
      {props.validation.status === "checking" ? (
        <OpenTuiSpinner name="dots" className="mt-0.5 shrink-0" label="Checking base branch" />
      ) : props.validation.status === "valid" ? (
        <CheckCircle2Icon aria-hidden className="mt-0.5 size-3 shrink-0" />
      ) : props.validation.status === "unavailable" || invalid ? (
        <AlertTriangleIcon aria-hidden className="mt-0.5 size-3 shrink-0" />
      ) : null}
      <span>{props.validation.message}</span>
    </p>
  );
}
