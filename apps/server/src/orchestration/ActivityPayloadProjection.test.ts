import { EventId, TurnId, type OrchestrationThreadActivity } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { projectActivityPayload } from "./ActivityPayloadProjection.ts";

describe("projectActivityPayload", () => {
  it("keeps the bounded child assistant result used by sub-agent details", () => {
    const activity = {
      id: EventId.make("child-result-completed"),
      tone: "info",
      kind: "assistant.message.completed",
      summary: "Assistant message completed",
      turnId: TurnId.make("turn-1"),
      createdAt: "2026-08-02T00:00:00.000Z",
      payload: {
        itemType: "assistant_message",
        ignored: "do not send",
        data: {
          threadId: "agent-1",
          ignored: "do not send",
          item: {
            id: "message-1",
            text: "The sub-agent finished its inspection.",
            ignored: "do not send",
          },
        },
      },
    } satisfies OrchestrationThreadActivity;

    expect(projectActivityPayload(activity).payload).toEqual({
      itemType: "assistant_message",
      data: {
        threadId: "agent-1",
        item: {
          id: "message-1",
          text: "The sub-agent finished its inspection.",
        },
      },
    });
  });
});
