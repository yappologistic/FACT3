import type { DiffsThemeNames } from "@pierre/diffs";

export type ThemeMode = "light" | "dark";
export type ReduceMotionPreference = "system" | "on" | "off";
export type DiffMarkerPreference = "color" | "symbols";

export interface ThemeSeed {
  readonly background: string;
  readonly foreground: string;
  readonly surface: string;
  readonly sidebar: string;
  readonly accent: string;
}

export interface ThemePreset {
  readonly id: string;
  readonly label: string;
  readonly light: ThemeSeed;
  readonly dark: ThemeSeed;
  readonly syntax: Readonly<Record<ThemeMode, DiffsThemeNames>>;
}

const seed = (
  background: string,
  foreground: string,
  surface: string,
  sidebar: string,
  accent: string,
): ThemeSeed => ({ background, foreground, surface, sidebar, accent });

const preset = (
  id: string,
  label: string,
  light: ThemeSeed,
  dark: ThemeSeed,
  lightSyntax: DiffsThemeNames,
  darkSyntax: DiffsThemeNames,
): ThemePreset => ({ id, label, light, dark, syntax: { light: lightSyntax, dark: darkSyntax } });

/**
 * Presets transcribed from Codex Desktop's Appearance picker. The semantic
 * palettes are intentionally compact: every component still consumes T3's
 * existing tokens, while each preset supplies the five colors that define its
 * visual character. Syntax themes use the Shiki themes bundled by Pierre.
 */
export const THEME_PRESETS = [
  preset(
    "t3-code",
    "T3 Code",
    seed("#fcfcfc", "#27272a", "#ffffff", "#fafafa", "#4f46e5"),
    seed("#0a0a0a", "#f5f5f5", "#0d0d0d", "#0d0d0d", "#6366f1"),
    "pierre-light",
    "pierre-dark",
  ),
  preset(
    "absolutely",
    "Absolutely",
    seed("#f9f9f7", "#2d2d2b", "#ffffff", "#f3f2ef", "#cc7d5e"),
    seed("#2d2d2b", "#f9f9f7", "#343432", "#292927", "#cc7d5e"),
    "min-light",
    "min-dark",
  ),
  preset(
    "ayu",
    "Ayu",
    seed("#fafafa", "#5c6166", "#ffffff", "#f3f4f5", "#ff9940"),
    seed("#0b0e14", "#bfbdb6", "#11151c", "#0d1017", "#e6b450"),
    "ayu-light",
    "ayu-dark",
  ),
  preset(
    "catppuccin",
    "Catppuccin",
    seed("#eff1f5", "#4c4f69", "#e6e9ef", "#dce0e8", "#8839ef"),
    seed("#1e1e2e", "#cdd6f4", "#181825", "#181825", "#cba6f7"),
    "catppuccin-latte",
    "catppuccin-mocha",
  ),
  preset(
    "codex",
    "Codex",
    seed("#f9f9f7", "#2d2d2b", "#ffffff", "#f1f0ed", "#cc7d5e"),
    seed("#2d2d2b", "#f4f4f2", "#3b3b38", "#292927", "#cc7d5e"),
    "min-light",
    "vesper",
  ),
  preset(
    "dracula",
    "Dracula",
    seed("#f8f8f2", "#282a36", "#ffffff", "#eeeef0", "#bd93f9"),
    seed("#282a36", "#f8f8f2", "#30323f", "#242630", "#bd93f9"),
    "snazzy-light",
    "dracula",
  ),
  preset(
    "everforest",
    "Everforest",
    seed("#fdf6e3", "#5c6a72", "#f4f0d9", "#efebd4", "#8da101"),
    seed("#2d353b", "#d3c6aa", "#343f44", "#272e33", "#a7c080"),
    "everforest-light",
    "everforest-dark",
  ),
  preset(
    "github",
    "GitHub",
    seed("#ffffff", "#1f2328", "#f6f8fa", "#f6f8fa", "#0969da"),
    seed("#0d1117", "#e6edf3", "#161b22", "#010409", "#2f81f7"),
    "github-light-default",
    "github-dark-default",
  ),
  preset(
    "gruvbox",
    "Gruvbox",
    seed("#fbf1c7", "#3c3836", "#f2e5bc", "#f2e5bc", "#d65d0e"),
    seed("#282828", "#ebdbb2", "#32302f", "#1d2021", "#d79921"),
    "gruvbox-light-medium",
    "gruvbox-dark-medium",
  ),
  preset(
    "linear",
    "Linear",
    seed("#f7f8f9", "#282a30", "#ffffff", "#f0f1f3", "#5e6ad2"),
    seed("#101012", "#f1f1f3", "#17171a", "#0c0c0e", "#7f85f5"),
    "min-light",
    "vitesse-black",
  ),
  preset(
    "lobster",
    "Lobster",
    seed("#fff7f4", "#3a2724", "#ffffff", "#fcece7", "#e54b4b"),
    seed("#211417", "#ffe9e3", "#2b1a1e", "#1a1012", "#ff6b6b"),
    "rose-pine-dawn",
    "horizon",
  ),
  preset(
    "material",
    "Material",
    seed("#fafafa", "#546e7a", "#ffffff", "#eceff1", "#00bfa5"),
    seed("#263238", "#eeffff", "#2e3c43", "#1f292e", "#89ddff"),
    "material-theme-lighter",
    "material-theme",
  ),
  preset(
    "matrix",
    "Matrix",
    seed("#f4fff6", "#14351d", "#ffffff", "#e5f6e9", "#168a3d"),
    seed("#050b07", "#b9f6ca", "#09140d", "#030805", "#36f572"),
    "min-light",
    "poimandres",
  ),
  preset(
    "monokai",
    "Monokai",
    seed("#faf9f5", "#3f3d37", "#ffffff", "#eeede7", "#f92672"),
    seed("#272822", "#f8f8f2", "#303129", "#20211c", "#a6e22e"),
    "snazzy-light",
    "monokai",
  ),
  preset(
    "night-owl",
    "Night Owl",
    seed("#fbfbfb", "#403f53", "#ffffff", "#f0f0f4", "#994cc3"),
    seed("#011627", "#d6deeb", "#071d2e", "#00111f", "#82aaff"),
    "night-owl-light",
    "night-owl",
  ),
  preset(
    "nord",
    "Nord",
    seed("#eceff4", "#2e3440", "#ffffff", "#e5e9f0", "#5e81ac"),
    seed("#2e3440", "#eceff4", "#3b4252", "#272c36", "#88c0d0"),
    "min-light",
    "nord",
  ),
  preset(
    "notion",
    "Notion",
    seed("#ffffff", "#37352f", "#ffffff", "#f7f6f3", "#2383e2"),
    seed("#191919", "#e3e2de", "#202020", "#151515", "#529cca"),
    "min-light",
    "min-dark",
  ),
  preset(
    "one",
    "One",
    seed("#fafafa", "#383a42", "#ffffff", "#f0f0f1", "#4078f2"),
    seed("#282c34", "#abb2bf", "#21252b", "#1f2329", "#61afef"),
    "one-light",
    "one-dark-pro",
  ),
  preset(
    "oscurange",
    "Oscurange",
    seed("#fff8f1", "#3b302a", "#ffffff", "#f5e9de", "#d96832"),
    seed("#1d1511", "#f6dfd1", "#291d17", "#160f0c", "#f08a50"),
    "solarized-light",
    "horizon",
  ),
  preset(
    "raycast",
    "Raycast",
    seed("#f8f7fa", "#25232a", "#ffffff", "#efedf3", "#ff6363"),
    seed("#161519", "#f5f3f7", "#201e24", "#111013", "#ff6363"),
    "min-light",
    "vesper",
  ),
  preset(
    "rose-pine",
    "Rose Pine",
    seed("#faf4ed", "#575279", "#fffaf3", "#f2e9e1", "#907aa9"),
    seed("#191724", "#e0def4", "#1f1d2e", "#14121d", "#c4a7e7"),
    "rose-pine-dawn",
    "rose-pine",
  ),
  preset(
    "sentry",
    "Sentry",
    seed("#f7f6f9", "#2f2936", "#ffffff", "#eeebf1", "#6c5fc7"),
    seed("#18141d", "#eee9f2", "#211b27", "#120f16", "#8b7dd8"),
    "github-light",
    "horizon",
  ),
  preset(
    "solarized",
    "Solarized",
    seed("#fdf6e3", "#657b83", "#eee8d5", "#eee8d5", "#268bd2"),
    seed("#002b36", "#93a1a1", "#073642", "#00252e", "#2aa198"),
    "solarized-light",
    "solarized-dark",
  ),
  preset(
    "temple",
    "Temple",
    seed("#f6f0df", "#40382b", "#fffaf0", "#eee4ce", "#a46b2a"),
    seed("#221d17", "#e8dcc4", "#2c251d", "#1a1612", "#d2a65c"),
    "gruvbox-light-soft",
    "kanagawa-dragon",
  ),
  preset(
    "tokyo-night",
    "Tokyo Night",
    seed("#f6f7fb", "#343b58", "#ffffff", "#e9eaf0", "#34548a"),
    seed("#1a1b26", "#c0caf5", "#24283b", "#16161e", "#7aa2f7"),
    "github-light",
    "tokyo-night",
  ),
  preset(
    "vercel",
    "Vercel",
    seed("#ffffff", "#171717", "#ffffff", "#fafafa", "#000000"),
    seed("#000000", "#ededed", "#0a0a0a", "#050505", "#ffffff"),
    "min-light",
    "vitesse-black",
  ),
  preset(
    "vs-code-plus",
    "VS Code Plus",
    seed("#ffffff", "#1e1e1e", "#f7f7f7", "#f3f3f3", "#0078d4"),
    seed("#1e1e1e", "#d4d4d4", "#252526", "#181818", "#007acc"),
    "light-plus",
    "dark-plus",
  ),
  preset(
    "xcode",
    "Xcode",
    seed("#ffffff", "#262626", "#f8f8f8", "#f1f1f1", "#0a84ff"),
    seed("#1f1f24", "#f2f2f7", "#29292e", "#19191d", "#0a84ff"),
    "light-plus",
    "dark-plus",
  ),
] as const satisfies ReadonlyArray<ThemePreset>;

export type ThemePresetId = (typeof THEME_PRESETS)[number]["id"];

export const DEFAULT_THEME_PRESET_ID: ThemePresetId = "t3-code";
let activeThemePresetId: ThemePresetId = DEFAULT_THEME_PRESET_ID;
export const THEME_PRESET_BY_ID = new Map<ThemePresetId, ThemePreset>(
  THEME_PRESETS.map((item) => [item.id, item]),
);

export interface ThemeColorOverrides {
  readonly accent: string | null;
  readonly background: string | null;
  readonly foreground: string | null;
}

export interface AppearancePreferences {
  readonly presetId: ThemePresetId;
  readonly colors: Readonly<Record<ThemeMode, ThemeColorOverrides>>;
  readonly uiFont: string;
  readonly codeFont: string;
  readonly translucentSidebar: boolean;
  readonly contrast: number;
  readonly pointerCursors: boolean;
  readonly reduceMotion: ReduceMotionPreference;
  readonly uiFontSize: number;
  readonly codeFontSize: number;
  readonly diffMarkers: DiffMarkerPreference;
}

const EMPTY_COLOR_OVERRIDES: ThemeColorOverrides = {
  accent: null,
  background: null,
  foreground: null,
};

export const DEFAULT_APPEARANCE_PREFERENCES: AppearancePreferences = {
  presetId: DEFAULT_THEME_PRESET_ID,
  colors: { light: EMPTY_COLOR_OVERRIDES, dark: EMPTY_COLOR_OVERRIDES },
  uiFont: "Geist, Inter",
  codeFont: "Geist Mono",
  translucentSidebar: false,
  contrast: 50,
  pointerCursors: true,
  reduceMotion: "system",
  uiFontSize: 14,
  codeFontSize: 12,
  diffMarkers: "color",
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const FONT_FAMILY_NAME = /^[\p{L}\p{N} _.-]+$/u;
const MAX_FONT_STACK_LENGTH = 200;
const MAX_FONT_FAMILY_LENGTH = 64;
const MAX_FONT_FAMILY_COUNT = 8;
const CSS_WIDE_KEYWORDS = new Set(["inherit", "initial", "revert", "revert-layer", "unset"]);
const GENERIC_FONT_FAMILIES = new Set([
  "cursive",
  "emoji",
  "fangsong",
  "fantasy",
  "math",
  "monospace",
  "sans-serif",
  "serif",
  "system-ui",
  "ui-monospace",
  "ui-rounded",
  "ui-sans-serif",
  "ui-serif",
]);
const LEGACY_UI_FONT_VALUES: Readonly<Record<string, string>> = {
  geist: "Geist, Inter",
  "dm-sans": "Geist, Inter",
  inter: "Inter",
  system: "system-ui",
};
const LEGACY_CODE_FONT_VALUES: Readonly<Record<string, string>> = {
  "geist-mono": "Geist Mono",
  "jetbrains-mono": "Geist Mono",
  "sf-mono": "SF Mono",
  system: "ui-monospace",
};
const UI_FONT_FALLBACKS = [
  { name: "system-ui", css: "system-ui" },
  { name: "sans-serif", css: "sans-serif" },
] as const;
const CODE_FONT_FALLBACKS = [
  { name: "ui-monospace", css: "ui-monospace" },
  { name: "SFMono-Regular", css: '"SFMono-Regular"' },
  { name: "Consolas", css: "Consolas" },
  { name: "monospace", css: "monospace" },
] as const;

export function isThemePresetId(value: unknown): value is ThemePresetId {
  return typeof value === "string" && THEME_PRESET_BY_ID.has(value as ThemePresetId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, Math.round(value)))
    : fallback;
}

function colorOverride(value: unknown): string | null {
  return typeof value === "string" && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

function normalizeColors(value: unknown, mode: ThemeMode): ThemeColorOverrides {
  const source = isRecord(value) && isRecord(value[mode]) ? value[mode] : {};
  return {
    accent: colorOverride(source.accent),
    background: colorOverride(source.background),
    foreground: colorOverride(source.foreground),
  };
}

function parseFontStack(value: unknown): string[] | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_FONT_STACK_LENGTH) return null;

  const rawFamilies = trimmed.split(",");
  if (rawFamilies.length > MAX_FONT_FAMILY_COUNT) return null;
  const families: string[] = [];
  for (const rawFamily of rawFamilies) {
    let family = rawFamily.trim();
    if (
      family.length >= 2 &&
      ((family.startsWith('"') && family.endsWith('"')) ||
        (family.startsWith("'") && family.endsWith("'")))
    ) {
      family = family.slice(1, -1).trim();
    } else if (
      family.startsWith('"') ||
      family.endsWith('"') ||
      family.startsWith("'") ||
      family.endsWith("'")
    ) {
      return null;
    }
    family = family.replace(/\s+/g, " ");
    if (
      !family ||
      family.length > MAX_FONT_FAMILY_LENGTH ||
      !FONT_FAMILY_NAME.test(family) ||
      CSS_WIDE_KEYWORDS.has(family.toLowerCase())
    ) {
      return null;
    }
    if (!families.some((candidate) => candidate.toLowerCase() === family.toLowerCase())) {
      families.push(family);
    }
  }
  return families.length > 0 ? families : null;
}

function normalizeFontStack(
  value: unknown,
  fallback: string,
  legacyValues: Readonly<Record<string, string>>,
): string {
  const migrated = typeof value === "string" ? (legacyValues[value] ?? value) : value;
  return parseFontStack(migrated)?.join(", ") ?? fallback;
}

function resolveFontStackCss(
  value: string,
  fallbacks: ReadonlyArray<{ readonly name: string; readonly css: string }>,
): string {
  const families = parseFontStack(value) ?? [];
  const seen = new Set(families.map((family) => family.toLowerCase()));
  const cssFamilies = families.map((family) =>
    GENERIC_FONT_FAMILIES.has(family.toLowerCase())
      ? family.toLowerCase()
      : `"${family.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`,
  );
  for (const fallback of fallbacks) {
    if (seen.has(fallback.name.toLowerCase())) continue;
    cssFamilies.push(fallback.css);
  }
  return cssFamilies.join(", ");
}

export function normalizeAppearancePreferences(value: unknown): AppearancePreferences {
  if (!isRecord(value)) return DEFAULT_APPEARANCE_PREFERENCES;

  const uiFont = normalizeFontStack(
    value.uiFont,
    DEFAULT_APPEARANCE_PREFERENCES.uiFont,
    LEGACY_UI_FONT_VALUES,
  );
  const codeFont = normalizeFontStack(
    value.codeFont,
    DEFAULT_APPEARANCE_PREFERENCES.codeFont,
    LEGACY_CODE_FONT_VALUES,
  );

  return {
    presetId: isThemePresetId(value.presetId) ? value.presetId : DEFAULT_THEME_PRESET_ID,
    colors: {
      light: normalizeColors(value.colors, "light"),
      dark: normalizeColors(value.colors, "dark"),
    },
    uiFont,
    codeFont,
    translucentSidebar:
      typeof value.translucentSidebar === "boolean"
        ? value.translucentSidebar
        : DEFAULT_APPEARANCE_PREFERENCES.translucentSidebar,
    contrast: boundedInteger(value.contrast, DEFAULT_APPEARANCE_PREFERENCES.contrast, 0, 100),
    pointerCursors:
      typeof value.pointerCursors === "boolean"
        ? value.pointerCursors
        : DEFAULT_APPEARANCE_PREFERENCES.pointerCursors,
    reduceMotion:
      value.reduceMotion === "on" || value.reduceMotion === "off" || value.reduceMotion === "system"
        ? value.reduceMotion
        : DEFAULT_APPEARANCE_PREFERENCES.reduceMotion,
    uiFontSize: boundedInteger(value.uiFontSize, DEFAULT_APPEARANCE_PREFERENCES.uiFontSize, 12, 20),
    codeFontSize: boundedInteger(
      value.codeFontSize,
      DEFAULT_APPEARANCE_PREFERENCES.codeFontSize,
      10,
      20,
    ),
    diffMarkers:
      value.diffMarkers === "symbols" || value.diffMarkers === "color"
        ? value.diffMarkers
        : DEFAULT_APPEARANCE_PREFERENCES.diffMarkers,
  };
}

export function getThemePreset(id: ThemePresetId): ThemePreset {
  return THEME_PRESET_BY_ID.get(id) ?? THEME_PRESET_BY_ID.get(DEFAULT_THEME_PRESET_ID)!;
}

export function getThemeSeed(preferences: AppearancePreferences, mode: ThemeMode): ThemeSeed {
  const base = getThemePreset(preferences.presetId)[mode];
  const overrides = preferences.colors[mode];
  return {
    ...base,
    accent: overrides.accent ?? base.accent,
    background: overrides.background ?? base.background,
    foreground: overrides.foreground ?? base.foreground,
  };
}

export function resolveSyntaxThemeName(
  mode: ThemeMode,
  presetId: ThemePresetId = activeThemePresetId,
): DiffsThemeNames {
  return getThemePreset(presetId).syntax[mode];
}

export function setActiveThemePresetId(presetId: ThemePresetId): void {
  activeThemePresetId = presetId;
}

export function resolveThemeCssVariables(
  preferences: AppearancePreferences,
  mode: ThemeMode,
): Readonly<Record<string, string>> {
  const colors = getThemeSeed(preferences, mode);
  const foregroundMix = 4 + Math.round(preferences.contrast * 0.08);
  const borderMix = 6 + Math.round(preferences.contrast * 0.12);
  const mutedForegroundMix = 48 + Math.round(preferences.contrast * 0.18);
  const rgb = [1, 3, 5].map((index) => Number.parseInt(colors.accent.slice(index, index + 2), 16));
  const luminance = rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4))
    .reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index]!, 0);
  const onAccent = luminance > 0.36 ? "#080808" : "#ffffff";
  const mix = (left: string, leftAmount: number, right: string) =>
    `color-mix(in srgb, ${left} ${leftAmount}%, ${right})`;
  const subtle = mix(colors.foreground, foregroundMix, colors.background);
  const sidebar = preferences.translucentSidebar
    ? mix(colors.sidebar, 84, "transparent")
    : colors.sidebar;
  const success = mode === "dark" ? "#4ade80" : "#16a34a";
  const warning = mode === "dark" ? "#fbbf24" : "#d97706";
  const destructive = mode === "dark" ? "#fb7185" : "#dc2626";
  const info = mode === "dark" ? "#60a5fa" : "#2563eb";
  return {
    "--background": colors.background,
    "--app-chrome-background": preferences.translucentSidebar ? "transparent" : colors.background,
    "--surface-raised": mix(colors.surface, 88, colors.background),
    "--foreground": colors.foreground,
    "--card": colors.surface,
    "--card-foreground": colors.foreground,
    "--popover": mix(colors.surface, 94, colors.foreground),
    "--popover-foreground": colors.foreground,
    "--primary": colors.accent,
    "--primary-foreground": onAccent,
    "--secondary": subtle,
    "--secondary-foreground": colors.foreground,
    "--muted": subtle,
    "--muted-foreground": mix(colors.foreground, mutedForegroundMix, colors.background),
    "--accent": mix(colors.accent, 12, colors.background),
    "--accent-foreground": colors.foreground,
    "--destructive": destructive,
    "--destructive-foreground": destructive,
    "--border": mix(colors.foreground, borderMix, colors.background),
    "--input": mix(colors.foreground, borderMix + 5, colors.background),
    "--ring": colors.accent,
    "--info": info,
    "--info-foreground": info,
    "--success": success,
    "--success-foreground": success,
    "--warning": warning,
    "--warning-foreground": warning,
    "--sidebar": sidebar,
    "--sidebar-foreground": colors.foreground,
    "--sidebar-muted-foreground": mix(colors.foreground, mutedForegroundMix, colors.sidebar),
    "--sidebar-control-surface": mix(colors.foreground, foregroundMix + 2, colors.sidebar),
    "--sidebar-row-hover": mix(colors.accent, 8, colors.sidebar),
    "--sidebar-row-active": mix(colors.accent, 13, colors.sidebar),
    "--sidebar-row-selected": mix(colors.accent, 10, colors.sidebar),
    "--sidebar-border": mix(colors.foreground, borderMix, colors.sidebar),
    "--sidebar-stage-fade": sidebar,
    "--app-scrollbar-thumb": mix(colors.foreground, 15, "transparent"),
    "--app-scrollbar-thumb-hover": mix(colors.foreground, 25, "transparent"),
    "--font-sans": resolveFontStackCss(preferences.uiFont, UI_FONT_FALLBACKS),
    "--font-mono": resolveFontStackCss(preferences.codeFont, CODE_FONT_FALLBACKS),
    "--ui-font-size": `${preferences.uiFontSize}px`,
    "--code-font-size": `${preferences.codeFontSize}px`,
  };
}
