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
  it("projects bounded agent details and a stable call id", () => {
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
            prompt: "Review the composer activity panel",
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
      prompt: "Review the composer activity panel",
      receiverThreadIds: ["agent-1", "agent-2"],
      agentsStates: {
        "agent-1": { status: "running", message: "Working" },
        "agent-2": { status: "pendingInit" },
      },
    });
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
      agentPaths: { "agent-1": "/root/review_web" },
      agentsStates: { "agent-1": { status: "running" } },
    });
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

  it("projects bounded assistant completions so child-agent results can be correlated", () => {
    const event = {
      type: "item.completed",
      eventId: EventId.make("child-result-completed"),
      provider: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      itemId: RuntimeItemId.make("message-1"),
      createdAt: "2026-08-01T00:00:00.000Z",
      payload: {
        itemType: "assistant_message",
        status: "completed",
        detail: "Result fallback",
        data: {
          threadId: "agent-1",
          item: {
            id: "message-1",
            type: "agentMessage",
            text: "The sub-agent finished its inspection.",
          },
        },
      },
    } satisfies ProviderRuntimeEvent;

    expect(runtimeEventToActivities(event)).toEqual([
      expect.objectContaining({
        kind: "assistant.message.completed",
        payload: {
          itemType: "assistant_message",
          data: {
            threadId: "agent-1",
            item: {
              id: "message-1",
              text: "The sub-agent finished its inspection.",
            },
          },
        },
      }),
    ]);
  });
});
