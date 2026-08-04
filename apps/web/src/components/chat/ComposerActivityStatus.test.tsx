import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import {
  ACTIVITY_SECTION_ITEM_CLASS_NAME,
  ComposerActivityStatus,
  SubagentActivityRow,
  TaskActivityRow,
  ToolActivityRow,
} from "./ComposerActivityStatus";
import { SubagentAvatar, SubagentAvatarStack } from "./SubagentActivityIndicator";
import type { ComposerActivityDetails, ComposerToolActivityItem } from "./composerActivityDetails";

const EMPTY_DETAILS: ComposerActivityDetails = {
  tools: [],
  subagents: [],
  tasks: [],
  hasHistory: false,
};

describe("ComposerActivityStatus", () => {
  it("keeps activity menu highlights concentric with the popup shell", () => {
    expect(ACTIVITY_SECTION_ITEM_CLASS_NAME).toContain("rounded-[16px]");
    expect(ACTIVITY_SECTION_ITEM_CLASS_NAME).toContain("text-[12px]");
  });

  it("keeps the compact animated orb and opens activity details", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Thinking…" }}
        activeSubagentCount={0}
        details={EMPTY_DETAILS}
        isActive
        theme="dark"
      />,
    );

    expect(markup).toContain('data-chat-composer-activity="true"');
    expect(markup).toContain("Thinking…. Open activity details");
    expect(markup).toContain("thinking-orb-motion");
    expect(markup).toContain("text-[13px]");
    expect(markup).toContain("width:32px");
    expect(markup).toContain("justify-center");
    expect(markup).toContain("<canvas");
    expect(markup).not.toContain("sub-agent running");
  });

  it("shows live activity and sub-agent progress without changing the orb size", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Searching session lifecycle", detail: "Reading files · 3 of 7" }}
        activeSubagentCount={2}
        details={EMPTY_DETAILS}
        isActive
        theme="dark"
      />,
    );

    expect(markup).toContain("Searching session lifecycle");
    expect(markup).toContain("Reading files · 3 of 7");
    expect(markup).toContain("2 sub-agents running");
    expect(markup).toContain('data-subagent-count="2"');
    expect(markup).toContain("/subagent-avatars/plume.webp");
    expect(markup).toContain("/subagent-avatars/islands.webp");
    expect(markup).toContain('data-animated="true"');
    expect(markup).toContain("width:32px");
    expect(markup).not.toContain("thinking-orb-shimmer");
  });

  it("uses the assigned iridescent avatar for a completed sub-agent", () => {
    const markup = renderToStaticMarkup(
      <SubagentActivityRow
        avatarIndex={2}
        item={{
          id: "agent-3",
          name: "Desktop review",
          model: "gpt-5.6-sol",
          reasoningEffort: "xhigh",
          status: "completed",
          createdAt: "2026-08-02T00:00:00.000Z",
          result: "Review complete",
        }}
        theme="dark"
      />,
    );

    expect(markup).toContain("/subagent-avatars/ribbon.webp");
    expect(markup).toContain('data-animated="true"');
    expect(markup).toContain('data-subagent-runtime="true"');
    expect(markup).toContain("GPT-5.6-Sol");
    expect(markup).toContain("Extra High");
    expect(markup).toContain("Model GPT-5.6-Sol, Extra High reasoning");
    expect(markup).not.toContain("lucide-check");
  });

  it("provides ten distinct animated sub-agent identities", () => {
    const expectedTextures = [
      "plume",
      "islands",
      "ribbon",
      "vortex",
      "cells",
      "fan",
      "contours",
      "eclipse",
      "petals",
      "prism",
    ];
    const markup = renderToStaticMarkup(
      <div>
        {expectedTextures.map((texture, index) => (
          <SubagentAvatar index={index} key={texture} />
        ))}
      </div>,
    );

    for (const texture of expectedTextures) {
      expect(markup).toContain(`/subagent-avatars/${texture}.webp`);
    }
    expect(markup.match(/data-animated="true"/g)).toHaveLength(10);
  });

  it("reuses the compact avatar stack without animating completed groups", () => {
    const markup = renderToStaticMarkup(<SubagentAvatarStack animated={false} count={4} />);

    expect(markup).toContain("subagent-activity-stack");
    expect(markup.match(/class="subagent-activity-orb"/g)).toHaveLength(3);
    expect(markup).toContain('data-animated="false"');
    expect(markup).toContain(">4</span>");
  });

  it("renders command details as compact monospace activity", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{
          title: "Searching files",
          detail: 'rg -n "deriveTimelineEntries" apps/web/src',
          detailKind: "command",
        }}
        activeSubagentCount={0}
        details={EMPTY_DETAILS}
        isActive
        theme="dark"
      />,
    );

    expect(markup).toContain("Searching files");
    expect(markup).toContain("font-mono");
    expect(markup).toContain("deriveTimelineEntries");
  });

  it("uses action-specific icons for completed tool calls", () => {
    const item = (
      id: string,
      title: string,
      itemType: NonNullable<ComposerToolActivityItem["itemType"]>,
    ): ComposerToolActivityItem => ({
      id,
      title,
      itemType,
      status: "completed",
      createdAt: "2026-08-02T00:00:00.000Z",
      rawData: {},
    });
    const items: ReadonlyArray<ComposerToolActivityItem> = [
      item("command", "Running command", "command_execution"),
      item("web", "Searching the web", "web_search"),
      item("edit", "Editing files", "file_change"),
      item("image", "Viewing image", "image_view"),
      item("mcp", "Calling integration", "mcp_tool_call"),
      item("dynamic", "Running tool", "dynamic_tool_call"),
      item("search", "Searching files", "mcp_tool_call"),
    ];
    const markup = renderToStaticMarkup(
      <div>
        {items.map((item) => (
          <ToolActivityRow item={item} key={item.id} />
        ))}
      </div>,
    );

    for (const icon of [
      "terminal",
      "globe",
      "square-pen",
      "eye",
      "wrench",
      "hammer",
      "file-search",
    ]) {
      expect(markup).toContain(`lucide-${icon}`);
    }
    expect(markup).not.toContain("lucide-check");
  });

  it("makes every task expandable so its full text remains available", () => {
    const markup = renderToStaticMarkup(
      <TaskActivityRow
        item={{
          id: "task-1",
          title:
            "Read product contract, workspace instructions, repository status, and toolchain/test configuration",
          status: "pending",
          createdAt: "2026-08-02T00:00:00.000Z",
        }}
        theme="light"
      />,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toContain("lucide-chevron-right");
  });

  it("keeps a completed summary with persistent history", () => {
    const details: ComposerActivityDetails = {
      tools: [
        {
          id: "tool-1",
          title: "Ran command",
          status: "completed",
          createdAt: "2026-08-02T00:00:00.000Z",
          rawData: { command: "vp test" },
        },
      ],
      subagents: [
        {
          id: "agent-1",
          name: "Web review",
          status: "completed",
          createdAt: "2026-08-02T00:00:00.000Z",
        },
      ],
      tasks: [],
      hasHistory: true,
    };
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Thinking…" }}
        activeSubagentCount={0}
        completionState="completed"
        details={details}
        isActive={false}
        theme="light"
      />,
    );

    expect(markup).toContain("Agent finished working");
    expect(markup).toContain("1 tool call · 1 sub-agent");
    expect(markup).toContain('data-subagent-count="1"');
    expect(markup).not.toContain("1 tool call · 1 sub-agent, 1 sub-agent");
    expect(markup).not.toContain("thinking-orb-motion");
  });
});
