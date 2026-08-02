import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ComposerActivityStatus } from "./ComposerActivityStatus";

describe("ComposerActivityStatus", () => {
  it("renders the working state in the composer activity rail", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Thinking…" }}
        activeSubagentCount={0}
        theme="dark"
      />,
    );

    expect(markup).toContain('data-chat-composer-activity="true"');
    expect(markup).toContain('aria-label="Thinking…"');
    expect(markup).toContain('class="thinking-orb-motion"');
    expect(markup).toContain("text-[13px]");
    expect(markup).toContain("width:32px");
    expect(markup).toContain("Thinking…");
    expect(markup).toContain("justify-center");
    expect(markup).toContain("<canvas");
    expect(markup).not.toContain("sub-agent");
  });

  it("shows live activity and progress without changing the orb size", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Searching session lifecycle", detail: "Reading files · 3 of 7" }}
        activeSubagentCount={2}
        theme="dark"
      />,
    );

    expect(markup).toContain("Searching session lifecycle");
    expect(markup).toContain("Reading files · 3 of 7");
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
        theme="dark"
      />,
    );

    expect(markup).toContain("Searching files");
    expect(markup).toContain("font-mono");
    expect(markup).toContain("deriveTimelineEntries");
  });

  it("shows a singular live sub-agent count", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Thinking…" }}
        activeSubagentCount={1}
        theme="dark"
      />,
    );

    expect(markup).toContain('aria-label="Thinking…, 1 sub-agent running"');
    expect(markup).toContain('data-subagent-count="1"');
    expect(markup).toContain("sub-agent");
  });

  it("shows up to three overlapping orbs with the full live count", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus
        activity={{ title: "Thinking…" }}
        activeSubagentCount={4}
        theme="light"
      />,
    );

    expect(markup).toContain('aria-label="Thinking…, 4 sub-agents running"');
    expect(markup).toContain('data-subagent-count="4"');
    expect(markup).toContain("sub-agents");
    expect(markup.match(/data-orb-index=/g)).toHaveLength(3);
  });
});
