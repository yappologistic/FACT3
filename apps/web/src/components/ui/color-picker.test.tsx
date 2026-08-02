import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { ColorPicker } from "./color-picker";

describe("ColorPicker", () => {
  it("renders a theme-matched trigger instead of a native color input", () => {
    const markup = renderToStaticMarkup(
      <ColorPicker label="Accent color" value="#cc7d5e" onValueChange={() => {}} />,
    );

    expect(markup).toContain("#cc7d5e");
    expect(markup).toContain("Choose Accent color");
    expect(markup).not.toContain('type="color"');
  });
});
