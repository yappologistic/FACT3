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
  it.each(["claudeAgent", "openCode"] as const)(
    "tracks %s native agent tools with a stable synthetic receiver",
    (provider) => {
      const started = runtimeEventToActivities({
        type: "item.started",
        eventId: EventId.make(`${provider}-agent-started`),
        provider: ProviderDriverKind.make(provider),
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-1"),
        itemId: RuntimeItemId.make("native-agent-1"),
        createdAt: "2026-08-01T00:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "inProgress",
          data: provider === "claudeAgent" ? { toolName: "Agent" } : { tool: "task" },
        },
      });
      const completed = runtimeEventToActivities({
        type: "item.completed",
        eventId: EventId.make(`${provider}-agent-completed`),
        provider: ProviderDriverKind.make(provider),
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-1"),
        itemId: RuntimeItemId.make("native-agent-1"),
        createdAt: "2026-08-01T00:00:01.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          status: "completed",
          data: provider === "claudeAgent" ? { toolName: "Agent" } : { tool: "task" },
        },
      });

      const receiverId = `${provider}:tool:native-agent-1`;
      expect(started[0]?.payload).toMatchObject({
        collab: {
          tool: "spawnAgent",
          receiverThreadIds: [receiverId],
          agentsStates: { [receiverId]: { status: "running" } },
        },
      });
      expect(completed[0]?.payload).toMatchObject({
        collab: {
          tool: "spawnAgent",
          receiverThreadIds: [receiverId],
          agentsStates: { [receiverId]: { status: "completed" } },
        },
      });
    },
  );

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
            model: "gpt-5.6-sol",
            reasoningEffort: "high",
            prompt: "Review the composer activity panel",
            agentsStates: {
              "agent-1": { status: "running", message: "Working" },
              "agent-2": { status: "pendingInit" },
              "provider-root": { status: "running" },
              "stale-agent": { status: "running" },
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
      model: "gpt-5.6-sol",
      reasoningEffort: "high",
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

  it.each(["completed", "failed"] as const)(
    "preserves the terminal %s status in Codex sub-agent snapshots",
    (kind) => {
      const event = {
        type: "item.completed",
        eventId: EventId.make(`subagent-${kind}`),
        provider: ProviderDriverKind.make("codex"),
        threadId: ThreadId.make("thread-1"),
        turnId: TurnId.make("turn-1"),
        itemId: RuntimeItemId.make(`spawn-call-${kind}`),
        createdAt: "2026-08-01T00:00:00.000Z",
        payload: {
          itemType: "collab_agent_tool_call",
          data: {
            item: {
              id: `spawn-call-${kind}`,
              type: "subAgentActivity",
              kind,
              agentPath: "/root/review_web",
              agentThreadId: "agent-1",
            },
          },
        },
      } satisfies ProviderRuntimeEvent;

      const [activity] = runtimeEventToActivities(event);

      expect(activity?.payload).toMatchObject({
        collab: {
          tool: "spawnAgent",
          receiverThreadIds: ["agent-1"],
          agentsStates: { "agent-1": { status: kind } },
        },
      });
    },
  );

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

  it("retains effective runtime metadata added to a direct child marker", () => {
    const activities = runtimeEventToActivities({
      eventId: EventId.make("event-subagent-runtime"),
      provider: ProviderDriverKind.make("codex"),
      threadId: ThreadId.make("thread-1"),
      turnId: TurnId.make("turn-1"),
      itemId: RuntimeItemId.make("spawn-1"),
      createdAt: "2026-08-02T00:00:00.000Z",
      type: "item.updated",
      payload: {
        itemType: "collab_agent_tool_call",
        data: {
          item: {
            type: "subAgentActivity",
            kind: "started",
            id: "spawn-1",
            agentThreadId: "agent-1",
            agentPath: "/root/terra_review",
            model: "gpt-5.6-terra",
            reasoningEffort: "medium",
          },
        },
      },
    });

    expect(activities).toHaveLength(1);
    expect(activities[0]?.payload).toMatchObject({
      collab: {
        model: "gpt-5.6-terra",
        reasoningEffort: "medium",
        receiverThreadIds: ["agent-1"],
      },
    });
  });
});
