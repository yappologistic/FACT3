import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { StreamingMarkdownTextReveal } from "./StreamingMarkdownTextReveal";

describe("StreamingMarkdownTextReveal", () => {
  it("reveals text while preserving inline markup", () => {
    const markup = renderToStaticMarkup(
      <StreamingMarkdownTextReveal>
        A <strong>revealed response</strong> arrives here.
      </StreamingMarkdownTextReveal>,
    );

    expect(markup).toContain('data-interior-text-reveal="streaming"');
    expect(markup).toContain("blur(8px)");
    expect(markup).toContain("<strong>");
    expect(markup).toContain("revealed");
  });
});
