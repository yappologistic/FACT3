import type { OrchestrationProjectAutomationPolicy, OrchestrationThread } from "@t3tools/contracts";

export function automationConcurrencyLimit(policy: OrchestrationProjectAutomationPolicy): number {
  return policy.createWorktrees ? policy.maxConcurrentRuns : 1;
}

export function automationAvailableSlots(input: {
  readonly policy: OrchestrationProjectAutomationPolicy;
  readonly tasks: ReadonlyArray<OrchestrationThread>;
}): number {
  const active = input.tasks.filter(
    (thread) =>
      thread.automation?.stage === "running" || thread.automation?.stage === "needs-input",
  ).length;
  return Math.max(0, automationConcurrencyLimit(input.policy) - active);
}

export function selectRunnableAutomationTasks(input: {
  readonly tasks: ReadonlyArray<OrchestrationThread>;
  readonly availableSlots: number;
}): ReadonlyArray<OrchestrationThread> {
  if (input.availableSlots <= 0) return [];
  const completeIds = new Set(
    input.tasks
      .filter((thread) => thread.automation?.stage === "complete")
      .map((thread) => thread.id),
  );
  return input.tasks
    .filter(
      (thread) =>
        thread.automation?.stage === "ready" &&
        thread.automation.dependencies.every((dependency) => completeIds.has(dependency)),
    )
    .slice(0, input.availableSlots);
}

export function automationCanRetry(thread: OrchestrationThread): boolean {
  return Boolean(thread.automation && thread.automation.attempt < thread.automation.maxAttempts);
}

/**
 * Finds the checkpoint produced by the automation dispatch represented by the
 * current heartbeat. Completed turns are intentionally removed from the thread
 * shell's `latestTurn`, so the checkpoint timestamp is the durable fallback.
 */
export function automationDispatchCompletion(thread: OrchestrationThread) {
  const automation = thread.automation;
  const lastHeartbeatAt = automation?.lastHeartbeatAt;
  if (!lastHeartbeatAt) return null;

  const latestTurn = thread.latestTurn;
  if (latestTurn && latestTurn.requestedAt >= lastHeartbeatAt) {
    const exactCheckpoint = thread.checkpoints.find(
      (checkpoint) => checkpoint.turnId === latestTurn.turnId,
    );
    if (exactCheckpoint) return exactCheckpoint;
  }

  return (
    thread.checkpoints
      .filter((checkpoint) => checkpoint.completedAt >= lastHeartbeatAt)
      .toSorted((left, right) => right.completedAt.localeCompare(left.completedAt))[0] ?? null
  );
}
