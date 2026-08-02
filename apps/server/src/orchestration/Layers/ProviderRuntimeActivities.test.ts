import {
  EventId,
  ProviderDriverKind,
  RuntimeItemId,
  ThreadId,
  TurnId,
  type ProviderRuntimeEvent,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { runtimeEventToActivities } from "./ProviderRuntimeIngestion.ts";

describe("runtimeEventToActivities collaboration metadata", () => {
  it("projects a compact agent snapshot and stable call id", () => {
    const event = {
      type: "item.started",
      eventId: EventId.make("collab-started"),
      provider: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      itemId: RuntimeItemId.make("spawn-call-1"),
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: {
        itemType: "collab_agent_tool_call",
        status: "inProgress",
        data: {
          threadId: "thread-1",
          turnId: "turn-1",
          item: {
            id: "spawn-call-1",
            type: "collabAgentToolCall",
            tool: "spawnAgent",
            receiverThreadIds: ["agent-1", "agent-2"],
            prompt: "A deliberately large prompt that should not enter the compact snapshot",
            agentsStates: {
              "agent-1": { status: "running", message: "Working" },
              "agent-2": { status: "pendingInit" },
            },
          },
        },
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);
    const payload = activity?.payload as Record<string, unknown>;

    expect(activity?.kind).toBe("tool.started");
    expect(payload.toolCallId).toBe("spawn-call-1");
    expect(payload.collab).toEqual({
      tool: "spawnAgent",
      receiverThreadIds: ["agent-1", "agent-2"],
      agentsStates: {
        "agent-1": { status: "running" },
        "agent-2": { status: "pendingInit" },
      },
    });
    expect(JSON.stringify(payload.collab)).not.toContain("large prompt");
    expect(JSON.stringify(payload.collab)).not.toContain("Working");
  });

  it("projects Codex sub-agent lifecycle markers as compact snapshots", () => {
    const event = {
      type: "item.started",
      eventId: EventId.make("subagent-started"),
      provider: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      itemId: RuntimeItemId.make("spawn-call-1"),
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: {
        itemType: "collab_agent_tool_call",
        data: {
          item: {
            id: "spawn-call-1",
            type: "subAgentActivity",
            kind: "started",
            agentPath: "/root/review_web",
            agentThreadId: "agent-1",
          },
        },
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);
    const payload = activity?.payload as Record<string, unknown>;

    expect(payload.collab).toEqual({
      tool: "spawnAgent",
      receiverThreadIds: ["agent-1"],
      agentsStates: { "agent-1": { status: "running" } },
    });
    expect(JSON.stringify(payload.collab)).not.toContain("review_web");
  });

  it("does not project root-agent interaction markers as spawned sub-agents", () => {
    const event = {
      type: "item.updated",
      eventId: EventId.make("root-agent-interaction"),
      provider: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      itemId: RuntimeItemId.make("root-interaction-1"),
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: {
        itemType: "collab_agent_tool_call",
        data: {
          item: {
            id: "root-interaction-1",
            type: "subAgentActivity",
            kind: "interacted",
            agentPath: "/root",
            agentThreadId: "provider-root",
          },
        },
      },
    } satisfies ProviderRuntimeEvent;

    const [activity] = runtimeEventToActivities(event);
    const payload = activity?.payload as Record<string, unknown>;

    expect(payload.collab).toBeUndefined();
  });
});
