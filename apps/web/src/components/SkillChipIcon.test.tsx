import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { SkillInlineText } from "./chat/SkillInlineText";
import { COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME } from "./composerInlineChip";
import { SkillChipIcon } from "./SkillChipIcon";

describe("SkillChipIcon", () => {
  it("uses category-specific icons with a neutral fallback", () => {
    const markup = renderToStaticMarkup(
      <div>
        <SkillChipIcon skillLabel="Image Gen" skillName="imagegen" />
        <SkillChipIcon skillName="computer-use" />
        <SkillChipIcon skillName="github:gh-fix-ci" />
        <SkillChipIcon skillName="spreadsheets" />
        <SkillChipIcon skillName="unknown-specialty" />
      </div>,
    );

    for (const icon of ["image", "monitor", "github", "table-2", "sparkles"]) {
      expect(markup).toContain(`lucide-${icon}`);
    }
  });

  it("renders skill references with theme-aware neutral styling", () => {
    const markup = renderToStaticMarkup(
      <SkillInlineText
        skills={[{ name: "imagegen", displayName: "Image Gen" }]}
        text="$imagegen"
      />,
    );

    expect(markup).toContain("lucide-image");
    expect(markup).toContain("rounded-[9px]");
    expect(markup).toContain("border-border/60");
    expect(markup).toContain("bg-foreground/[0.045]");
    expect(markup).toContain("font-normal");
    expect(markup).not.toContain("fuchsia");
    expect(COMPOSER_INLINE_SKILL_CHIP_CLASS_NAME).not.toContain("fuchsia");
  });
});
