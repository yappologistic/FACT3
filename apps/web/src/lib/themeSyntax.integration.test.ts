import { getSharedHighlighter } from "@pierre/diffs";
import { describe, expect, it } from "vite-plus/test";

import { THEME_PRESETS } from "./themeCatalog";

describe("theme syntax integration", () => {
  it("loads and renders TypeScript with every configured light and dark theme", async () => {
    const themeNames = [
      ...new Set(THEME_PRESETS.flatMap((preset) => [preset.syntax.light, preset.syntax.dark])),
    ];
    const highlighter = await getSharedHighlighter({
      themes: themeNames,
      langs: ["typescript"],
      preferredHighlighter: "shiki-js",
    });

    for (const theme of themeNames) {
      const html = highlighter.codeToHtml("const answer: number = 42;", {
        lang: "typescript",
        theme,
      });
      expect(html, theme).toContain("const");
      expect(html, theme).toContain("answer");
      expect(html, theme).toContain("shiki");
    }
  });
});
