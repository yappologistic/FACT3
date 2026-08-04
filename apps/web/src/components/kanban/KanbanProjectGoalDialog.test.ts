import { ProviderInstanceId, type ModelSelection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveWorkflowRoles } from "./KanbanProjectGoalDialog";

describe("resolveWorkflowRoles", () => {
  const orchestrator = {
    instanceId: ProviderInstanceId.make("codex-primary"),
    model: "gpt-5.6-sol",
    options: [
      { id: "reasoningEffort", value: "high" },
      { id: "serviceTier", value: "priority" },
    ],
  } satisfies ModelSelection;

  it("persists a complete runtime for every role when they inherit", () => {
    expect(resolveWorkflowRoles(orchestrator, {})).toEqual({
      orchestrator,
      planner: orchestrator,
      worker: orchestrator,
      verifier: orchestrator,
      integrator: orchestrator,
      visual: orchestrator,
    });
  });

  it("keeps explicit role overrides without dropping reasoning or speed options", () => {
    const visual = {
      instanceId: ProviderInstanceId.make("opencode-visual"),
      model: "visual-model",
      options: [{ id: "reasoningEffort", value: "medium" }],
    } satisfies ModelSelection;

    expect(resolveWorkflowRoles(orchestrator, { visual })).toEqual({
      orchestrator,
      planner: orchestrator,
      worker: orchestrator,
      verifier: orchestrator,
      integrator: orchestrator,
      visual,
    });
  });
});
