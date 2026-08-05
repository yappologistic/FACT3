import { describe, expect, it } from "vite-plus/test";

import {
  automationVerificationCoversCriteria,
  parseAutomationFinalAuditReport,
  parseAutomationIntegrationReport,
  parseAutomationPlan,
  parseAutomationVerificationReport,
} from "./automationPlan.ts";

const workerTask = {
  key: "api",
  title: "Build the API",
  goal: "Add the project API without changing unrelated behavior.",
  acceptanceCriteria: ["The API returns persisted projects."],
  dependsOn: [],
  changeScopes: ["apps/server/src/projects"],
  role: "worker",
  verification: ["Run the focused project API test."],
};

describe("parseAutomationPlan", () => {
  it("decodes a role-based dependency graph from a fenced response", () => {
    const result = parseAutomationPlan(`Here is the proposed execution graph:
\`\`\`json
${JSON.stringify({
  summary: "Build and verify the project experience.",
  tasks: [
    workerTask,
    {
      ...workerTask,
      key: "ui",
      title: "Build the project UI",
      goal: "Create the project interface and connect it to the API.",
      dependsOn: ["api"],
      changeScopes: ["apps/web/src/components/projects"],
      role: "visual",
    },
  ],
})}
\`\`\`
No work has been started.`);

    expect(result).toEqual({
      summary: "Build and verify the project experience.",
      tasks: [
        workerTask,
        {
          ...workerTask,
          key: "ui",
          title: "Build the project UI",
          goal: "Create the project interface and connect it to the API.",
          dependsOn: ["api"],
          changeScopes: ["apps/web/src/components/projects"],
          role: "visual",
        },
      ],
    });
  });

  it("keeps older model assignments readable and defaults them to the worker role", () => {
    const result = parseAutomationPlan(
      JSON.stringify({
        summary: "Implement the API.",
        tasks: [{ ...workerTask, role: undefined, model: "gpt-5.6-sol", reasoningEffort: "high" }],
      }),
    );

    expect(result?.tasks[0]).toMatchObject({
      role: "worker",
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
    });
  });

  it("orders dependencies before dependents even when the planner returns them later", () => {
    const dependent = {
      ...workerTask,
      key: "ui",
      title: "Build the UI",
      dependsOn: ["api"],
      role: "visual",
    };

    expect(
      parseAutomationPlan(
        JSON.stringify({
          summary: "Build the API and UI.",
          tasks: [dependent, workerTask],
        }),
      )?.tasks.map((task) => task.key),
    ).toEqual(["api", "ui"]);
  });

  it.each([
    {
      name: "an unsupported role",
      plan: { summary: "Invalid", tasks: [{ ...workerTask, role: "reviewer" }] },
    },
    {
      name: "a model without its reasoning effort",
      plan: { summary: "Invalid", tasks: [{ ...workerTask, model: "gpt-5.6-sol" }] },
    },
    {
      name: "an unknown dependency",
      plan: {
        summary: "Invalid",
        tasks: [{ ...workerTask, dependsOn: ["missing"] }],
      },
    },
    {
      name: "a dependency cycle",
      plan: {
        summary: "Invalid",
        tasks: [
          { ...workerTask, key: "one", dependsOn: ["two"] },
          { ...workerTask, key: "two", dependsOn: ["one"] },
        ],
      },
    },
    {
      name: "overlapping task keys",
      plan: { summary: "Invalid", tasks: [workerTask, workerTask] },
    },
    {
      name: "the reserved integration task key",
      plan: { summary: "Invalid", tasks: [{ ...workerTask, key: "__integration__" }] },
    },
    {
      name: "the reserved final audit task key",
      plan: { summary: "Invalid", tasks: [{ ...workerTask, key: "__final_audit__" }] },
    },
  ])("rejects $name", ({ plan }) => {
    expect(parseAutomationPlan(JSON.stringify(plan))).toBeNull();
  });
});

describe("parseAutomationFinalAuditReport", () => {
  it("decodes a complete final audit", () => {
    expect(
      parseAutomationFinalAuditReport(
        JSON.stringify({
          status: "complete",
          summary: "The integrated objective is complete.",
          failedCriteria: [],
          remainingRisks: ["Manual release remains outside this workflow."],
          followUpTasks: [],
        }),
      ),
    ).toMatchObject({ status: "complete", failedCriteria: [] });
  });

  it("rejects contradictory and incomplete final verdicts", () => {
    expect(
      parseAutomationFinalAuditReport(
        JSON.stringify({
          status: "complete",
          summary: "Contradictory.",
          failedCriteria: ["A criterion failed."],
          remainingRisks: [],
          followUpTasks: [],
        }),
      ),
    ).toBeNull();
    expect(
      parseAutomationFinalAuditReport(
        JSON.stringify({
          status: "repair-required",
          summary: "Missing failures.",
          failedCriteria: [],
          remainingRisks: [],
          followUpTasks: [],
        }),
      ),
    ).toBeNull();
  });
});

describe("parseAutomationIntegrationReport", () => {
  it("requires a structured verdict with concrete evidence", () => {
    expect(
      parseAutomationIntegrationReport(
        JSON.stringify({
          status: "integrated",
          summary: "Merged both branches.",
          mergedBranches: ["t3code/api", "t3code/web"],
          conflictsResolved: [],
          evidence: [{ check: "Focused tests", detail: "Passed 12 tests." }],
          remainingRisks: [],
        }),
      ),
    ).toMatchObject({ status: "integrated", mergedBranches: ["t3code/api", "t3code/web"] });
    expect(
      parseAutomationIntegrationReport(
        JSON.stringify({
          status: "integrated",
          summary: "No evidence.",
          mergedBranches: [],
          conflictsResolved: [],
          evidence: [],
          remainingRisks: [],
        }),
      ),
    ).toBeNull();
  });
});

describe("parseAutomationVerificationReport", () => {
  it("decodes bounded verification evidence from surrounding prose", () => {
    const result = parseAutomationVerificationReport(`Verification finished.
${JSON.stringify({
  status: "passed",
  summary: "The focused checks passed.",
  checks: [
    { check: "Project API test", detail: "Passed 8 tests in 420 ms." },
    { check: "Type check", detail: "Completed without diagnostics." },
  ],
})}
The worktree is clean.`);

    expect(result).toEqual({
      status: "passed",
      summary: "The focused checks passed.",
      checks: [
        { check: "Project API test", detail: "Passed 8 tests in 420 ms." },
        { check: "Type check", detail: "Completed without diagnostics." },
      ],
    });
  });

  it.each([
    { status: "passed", summary: "No evidence", checks: [] },
    {
      status: "passed",
      summary: "Duplicate",
      checks: [
        { check: "test", detail: "one" },
        { check: "test", detail: "two" },
      ],
    },
    { status: "passed", summary: "Missing detail", checks: [{ check: "test" }] },
    {
      status: "complete",
      summary: "Unsupported verdict",
      checks: [{ check: "test", detail: "Completed." }],
    },
    {
      summary: "Missing verdict",
      checks: [{ check: "test", detail: "Completed." }],
    },
  ])("rejects incomplete or ambiguous evidence", (verification) => {
    expect(parseAutomationVerificationReport(JSON.stringify(verification))).toBeNull();
  });

  it("preserves a failed verdict with its diagnostic evidence", () => {
    expect(
      parseAutomationVerificationReport(
        JSON.stringify({
          status: "failed",
          summary: "The focused API test failed.",
          checks: [{ check: "Project API test", detail: "Expected 200 but received 500." }],
        }),
      ),
    ).toEqual({
      status: "failed",
      summary: "The focused API test failed.",
      checks: [{ check: "Project API test", detail: "Expected 200 but received 500." }],
    });
  });

  it("requires explicit evidence for every acceptance criterion", () => {
    const report = {
      status: "passed" as const,
      summary: "Verified.",
      checks: [
        { check: "The API returns persisted projects.", detail: "Observed a 200 response." },
        { check: "Focused test", detail: "Passed." },
      ],
    };

    expect(
      automationVerificationCoversCriteria(report, [" The API returns persisted projects. "]),
    ).toBe(true);
    expect(
      automationVerificationCoversCriteria(report, [
        "The API returns persisted projects.",
        "The UI renders the projects.",
      ]),
    ).toBe(false);
  });
});
