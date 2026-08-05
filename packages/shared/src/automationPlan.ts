import { extractJsonObject } from "./schemaJson.ts";

export const AUTOMATION_PLAN_EFFORTS = ["low", "medium", "high", "xhigh", "max", "ultra"] as const;
export type AutomationPlanEffort = (typeof AUTOMATION_PLAN_EFFORTS)[number];

export const AUTOMATION_PLAN_TASK_ROLES = ["worker", "visual"] as const;
export type AutomationPlanTaskRole = (typeof AUTOMATION_PLAN_TASK_ROLES)[number];

export interface AutomationPlanTask {
  readonly key: string;
  readonly title: string;
  readonly goal: string;
  readonly acceptanceCriteria: ReadonlyArray<string>;
  readonly dependsOn: ReadonlyArray<string>;
  readonly changeScopes: ReadonlyArray<string>;
  readonly role: AutomationPlanTaskRole;
  /** Legacy task-level override. New plans should select a workflow role instead. */
  readonly model?: string;
  /** Legacy task-level override. Present only when `model` is also present. */
  readonly reasoningEffort?: AutomationPlanEffort;
  readonly verification: ReadonlyArray<string>;
}

export interface AutomationPlan {
  readonly summary: string;
  readonly tasks: ReadonlyArray<AutomationPlanTask>;
}

export interface AutomationVerificationReportCheck {
  readonly check: string;
  readonly detail: string;
}

export interface AutomationVerificationReport {
  readonly status: "passed" | "failed";
  readonly summary: string;
  readonly checks: ReadonlyArray<AutomationVerificationReportCheck>;
}

export interface AutomationFinalAuditReport {
  readonly status: "complete" | "repair-required" | "needs-input";
  readonly summary: string;
  readonly failedCriteria: ReadonlyArray<string>;
  readonly remainingRisks: ReadonlyArray<string>;
  readonly followUpTasks: ReadonlyArray<{
    readonly title: string;
    readonly goal: string;
    readonly role: AutomationPlanTaskRole;
  }>;
}

export interface AutomationIntegrationReport {
  readonly status: "integrated" | "failed" | "needs-input";
  readonly summary: string;
  readonly mergedBranches: ReadonlyArray<string>;
  readonly conflictsResolved: ReadonlyArray<{ readonly path: string; readonly resolution: string }>;
  readonly evidence: ReadonlyArray<AutomationVerificationReportCheck>;
  readonly remainingRisks: ReadonlyArray<string>;
}

const MAX_PLAN_TASKS = 8;
const MAX_SUMMARY_LENGTH = 2_000;
const MAX_TASK_KEY_LENGTH = 128;
const MAX_TASK_TITLE_LENGTH = 240;
const MAX_TASK_GOAL_LENGTH = 20_000;
const MAX_ACCEPTANCE_CRITERIA = 24;
const MAX_ACCEPTANCE_CRITERION_LENGTH = 2_000;
const MAX_DEPENDENCIES = 16;
const MAX_CHANGE_SCOPES = 32;
const MAX_CHANGE_SCOPE_LENGTH = 512;
const MAX_VERIFICATION_CHECKS = 24;
const MAX_VERIFICATION_CHECK_LENGTH = 1_000;
const MAX_VERIFICATION_DETAIL_LENGTH = 2_000;
const RESERVED_AUTOMATION_TASK_KEYS = new Set(["__integration__", "__final_audit__"]);

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maximum ? trimmed : null;
}

function boundedStringArray(
  value: unknown,
  maximumItems: number,
  maximumItemLength: number,
  options: { readonly requireItem?: boolean; readonly unique?: boolean } = {},
): ReadonlyArray<string> | null {
  if (!Array.isArray(value) || value.length > maximumItems) return null;
  if (options.requireItem === true && value.length === 0) return null;
  const decoded: string[] = [];
  for (const item of value) {
    const entry = boundedString(item, maximumItemLength);
    if (entry === null) return null;
    decoded.push(entry);
  }
  if (options.unique === true && new Set(decoded).size !== decoded.length) return null;
  return decoded;
}

function jsonCandidate(text: string): string | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text)?.[1];
  const candidate = extractJsonObject(fenced ?? text);
  return candidate.startsWith("{") ? candidate : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const candidate = jsonCandidate(text);
  if (candidate === null) return null;
  try {
    const decoded: unknown = JSON.parse(candidate);
    return typeof decoded === "object" && decoded !== null && !Array.isArray(decoded)
      ? (decoded as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function hasDependencyCycle(tasks: ReadonlyArray<AutomationPlanTask>): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const dependencies = new Map(tasks.map((task) => [task.key, task.dependsOn]));
  const visit = (key: string): boolean => {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    if ((dependencies.get(key) ?? []).some(visit)) return true;
    visiting.delete(key);
    visited.add(key);
    return false;
  };
  return tasks.some((task) => visit(task.key));
}

function orderTasksByDependencies(
  tasks: ReadonlyArray<AutomationPlanTask>,
): ReadonlyArray<AutomationPlanTask> {
  const pending = new Map(tasks.map((task) => [task.key, task]));
  const ordered: AutomationPlanTask[] = [];
  const completed = new Set<string>();

  while (pending.size > 0) {
    const ready = tasks.filter(
      (task) =>
        pending.has(task.key) && task.dependsOn.every((dependency) => completed.has(dependency)),
    );
    // parseAutomationPlan validates references and cycles before ordering, so
    // this guard is only a defensive fallback for future parser changes.
    if (ready.length === 0) return tasks;
    for (const task of ready) {
      pending.delete(task.key);
      completed.add(task.key);
      ordered.push(task);
    }
  }

  return ordered;
}

/**
 * Decode the bounded task graph returned by an autonomous planning turn.
 *
 * New plans assign each task to the workflow's `worker` or `visual` role.
 * Plans produced by the older prompt remain readable when they provide both a
 * model slug and reasoning effort; those tasks default to the worker role.
 */
export function parseAutomationPlan(text: string): AutomationPlan | null {
  const record = parseJsonObject(text);
  if (record === null) return null;
  const summary = boundedString(record.summary, MAX_SUMMARY_LENGTH);
  if (
    summary === null ||
    !Array.isArray(record.tasks) ||
    record.tasks.length === 0 ||
    record.tasks.length > MAX_PLAN_TASKS
  ) {
    return null;
  }

  const tasks: AutomationPlanTask[] = [];
  for (const value of record.tasks) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const task = value as Record<string, unknown>;
    const key = boundedString(task.key, MAX_TASK_KEY_LENGTH);
    const title = boundedString(task.title, MAX_TASK_TITLE_LENGTH);
    const goal = boundedString(task.goal, MAX_TASK_GOAL_LENGTH);
    const acceptanceCriteria = boundedStringArray(
      task.acceptanceCriteria,
      MAX_ACCEPTANCE_CRITERIA,
      MAX_ACCEPTANCE_CRITERION_LENGTH,
      { requireItem: true },
    );
    const dependsOn = boundedStringArray(task.dependsOn, MAX_DEPENDENCIES, MAX_TASK_KEY_LENGTH, {
      unique: true,
    });
    const changeScopes = boundedStringArray(
      task.changeScopes,
      MAX_CHANGE_SCOPES,
      MAX_CHANGE_SCOPE_LENGTH,
      { requireItem: true, unique: true },
    );
    const verification = boundedStringArray(
      task.verification,
      MAX_VERIFICATION_CHECKS,
      MAX_VERIFICATION_DETAIL_LENGTH,
      { requireItem: true },
    );
    const roleValue = task.role ?? "worker";
    const role =
      typeof roleValue === "string" &&
      AUTOMATION_PLAN_TASK_ROLES.includes(roleValue as AutomationPlanTaskRole)
        ? (roleValue as AutomationPlanTaskRole)
        : null;

    const legacyModel = task.model === undefined ? undefined : boundedString(task.model, 256);
    const legacyEffort = task.reasoningEffort;
    const hasLegacyModel = legacyModel !== undefined;
    const hasLegacyEffort = legacyEffort !== undefined;
    const reasoningEffort =
      typeof legacyEffort === "string" &&
      AUTOMATION_PLAN_EFFORTS.includes(legacyEffort as AutomationPlanEffort)
        ? (legacyEffort as AutomationPlanEffort)
        : null;

    if (
      key === null ||
      RESERVED_AUTOMATION_TASK_KEYS.has(key) ||
      title === null ||
      goal === null ||
      acceptanceCriteria === null ||
      dependsOn === null ||
      changeScopes === null ||
      verification === null ||
      role === null ||
      hasLegacyModel !== hasLegacyEffort ||
      (hasLegacyModel && (legacyModel === null || reasoningEffort === null))
    ) {
      return null;
    }

    tasks.push({
      key,
      title,
      goal,
      acceptanceCriteria,
      dependsOn,
      changeScopes,
      role,
      ...(legacyModel ? { model: legacyModel, reasoningEffort: reasoningEffort! } : {}),
      verification,
    });
  }

  const keys = new Set(tasks.map((task) => task.key));
  if (keys.size !== tasks.length) return null;
  if (
    tasks.some((task) =>
      task.dependsOn.some((dependency) => dependency === task.key || !keys.has(dependency)),
    ) ||
    hasDependencyCycle(tasks)
  ) {
    return null;
  }
  // Materializers configure dependencies before dependents. Normalize valid
  // DAGs here so planner presentation order can never make an executable plan
  // fail during durable task configuration.
  return { summary, tasks: orderTasksByDependencies(tasks) };
}

/** Decode the evidence report returned by an autonomous verification turn. */
export function parseAutomationVerificationReport(
  text: string,
): AutomationVerificationReport | null {
  const record = parseJsonObject(text);
  if (record === null) return null;
  const status: AutomationVerificationReport["status"] | null =
    record.status === "passed" || record.status === "failed" ? record.status : null;
  const summary = boundedString(record.summary, MAX_SUMMARY_LENGTH);
  if (
    status === null ||
    summary === null ||
    !Array.isArray(record.checks) ||
    record.checks.length === 0 ||
    record.checks.length > MAX_VERIFICATION_CHECKS
  ) {
    return null;
  }
  const checks: AutomationVerificationReportCheck[] = [];
  for (const value of record.checks) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const check = value as Record<string, unknown>;
    const label = boundedString(check.check, MAX_VERIFICATION_CHECK_LENGTH);
    const detail = boundedString(check.detail, MAX_VERIFICATION_DETAIL_LENGTH);
    if (label === null || detail === null) return null;
    checks.push({ check: label, detail });
  }
  if (new Set(checks.map((check) => check.check)).size !== checks.length) return null;
  return { status, summary, checks };
}

/**
 * A verifier must identify every acceptance criterion explicitly. Requiring an
 * exact normalized label prevents a generic successful command from being
 * mistaken for evidence that an unrelated product criterion was inspected.
 */
export function automationVerificationCoversCriteria(
  report: AutomationVerificationReport,
  criteria: ReadonlyArray<string>,
): boolean {
  const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLowerCase();
  const labels = new Set(report.checks.map((check) => normalize(check.check)));
  return criteria.every((criterion) => labels.has(normalize(criterion)));
}

/** Decode the final orchestrator verdict for an integrated workflow. */
export function parseAutomationFinalAuditReport(text: string): AutomationFinalAuditReport | null {
  const record = parseJsonObject(text);
  if (record === null) return null;
  const status =
    record.status === "complete" ||
    record.status === "repair-required" ||
    record.status === "needs-input"
      ? record.status
      : null;
  const summary = boundedString(record.summary, MAX_SUMMARY_LENGTH);
  const failedCriteria = boundedStringArray(
    record.failedCriteria,
    MAX_ACCEPTANCE_CRITERIA,
    MAX_ACCEPTANCE_CRITERION_LENGTH,
  );
  const remainingRisks = boundedStringArray(
    record.remainingRisks,
    MAX_VERIFICATION_CHECKS,
    MAX_VERIFICATION_DETAIL_LENGTH,
  );
  if (
    status === null ||
    summary === null ||
    failedCriteria === null ||
    remainingRisks === null ||
    !Array.isArray(record.followUpTasks) ||
    record.followUpTasks.length > MAX_PLAN_TASKS
  ) {
    return null;
  }

  const followUpTasks: AutomationFinalAuditReport["followUpTasks"][number][] = [];
  for (const value of record.followUpTasks) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const task = value as Record<string, unknown>;
    const title = boundedString(task.title, MAX_TASK_TITLE_LENGTH);
    const goal = boundedString(task.goal, MAX_TASK_GOAL_LENGTH);
    const role =
      typeof task.role === "string" &&
      AUTOMATION_PLAN_TASK_ROLES.includes(task.role as AutomationPlanTaskRole)
        ? (task.role as AutomationPlanTaskRole)
        : null;
    if (title === null || goal === null || role === null) return null;
    followUpTasks.push({ title, goal, role });
  }

  if (status === "complete" && failedCriteria.length > 0) return null;
  if (status === "repair-required" && failedCriteria.length === 0) return null;
  return { status, summary, failedCriteria, remainingRisks, followUpTasks };
}

/** Decode the integration agent's structured result instead of trusting turn completion. */
export function parseAutomationIntegrationReport(text: string): AutomationIntegrationReport | null {
  const record = parseJsonObject(text);
  if (record === null) return null;
  const status =
    record.status === "integrated" || record.status === "failed" || record.status === "needs-input"
      ? record.status
      : null;
  const summary = boundedString(record.summary, MAX_SUMMARY_LENGTH);
  const mergedBranches = boundedStringArray(
    record.mergedBranches,
    MAX_DEPENDENCIES,
    MAX_CHANGE_SCOPE_LENGTH,
    { unique: true },
  );
  const remainingRisks = boundedStringArray(
    record.remainingRisks,
    MAX_VERIFICATION_CHECKS,
    MAX_VERIFICATION_DETAIL_LENGTH,
  );
  if (
    status === null ||
    summary === null ||
    mergedBranches === null ||
    remainingRisks === null ||
    !Array.isArray(record.conflictsResolved) ||
    record.conflictsResolved.length > MAX_VERIFICATION_CHECKS ||
    !Array.isArray(record.evidence) ||
    record.evidence.length === 0 ||
    record.evidence.length > MAX_VERIFICATION_CHECKS
  ) {
    return null;
  }

  const conflictsResolved: AutomationIntegrationReport["conflictsResolved"][number][] = [];
  for (const value of record.conflictsResolved) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const conflict = value as Record<string, unknown>;
    const path = boundedString(conflict.path, MAX_CHANGE_SCOPE_LENGTH);
    const resolution = boundedString(conflict.resolution, MAX_VERIFICATION_DETAIL_LENGTH);
    if (path === null || resolution === null) return null;
    conflictsResolved.push({ path, resolution });
  }

  const evidence: AutomationVerificationReportCheck[] = [];
  for (const value of record.evidence) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    const check = boundedString(item.check, MAX_VERIFICATION_CHECK_LENGTH);
    const detail = boundedString(item.detail, MAX_VERIFICATION_DETAIL_LENGTH);
    if (check === null || detail === null) return null;
    evidence.push({ check, detail });
  }
  return { status, summary, mergedBranches, conflictsResolved, evidence, remainingRisks };
}
