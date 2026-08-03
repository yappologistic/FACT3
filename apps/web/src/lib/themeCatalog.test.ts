import { describe, expect, it } from "vite-plus/test";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  DEFAULT_THEME_PRESET_ID,
  THEME_PRESETS,
  getThemeSeed,
  normalizeAppearancePreferences,
  resolveSyntaxThemeName,
  resolveThemeCssVariables,
} from "./themeCatalog";

const EXPECTED_PRESET_IDS = [
  "t3-code",
  "absolutely",
  "ayu",
  "catppuccin",
  "codex",
  "dracula",
  "everforest",
  "github",
  "gruvbox",
  "linear",
  "lobster",
  "material",
  "matrix",
  "monokai",
  "night-owl",
  "nord",
  "notion",
  "one",
  "oscurange",
  "raycast",
  "rose-pine",
  "sentry",
  "solarized",
  "temple",
  "tokyo-night",
  "vercel",
  "vs-code-plus",
  "xcode",
] as const;

describe("theme catalog", () => {
  it("contains every reference preset plus FACT3 Code exactly once", () => {
    const ids = THEME_PRESETS.map((preset) => preset.id);
    expect(ids).toEqual(EXPECTED_PRESET_IDS);
    expect(new Set(ids).size).toBe(ids.length);
    expect(DEFAULT_THEME_PRESET_ID).toBe("t3-code");
  });

  it("uses the Codex font stacks and reference palette", () => {
    expect(DEFAULT_APPEARANCE_PREFERENCES.uiFont).toBe("Geist, Inter");
    expect(DEFAULT_APPEARANCE_PREFERENCES.codeFont).toBe("Geist Mono");

    const codex = THEME_PRESETS.find((themePreset) => themePreset.id === "codex");
    expect(codex?.dark).toEqual({
      background: "#2d2d2b",
      foreground: "#f4f4f2",
      surface: "#3b3b38",
      sidebar: "#292927",
      accent: "#cc7d5e",
    });
  });

  for (const themePreset of THEME_PRESETS) {
    for (const mode of ["light", "dark"] as const) {
      it(`resolves a complete ${themePreset.label} ${mode} palette and syntax theme`, () => {
        const preferences = { ...DEFAULT_APPEARANCE_PREFERENCES, presetId: themePreset.id };
        const colors = getThemeSeed(preferences, mode);
        const variables = resolveThemeCssVariables(preferences, mode);

        expect(Object.values(colors).every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
        expect(resolveSyntaxThemeName(mode, themePreset.id)).toBe(themePreset.syntax[mode]);
        expect(variables["--background"]).toBe(colors.background);
        expect(variables["--foreground"]).toBe(colors.foreground);
        expect(variables["--primary"]).toBe(colors.accent);
        expect(variables["--font-sans"]).toBeTruthy();
        expect(variables["--font-mono"]).toBeTruthy();
        expect(Object.keys(variables).length).toBeGreaterThanOrEqual(35);
      });
    }
  }

  it("sanitizes an invalid imported theme instead of trusting arbitrary values", () => {
    const normalized = normalizeAppearancePreferences({
      presetId: "unknown",
      colors: {
        light: { accent: "red", background: "#ABCDEF", foreground: "#123456" },
        dark: { accent: "url(javascript:bad)", background: "#000000", foreground: 42 },
      },
      uiFont: "Geist; color: red",
      codeFont: "url(javascript:bad)",
      translucentSidebar: "yes",
      contrast: 900,
      pointerCursors: false,
      reduceMotion: "sometimes",
      uiFontSize: 4,
      codeFontSize: 100,
      diffMarkers: "emoji",
    });

    expect(normalized).toMatchObject({
      presetId: "t3-code",
      uiFont: "Geist, Inter",
      codeFont: "Geist Mono",
      translucentSidebar: false,
      contrast: 100,
      pointerCursors: false,
      reduceMotion: "system",
      uiFontSize: 12,
      codeFontSize: 20,
      diffMarkers: "color",
    });
    expect(normalized.colors.light).toEqual({
      accent: null,
      background: "#abcdef",
      foreground: "#123456",
    });
    expect(normalized.colors.dark).toEqual({
      accent: null,
      background: "#000000",
      foreground: null,
    });
  });

  it("accepts freely typed font stacks and resolves safe CSS fallbacks", () => {
    const normalized = normalizeAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      uiFont: "  Noto Sans Arabic, Segoe UI  ",
      codeFont: '"Cascadia Code", Fira Code',
    });
    const variables = resolveThemeCssVariables(normalized, "dark");

    expect(normalized.uiFont).toBe("Noto Sans Arabic, Segoe UI");
    expect(normalized.codeFont).toBe("Cascadia Code, Fira Code");
    expect(variables["--font-sans"]).toBe('"Noto Sans Arabic", "Segoe UI", system-ui, sans-serif');
    expect(variables["--font-mono"]).toBe(
      '"Cascadia Code", "Fira Code", ui-monospace, "SFMono-Regular", Consolas, monospace',
    );
  });

  it("makes the app chrome transparent only when native sidebar translucency is enabled", () => {
    const opaque = resolveThemeCssVariables(DEFAULT_APPEARANCE_PREFERENCES, "dark");
    const translucent = resolveThemeCssVariables(
      { ...DEFAULT_APPEARANCE_PREFERENCES, translucentSidebar: true },
      "dark",
    );

    expect(opaque["--app-chrome-background"]).toBe("#0a0a0a");
    expect(translucent["--app-chrome-background"]).toBe("transparent");
    expect(translucent["--background"]).toBe("#0a0a0a");
  });

  it("applies per-mode custom colors without leaking them to the other mode", () => {
    const normalized = normalizeAppearancePreferences({
      ...DEFAULT_APPEARANCE_PREFERENCES,
      presetId: "dracula",
      colors: {
        light: { accent: "#112233", background: "#abcdef", foreground: "#334455" },
        dark: { accent: null, background: null, foreground: null },
      },
    });

    expect(getThemeSeed(normalized, "light")).toMatchObject({
      accent: "#112233",
      background: "#abcdef",
      foreground: "#334455",
    });
    expect(getThemeSeed(normalized, "dark")).toEqual(
      THEME_PRESETS.find((preset) => preset.id === "dracula")?.dark,
    );
  });
});
