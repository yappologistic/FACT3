import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveActiveSubagentCount } from "./index.ts";

const turnId = TurnId.make("turn-1");

function activity(
  id: string,
  kind: "tool.started" | "tool.updated" | "tool.completed",
  payload: Record<string, unknown>,
  sequence: number,
): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    kind,
    tone: "tool",
    summary: "Subagent task",
    payload,
    turnId,
    sequence,
    createdAt: `2026-08-01T00:00:0${sequence}.000Z`,
  };
}

describe("deriveActiveSubagentCount", () => {
  it("tracks Codex agent state snapshots across spawn, wait, and close operations", () => {
    const activities = [
      activity(
        "spawn",
        "tool.completed",
        {
          itemType: "collab_agent_tool_call",
          toolCallId: "spawn-call",
          collab: {
            tool: "spawnAgent",
            receiverThreadIds: ["agent-1", "agent-2", "agent-3"],
            agentsStates: {
              "agent-1": { status: "running" },
              "agent-2": { status: "pendingInit" },
              "agent-3": { status: "running" },
            },
          },
        },
        1,
      ),
      activity(
        "wait",
        "tool.completed",
        {
          itemType: "collab_agent_tool_call",
          toolCallId: "wait-call",
          collab: {
            tool: "wait",
            receiverThreadIds: ["agent-1", "agent-2"],
            agentsStates: {
              "agent-1": { status: "completed" },
              "agent-2": { status: "running" },
            },
          },
        },
        2,
      ),
      activity(
        "close",
        "tool.completed",
        {
          itemType: "collab_agent_tool_call",
          toolCallId: "close-call",
          collab: {
            tool: "closeAgent",
            receiverThreadIds: ["agent-3"],
            agentsStates: { "agent-3": { status: "shutdown" } },
          },
        },
        3,
      ),
    ];

    expect(deriveActiveSubagentCount(activities, turnId)).toBe(1);
  });

  it("falls back to matching in-flight collaboration tool calls", () => {
    const activities = [
      activity(
        "agent-a-start",
        "tool.started",
        { itemType: "collab_agent_tool_call", toolCallId: "agent-a" },
        1,
      ),
      activity(
        "agent-b-start",
        "tool.started",
        { itemType: "collab_agent_tool_call", toolCallId: "agent-b" },
        2,
      ),
      activity(
        "agent-a-complete",
        "tool.completed",
        { itemType: "collab_agent_tool_call", toolCallId: "agent-a" },
        3,
      ),
    ];

    expect(deriveActiveSubagentCount(activities, turnId)).toBe(1);
  });

  it("does not count a Codex wait call when its compact snapshot has no agents", () => {
    const activities = [
      activity(
        "wait-start",
        "tool.started",
        {
          itemType: "collab_agent_tool_call",
          toolCallId: "wait-call",
          collab: { tool: "wait", receiverThreadIds: [] },
        },
        1,
      ),
    ];

    expect(deriveActiveSubagentCount(activities, turnId)).toBe(0);
  });

  it("does not count a child interaction with the root agent as a sub-agent", () => {
    const activities = [
      activity(
        "root-interaction",
        "tool.updated",
        {
          itemType: "collab_agent_tool_call",
          toolCallId: "root-interaction",
          data: {
            item: {
              type: "subAgentActivity",
              kind: "interacted",
              agentPath: "/root",
              agentThreadId: "provider-root",
            },
          },
          collab: {
            tool: "spawnAgent",
            receiverThreadIds: ["provider-root"],
            agentsStates: { "provider-root": { status: "running" } },
          },
        },
        1,
      ),
    ];

    expect(deriveActiveSubagentCount(activities, turnId)).toBe(0);
  });

  it("ignores collaboration work from earlier turns", () => {
    const oldTurnActivity = {
      ...activity(
        "old-agent",
        "tool.started",
        { itemType: "collab_agent_tool_call", toolCallId: "old-agent" },
        1,
      ),
      turnId: TurnId.make("turn-old"),
    };

    expect(deriveActiveSubagentCount([oldTurnActivity], turnId)).toBe(0);
  });
});
