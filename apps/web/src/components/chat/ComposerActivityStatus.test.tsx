import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ComposerActivityStatus } from "./ComposerActivityStatus";
import type { ComposerActivityDetails } from "./composerActivityDetails";

const EMPTY_DETAILS: ComposerActivityDetails = {
  tools: [],
  subagents: [],
  tasks: [],
  hasHistory: false,
};

describe("ComposerActivityStatus", () => {
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
    expect(markup).toContain("width:32px");
    expect(markup).not.toContain("thinking-orb-shimmer");
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
    expect(markup).not.toContain("thinking-orb-motion");
  });
});
