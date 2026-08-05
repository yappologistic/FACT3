import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveComposerActivityDetails,
  deriveComposerActivityDetailsWithSubagentHistory,
  deriveLatestComposerActivityTurnId,
  deriveSubagentAssistantMessageIds,
  formatComposerToolData,
} from "./composerActivityDetails";

function makeActivity(overrides: {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  sequence: number;
  summary?: string;
  turnId?: string;
}): OrchestrationThreadActivity {
  return {
    id: EventId.make(overrides.id),
    createdAt: `2026-08-02T00:00:0${overrides.sequence}.000Z`,
    kind: overrides.kind,
    summary: overrides.summary ?? "Tool call",
    tone: "tool",
    payload: overrides.payload,
    turnId: TurnId.make(overrides.turnId ?? "turn-1"),
    sequence: overrides.sequence,
  };
}

describe("deriveComposerActivityDetails", () => {
  it("groups lifecycle entries and preserves full tool data", () => {
    const details = deriveComposerActivityDetails(
      [
        makeActivity({
          id: "tool-start",
          kind: "tool.started",
          payload: { toolCallId: "call-1", itemType: "command_execution" },
          sequence: 1,
        }),
        makeActivity({
          id: "tool-complete",
          kind: "tool.completed",
          payload: {
            toolCallId: "call-1",
            itemType: "command_execution",
            data: { command: "vp test run activity", exitCode: 0 },
          },
          sequence: 2,
          summary: "Ran command",
        }),
      ],
      TurnId.make("turn-1"),
      null,
    );

    expect(details.tools).toHaveLength(1);
    expect(details.tools[0]).toMatchObject({ id: "call-1", status: "completed" });
    expect(formatComposerToolData(details.tools[0]?.rawData)).toContain("vp test run activity");
  });

  it("derives named sub-agents with their assignment and result", () => {
    const details = deriveComposerActivityDetails(
      [
        makeActivity({
          id: "agent-start",
          kind: "tool.started",
          payload: {
            itemType: "collab_agent_tool_call",
            toolCallId: "spawn-1",
            collab: {
              tool: "spawnAgent",
              prompt: "Review the composer interaction",
              model: "gpt-5.6-sol",
              reasoningEffort: "high",
              receiverThreadIds: ["agent-1"],
              agentPaths: { "agent-1": "/root/interaction_review" },
              agentsStates: {
                "agent-1": { status: "running" },
                "stale-agent": { status: "running" },
              },
            },
          },
          sequence: 1,
        }),
        makeActivity({
          id: "agent-finish",
          kind: "tool.completed",
          payload: {
            itemType: "collab_agent_tool_call",
            toolCallId: "spawn-1",
            collab: {
              tool: "wait",
              receiverThreadIds: ["agent-1"],
              agentsStates: {
                "agent-1": { status: "completed", message: "Interaction verified." },
              },
            },
          },
          sequence: 2,
        }),
      ],
      TurnId.make("turn-1"),
      null,
    );

    expect(details.subagents).toEqual([
      expect.objectContaining({
        id: "agent-1",
        name: "Interaction review",
        model: "gpt-5.6-sol",
        reasoningEffort: "high",
        prompt: "Review the composer interaction",
        result: "Interaction verified.",
        status: "completed",
      }),
    ]);
    expect(details.subagents).toHaveLength(1);
  });

  it("shows live plan task states", () => {
    const details = deriveComposerActivityDetails([], TurnId.make("turn-1"), {
      createdAt: "2026-08-02T00:00:00.000Z",
      turnId: TurnId.make("turn-1"),
      steps: [
        { step: "Inspect activity data", status: "completed" },
        { step: "Verify the Electron panel", status: "inProgress" },
        { step: "Capture evidence", status: "pending" },
      ],
    });

    expect(details.tasks.map((task) => task.status)).toEqual(["completed", "running", "pending"]);
  });

  it("does not label a child with unconfirmed parent runtime values", () => {
    const details = deriveComposerActivityDetails(
      [
        makeActivity({
          id: "agent-start",
          kind: "tool.started",
          payload: {
            itemType: "collab_agent_tool_call",
            collab: {
              tool: "spawnAgent",
              receiverThreadIds: ["agent-1"],
              agentsStates: { "agent-1": { status: "running" } },
            },
          },
          sequence: 1,
        }),
      ],
      TurnId.make("turn-1"),
      null,
    );

    expect(details.subagents[0]).not.toHaveProperty("model");
    expect(details.subagents[0]).not.toHaveProperty("reasoningEffort");
  });

  it("folds Codex child messages into results without overriding lifecycle status", () => {
    const activities = [
      makeActivity({
        id: "agent-start",
        kind: "tool.started",
        payload: {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              type: "subAgentActivity",
              kind: "started",
              agentThreadId: "agent-1",
              agentPath: "/root/interaction_review",
            },
          },
        },
        sequence: 1,
      }),
      makeActivity({
        id: "agent-result",
        kind: "tool.completed",
        payload: {
          itemType: "assistant_message",
          detail: "Interaction verified.",
          data: {
            threadId: "agent-1",
            item: {
              id: "message-1",
              phase: "final_answer",
              text: "Interaction verified.",
              type: "agentMessage",
            },
          },
        },
        sequence: 2,
      }),
      makeActivity({
        id: "agent-close",
        kind: "tool.completed",
        payload: {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              type: "subAgentActivity",
              kind: "interrupted",
              agentThreadId: "agent-1",
              agentPath: "/root/interaction_review",
            },
          },
        },
        sequence: 3,
      }),
    ];

    expect(
      deriveComposerActivityDetails(activities, TurnId.make("turn-1"), null).subagents,
    ).toEqual([
      expect.objectContaining({
        id: "agent-1",
        name: "Interaction review",
        result: "Interaction verified.",
        status: "stopped",
      }),
    ]);
    expect(deriveSubagentAssistantMessageIds(activities, TurnId.make("turn-1"))).toEqual(
      new Set(["assistant:message-1"]),
    );
  });

  it("recovers the latest activity turn after a completed session reload", () => {
    const activities = [
      makeActivity({
        id: "older",
        kind: "tool.completed",
        payload: { toolCallId: "old-call" },
        sequence: 1,
        turnId: "turn-older",
      }),
      makeActivity({
        id: "latest",
        kind: "tool.completed",
        payload: { toolCallId: "latest-call" },
        sequence: 2,
        turnId: "turn-latest",
      }),
    ];

    expect(deriveLatestComposerActivityTurnId(activities)).toBe(TurnId.make("turn-latest"));
  });

  it("retains implementation sub-agents when an autonomous verification turn becomes latest", () => {
    const activities = [
      makeActivity({
        id: "implementation-agent",
        kind: "tool.started",
        payload: {
          itemType: "collab_agent_tool_call",
          collab: {
            tool: "spawnAgent",
            receiverThreadIds: ["agent-1"],
            agentPaths: { "agent-1": "/root/conventions_review" },
            agentsStates: { "agent-1": { status: "completed" } },
          },
        },
        sequence: 1,
        turnId: "implementation-turn",
      }),
      makeActivity({
        id: "verification-command",
        kind: "tool.completed",
        payload: { toolCallId: "verify-1", itemType: "command_execution" },
        sequence: 2,
        turnId: "verification-turn",
      }),
    ];

    const details = deriveComposerActivityDetailsWithSubagentHistory(
      activities,
      TurnId.make("verification-turn"),
      null,
    );

    expect(details.tools).toHaveLength(1);
    expect(details.subagents).toEqual([
      expect.objectContaining({ id: "agent-1", name: "Conventions review" }),
    ]);
  });
});
