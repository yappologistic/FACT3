import { safeErrorLogAttributes } from "@t3tools/client-runtime/errors";
import type { DesktopBridge } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  DEFAULT_APPEARANCE_PREFERENCES,
  type AppearancePreferences,
  normalizeAppearancePreferences,
  resolveSyntaxThemeName,
  resolveThemeCssVariables,
  setActiveThemePresetId,
} from "../lib/themeCatalog";

const ThemePreference = Schema.Literals(["light", "dark", "system"]);
export type Theme = typeof ThemePreference.Type;

type ThemeSnapshot = {
  theme: Theme;
  systemDark: boolean;
  appearance: AppearancePreferences;
  appearanceSignature: string;
};

type DesktopThemeBridge = Pick<DesktopBridge, "setTheme">;
type DesktopWindowTranslucencyBridge = Pick<DesktopBridge, "setWindowTranslucency">;

const STORAGE_KEY = "t3code:theme";
export const APPEARANCE_STORAGE_KEY = "t3code:appearance:v1";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";
const DEFAULT_APPEARANCE_SIGNATURE = JSON.stringify(DEFAULT_APPEARANCE_PREFERENCES);
const DEFAULT_THEME_SNAPSHOT: ThemeSnapshot = {
  theme: "system",
  systemDark: false,
  appearance: DEFAULT_APPEARANCE_PREFERENCES,
  appearanceSignature: DEFAULT_APPEARANCE_SIGNATURE,
};
const THEME_COLOR_META_NAME = "theme-color";
const DYNAMIC_THEME_COLOR_SELECTOR = `meta[name="${THEME_COLOR_META_NAME}"][data-dynamic-theme-color="true"]`;

export class ThemeStorageError extends Schema.TaggedErrorClass<ThemeStorageError>()(
  "ThemeStorageError",
  {
    operation: Schema.Literals(["read", "write"]),
    storageKey: Schema.String,
    theme: Schema.optional(ThemePreference),
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.operation} theme preference for ${this.storageKey}.`;
  }
}

export const isThemeStorageError = Schema.is(ThemeStorageError);

export class DesktopThemeSyncError extends Schema.TaggedErrorClass<DesktopThemeSyncError>()(
  "DesktopThemeSyncError",
  {
    theme: ThemePreference,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to sync the ${this.theme} theme to the desktop shell.`;
  }
}

export const isDesktopThemeSyncError = Schema.is(DesktopThemeSyncError);

export class DesktopWindowTranslucencySyncError extends Schema.TaggedErrorClass<DesktopWindowTranslucencySyncError>()(
  "DesktopWindowTranslucencySyncError",
  {
    enabled: Schema.Boolean,
    cause: Schema.Defect(),
  },
) {
  override get message(): string {
    return `Failed to ${this.enabled ? "enable" : "disable"} desktop window translucency.`;
  }
}

export const isDesktopWindowTranslucencySyncError = Schema.is(DesktopWindowTranslucencySyncError);

let listeners: Array<() => void> = [];
let removeBrowserListeners: (() => void) | null = null;
let lastSnapshot: ThemeSnapshot | null = null;
let lastDesktopTheme: Theme | null = null;
let lastDesktopWindowTranslucency: boolean | null = null;
let lastAppliedSignature: string | null = null;
const storageReadFailures = new Map<string, ThemeStorageError>();

function emitChange() {
  for (const listener of listeners) listener();
}

function getSystemDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(MEDIA_QUERY).matches
  );
}

function readStorage(storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(storageKey);
  } catch (cause) {
    throw new ThemeStorageError({ operation: "read", storageKey, cause });
  }
}

function writeStorage(storageKey: string, value: string, theme?: Theme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(storageKey, value);
    storageReadFailures.delete(storageKey);
  } catch (cause) {
    throw new ThemeStorageError({ operation: "write", storageKey, theme, cause });
  }
}

export function readThemePreference(): Theme {
  const raw = readStorage(STORAGE_KEY);
  if (raw === "light" || raw === "dark" || raw === "system") return raw;
  return DEFAULT_THEME_SNAPSHOT.theme;
}

export function writeThemePreference(theme: Theme): void {
  writeStorage(STORAGE_KEY, theme, theme);
  lastSnapshot = null;
}

export function readAppearancePreferences(): AppearancePreferences {
  const raw = readStorage(APPEARANCE_STORAGE_KEY);
  if (!raw) return DEFAULT_APPEARANCE_PREFERENCES;
  try {
    return normalizeAppearancePreferences(JSON.parse(raw));
  } catch {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

export function writeAppearancePreferences(preferences: AppearancePreferences): void {
  writeStorage(APPEARANCE_STORAGE_KEY, JSON.stringify(normalizeAppearancePreferences(preferences)));
  lastSnapshot = null;
}

function logStorageFailure(cause: unknown, storageKey: string): ThemeStorageError {
  const error = isThemeStorageError(cause)
    ? cause
    : new ThemeStorageError({ operation: "read", storageKey, cause });
  storageReadFailures.set(storageKey, error);
  console.error(error.message, {
    operation: error.operation,
    storageKey: error.storageKey,
    ...safeErrorLogAttributes(error),
  });
  return error;
}

function getStored(): Theme {
  if (storageReadFailures.has(STORAGE_KEY)) return DEFAULT_THEME_SNAPSHOT.theme;
  try {
    return readThemePreference();
  } catch (cause) {
    logStorageFailure(cause, STORAGE_KEY);
    return DEFAULT_THEME_SNAPSHOT.theme;
  }
}

function getStoredAppearance(): AppearancePreferences {
  if (storageReadFailures.has(APPEARANCE_STORAGE_KEY)) {
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
  try {
    return readAppearancePreferences();
  } catch (cause) {
    logStorageFailure(cause, APPEARANCE_STORAGE_KEY);
    return DEFAULT_APPEARANCE_PREFERENCES;
  }
}

function ensureThemeColorMetaTag(): HTMLMetaElement {
  let element = document.querySelector<HTMLMetaElement>(DYNAMIC_THEME_COLOR_SELECTOR);
  if (element) return element;

  element = document.createElement("meta");
  element.name = THEME_COLOR_META_NAME;
  element.setAttribute("data-dynamic-theme-color", "true");
  document.head.append(element);
  return element;
}

function normalizeThemeColor(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  if (
    !normalizedValue ||
    normalizedValue === "transparent" ||
    normalizedValue === "rgba(0, 0, 0, 0)" ||
    normalizedValue === "rgba(0 0 0 / 0)"
  ) {
    return null;
  }
  return value?.trim() ?? null;
}

function resolveBrowserChromeSurface(): HTMLElement {
  return (
    document.querySelector<HTMLElement>("main[data-slot='sidebar-inset']") ??
    document.querySelector<HTMLElement>("[data-slot='sidebar-inner']") ??
    document.body
  );
}

export function syncBrowserChromeTheme() {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return;
  const translucent = document.documentElement.getAttribute("data-translucent-sidebar") === "true";
  const surfaceColor = normalizeThemeColor(
    getComputedStyle(resolveBrowserChromeSurface()).backgroundColor,
  );
  const fallbackColor = normalizeThemeColor(getComputedStyle(document.body).backgroundColor);
  const backgroundColor = surfaceColor ?? fallbackColor;
  if (translucent) {
    document.documentElement.style.backgroundColor = "transparent";
    document.body.style.backgroundColor = "transparent";
    if (backgroundColor) ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
    return;
  }
  if (!backgroundColor) return;

  document.documentElement.style.backgroundColor = backgroundColor;
  document.body.style.backgroundColor = backgroundColor;
  ensureThemeColorMetaTag().setAttribute("content", backgroundColor);
}

function applyAppearance(preferences: AppearancePreferences, resolvedTheme: "light" | "dark") {
  if (typeof document === "undefined") return;
  setActiveThemePresetId(preferences.presetId);
  const root = document.documentElement;
  const style = root.style;
  if (style && typeof style.setProperty === "function") {
    for (const [name, value] of Object.entries(
      resolveThemeCssVariables(preferences, resolvedTheme),
    )) {
      style.setProperty(name, value);
    }
  }
  if (typeof root.setAttribute === "function") {
    root.setAttribute("data-theme-preset", preferences.presetId);
    root.setAttribute("data-translucent-sidebar", String(preferences.translucentSidebar));
    root.setAttribute("data-pointer-cursors", String(preferences.pointerCursors));
    root.setAttribute("data-reduce-motion", preferences.reduceMotion);
    root.setAttribute("data-diff-markers", preferences.diffMarkers);
  }
}

function applyTheme(theme: Theme, appearance: AppearancePreferences, suppressTransitions = false) {
  if (typeof document === "undefined" || typeof window === "undefined") return;
  const systemDark = theme === "system" ? getSystemDark() : false;
  const resolvedTheme = theme === "dark" || (theme === "system" && systemDark) ? "dark" : "light";
  const signature = `${theme}:${systemDark}:${JSON.stringify(appearance)}`;
  if (lastAppliedSignature === signature) {
    syncDesktopTheme(theme);
    syncDesktopWindowTranslucency(appearance.translucentSidebar);
    return;
  }

  if (suppressTransitions) document.documentElement.classList.add("no-transitions");
  document.documentElement.classList.toggle("dark", resolvedTheme === "dark");
  applyAppearance(appearance, resolvedTheme);
  lastAppliedSignature = signature;
  syncBrowserChromeTheme();
  syncDesktopTheme(theme);
  syncDesktopWindowTranslucency(appearance.translucentSidebar);
  if (suppressTransitions) {
    // Force a reflow so the no-transitions class takes effect before removal.
    // oxlint-disable-next-line no-unused-expressions
    document.documentElement.offsetHeight;
    requestAnimationFrame(() => {
      document.documentElement.classList.remove("no-transitions");
    });
  }
}

export async function syncDesktopThemePreference(
  bridge: DesktopThemeBridge,
  theme: Theme,
): Promise<void> {
  try {
    await bridge.setTheme(theme);
  } catch (cause) {
    throw new DesktopThemeSyncError({ theme, cause });
  }
}

export function syncDesktopTheme(theme: Theme) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (!bridge || typeof bridge.setTheme !== "function" || lastDesktopTheme === theme) return;

  lastDesktopTheme = theme;
  void syncDesktopThemePreference(bridge, theme).catch((cause: unknown) => {
    const error = isDesktopThemeSyncError(cause)
      ? cause
      : new DesktopThemeSyncError({ theme, cause });
    console.error(error.message, {
      theme: error.theme,
      ...safeErrorLogAttributes(error),
    });
    if (lastDesktopTheme === theme) lastDesktopTheme = null;
  });
}

export async function syncDesktopWindowTranslucencyPreference(
  bridge: DesktopWindowTranslucencyBridge,
  enabled: boolean,
): Promise<void> {
  try {
    await bridge.setWindowTranslucency(enabled);
  } catch (cause) {
    throw new DesktopWindowTranslucencySyncError({ enabled, cause });
  }
}

export function syncDesktopWindowTranslucency(enabled: boolean) {
  if (typeof window === "undefined") return;
  const bridge = window.desktopBridge;
  if (
    !bridge ||
    typeof bridge.setWindowTranslucency !== "function" ||
    lastDesktopWindowTranslucency === enabled
  ) {
    return;
  }

  lastDesktopWindowTranslucency = enabled;
  void syncDesktopWindowTranslucencyPreference(bridge, enabled).catch((cause: unknown) => {
    const error = isDesktopWindowTranslucencySyncError(cause)
      ? cause
      : new DesktopWindowTranslucencySyncError({ enabled, cause });
    console.error(error.message, {
      enabled: error.enabled,
      ...safeErrorLogAttributes(error),
    });
    if (lastDesktopWindowTranslucency === enabled) lastDesktopWindowTranslucency = null;
  });
}

// Apply immediately on module load to prevent a flash of the default palette.
if (typeof document !== "undefined" && typeof window !== "undefined") {
  applyTheme(getStored(), getStoredAppearance());
}

function getSnapshot(): ThemeSnapshot {
  if (typeof window === "undefined") return DEFAULT_THEME_SNAPSHOT;
  if (lastSnapshot) return lastSnapshot;

  const theme = getStored();
  const appearance = getStoredAppearance();
  return updateSnapshot(theme, appearance);
}

function updateSnapshot(theme: Theme, appearance: AppearancePreferences): ThemeSnapshot {
  const appearanceSignature = JSON.stringify(appearance);
  const systemDark = theme === "system" ? getSystemDark() : false;

  if (
    lastSnapshot &&
    lastSnapshot.theme === theme &&
    lastSnapshot.systemDark === systemDark &&
    lastSnapshot.appearanceSignature === appearanceSignature
  ) {
    return lastSnapshot;
  }

  lastSnapshot = { theme, systemDark, appearance, appearanceSignature };
  return lastSnapshot;
}

function getServerSnapshot() {
  return DEFAULT_THEME_SNAPSHOT;
}

function subscribe(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  listeners.push(listener);

  if (removeBrowserListeners === null) {
    const mq = typeof window.matchMedia === "function" ? window.matchMedia(MEDIA_QUERY) : null;
    const handleChange = () => {
      const theme = getStored();
      const appearance = getStoredAppearance();
      if (theme === "system") applyTheme(theme, appearance, true);
      updateSnapshot(theme, appearance);
      emitChange();
    };
    mq?.addEventListener("change", handleChange);

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== APPEARANCE_STORAGE_KEY) return;
      if (event.key) storageReadFailures.delete(event.key);
      const theme = getStored();
      const appearance = getStoredAppearance();
      applyTheme(theme, appearance, true);
      updateSnapshot(theme, appearance);
      emitChange();
    };
    window.addEventListener("storage", handleStorage);

    removeBrowserListeners = () => {
      mq?.removeEventListener("change", handleChange);
      window.removeEventListener("storage", handleStorage);
      removeBrowserListeners = null;
    };
  }

  return () => {
    listeners = listeners.filter((candidate) => candidate !== listener);
    if (listeners.length === 0) {
      removeBrowserListeners?.();
      // A system-theme change can happen while no consumer is mounted. Make
      // the next mount re-read both the media query and persisted preferences.
      lastSnapshot = null;
    }
  };
}

export function useTheme() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const { theme, appearance } = snapshot;
  const resolvedTheme: "light" | "dark" =
    theme === "system" ? (snapshot.systemDark ? "dark" : "light") : theme;

  const setTheme = useCallback((next: Theme) => {
    if (typeof window === "undefined") return;
    try {
      writeThemePreference(next);
    } catch (cause) {
      const error = isThemeStorageError(cause)
        ? cause
        : new ThemeStorageError({
            operation: "write",
            storageKey: STORAGE_KEY,
            theme: next,
            cause,
          });
      console.error(error.message, {
        operation: error.operation,
        storageKey: error.storageKey,
        theme: next,
        ...safeErrorLogAttributes(error),
      });
      return;
    }
    const appearance = getStoredAppearance();
    applyTheme(next, appearance, true);
    updateSnapshot(next, appearance);
    emitChange();
  }, []);

  const setAppearance = useCallback(
    (next: AppearancePreferences | ((current: AppearancePreferences) => AppearancePreferences)) => {
      if (typeof window === "undefined") return;
      const normalized = normalizeAppearancePreferences(
        typeof next === "function" ? next(appearance) : next,
      );
      try {
        writeAppearancePreferences(normalized);
      } catch (cause) {
        const error = isThemeStorageError(cause)
          ? cause
          : new ThemeStorageError({
              operation: "write",
              storageKey: APPEARANCE_STORAGE_KEY,
              cause,
            });
        console.error(error.message, {
          operation: error.operation,
          storageKey: error.storageKey,
          ...safeErrorLogAttributes(error),
        });
        return;
      }
      applyTheme(theme, normalized, true);
      updateSnapshot(theme, normalized);
      emitChange();
    },
    [appearance, theme],
  );

  useEffect(() => {
    applyTheme(theme, appearance);
  }, [appearance, theme]);

  return {
    theme,
    setTheme,
    resolvedTheme,
    appearance,
    setAppearance,
    syntaxTheme: resolveSyntaxThemeName(resolvedTheme, appearance.presetId),
    diffIndicators: appearance.diffMarkers === "symbols" ? ("classic" as const) : ("bars" as const),
  } as const;
}
