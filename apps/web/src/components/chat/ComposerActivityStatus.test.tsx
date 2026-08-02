import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { ComposerActivityStatus } from "./ComposerActivityStatus";

describe("ComposerActivityStatus", () => {
  it("renders the working state in the composer activity rail", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus activeSubagentCount={0} theme="dark" />,
    );

    expect(markup).toContain('data-chat-composer-activity="true"');
    expect(markup).toContain('aria-label="Thinking"');
    expect(markup).toContain('class="thinking-orb-motion"');
    expect(markup).toContain("text-[13px]");
    expect(markup).toContain("width:32px");
    expect(markup).toContain("Thinking…");
    expect(markup).toContain("<canvas");
    expect(markup).not.toContain("sub-agent");
  });

  it("shows a singular live sub-agent count", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus activeSubagentCount={1} theme="dark" />,
    );

    expect(markup).toContain('aria-label="Thinking, 1 sub-agent running"');
    expect(markup).toContain('data-subagent-count="1"');
    expect(markup).toContain("sub-agent");
  });

  it("shows up to three overlapping orbs with the full live count", () => {
    const markup = renderToStaticMarkup(
      <ComposerActivityStatus activeSubagentCount={4} theme="light" />,
    );

    expect(markup).toContain('aria-label="Thinking, 4 sub-agents running"');
    expect(markup).toContain('data-subagent-count="4"');
    expect(markup).toContain("sub-agents");
    expect(markup.match(/data-orb-index=/g)).toHaveLength(3);
  });
});
