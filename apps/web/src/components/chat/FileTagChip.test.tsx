import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import {
  CHAT_FILE_TAG_CHIP_CLASS_NAME,
  FILE_TAG_CHIP_CLASS_NAME,
  FileTagChipContent,
} from "./FileTagChip";

describe("FileTagChip", () => {
  it("shares the neutral metadata-chip treatment in composer and chat", () => {
    for (const className of [FILE_TAG_CHIP_CLASS_NAME, CHAT_FILE_TAG_CHIP_CLASS_NAME]) {
      expect(className).toContain("rounded-[9px]");
      expect(className).toContain("border-border/60");
      expect(className).toContain("bg-foreground/[0.045]");
      expect(className).toContain("font-normal");
      expect(className).not.toContain("fuchsia");
    }
  });

  it("keeps file and folder tags distinguishable through their icons", () => {
    const markup = renderToStaticMarkup(
      <div>
        <span className={FILE_TAG_CHIP_CLASS_NAME}>
          <FileTagChipContent path="src/App.tsx" label="App.tsx" theme="dark" />
        </span>
        <span className={FILE_TAG_CHIP_CLASS_NAME}>
          <FileTagChipContent path="src/components" label="components" theme="dark" />
        </span>
      </div>,
    );

    expect(markup).toContain("data-pierre-icon=");
    expect(markup).toContain("lucide-folder");
    expect(markup).toContain("App.tsx");
    expect(markup).toContain("components");
  });
});
