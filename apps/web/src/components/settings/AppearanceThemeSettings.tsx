import { CheckIcon, ClipboardIcon, ImportIcon, MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useTheme, type Theme } from "../../hooks/useTheme";
import {
  DEFAULT_APPEARANCE_PREFERENCES,
  THEME_PRESETS,
  getThemeSeed,
  normalizeAppearancePreferences,
  type AppearancePreferences,
  type ThemeColorOverrides,
  type ThemeMode,
} from "../../lib/themeCatalog";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import { ColorPicker } from "../ui/color-picker";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import { SettingResetButton, SettingsRow } from "./settingsLayout";

const MODE_OPTIONS: ReadonlyArray<{
  readonly value: Theme;
  readonly label: string;
  readonly description: string;
  readonly icon: typeof MonitorIcon;
}> = [
  { value: "system", label: "System", description: "Follow Windows", icon: MonitorIcon },
  { value: "light", label: "Light", description: "Always light", icon: SunIcon },
  { value: "dark", label: "Dark", description: "Always dark", icon: MoonIcon },
];

const EMPTY_OVERRIDES: ThemeColorOverrides = {
  accent: null,
  background: null,
  foreground: null,
};

function FontFamilyInput(props: {
  readonly label: string;
  readonly onCommit: (value: string) => string;
  readonly value: string;
}) {
  const [draft, setDraft] = useState(props.value);
  useEffect(() => setDraft(props.value), [props.value]);

  const commit = () => setDraft(props.onCommit(draft));

  return (
    <input
      aria-label={props.label}
      className="h-9 w-full rounded-lg border border-input bg-card px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-foreground/25 focus:ring-2 focus:ring-ring/25 sm:w-64"
      spellCheck={false}
      type="text"
      value={draft}
      onBlur={commit}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(props.value);
          event.currentTarget.blur();
        }
      }}
    />
  );
}

function ModeCard(props: {
  readonly active: boolean;
  readonly description: string;
  readonly icon: typeof MonitorIcon;
  readonly label: string;
  readonly onClick: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      aria-pressed={props.active}
      className={cn(
        "group relative flex min-h-24 flex-col justify-between rounded-xl border p-3 text-left transition-colors",
        props.active
          ? "border-primary bg-primary/7 shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_18%,transparent)]"
          : "border-border/70 bg-card/55 hover:border-foreground/20 hover:bg-card",
      )}
      onClick={props.onClick}
    >
      <div className="flex w-full items-center justify-between">
        <Icon className={cn("size-4", props.active ? "text-primary" : "text-muted-foreground")} />
        {props.active ? (
          <span className="grid size-4 place-items-center rounded-full bg-primary text-primary-foreground">
            <CheckIcon className="size-2.5" strokeWidth={3} />
          </span>
        ) : null}
      </div>
      <span>
        <span className="block text-sm font-medium text-foreground">{props.label}</span>
        <span className="block text-xs text-muted-foreground">{props.description}</span>
      </span>
    </button>
  );
}

function ColorControl(props: {
  readonly label: "Accent" | "Background" | "Foreground";
  readonly mode: ThemeMode;
  readonly value: string;
  readonly overridden: boolean;
  readonly onChange: (value: string | null) => void;
}) {
  return (
    <SettingsRow
      title={props.label}
      description={`Override the ${props.label.toLowerCase()} for ${props.mode} mode.`}
      resetAction={
        props.overridden ? (
          <SettingResetButton
            label={`${props.mode} ${props.label.toLowerCase()}`}
            onClick={() => props.onChange(null)}
          />
        ) : null
      }
      control={
        <ColorPicker
          label={`${props.mode} ${props.label.toLowerCase()} color`}
          value={props.value}
          onValueChange={props.onChange}
        />
      }
    />
  );
}

function updateModeColor(
  preferences: AppearancePreferences,
  mode: ThemeMode,
  key: keyof ThemeColorOverrides,
  value: string | null,
): AppearancePreferences {
  return {
    ...preferences,
    colors: {
      ...preferences.colors,
      [mode]: { ...preferences.colors[mode], [key]: value },
    },
  };
}

export function AppearanceThemeSettings() {
  const { appearance, resolvedTheme, setAppearance, setTheme, theme } = useTheme();
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const activeColors = getThemeSeed(appearance, resolvedTheme);
  const activeOverrides = appearance.colors[resolvedTheme];

  const setPreference = <Key extends keyof AppearancePreferences>(
    key: Key,
    value: AppearancePreferences[Key],
  ) => setAppearance((current) => ({ ...current, [key]: value }));

  const copyTheme = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(appearance, null, 2));
      setStatusMessage("Theme copied to clipboard.");
    } catch {
      setStatusMessage("Could not access the clipboard.");
    }
  };
  const commitFont = (key: "uiFont" | "codeFont", value: string) => {
    const normalized = normalizeAppearancePreferences({ ...appearance, [key]: value })[key];
    setPreference(key, normalized);
    return normalized;
  };

  const importTheme = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed: unknown = JSON.parse(await file.text());
      setAppearance(normalizeAppearancePreferences(parsed));
      setStatusMessage("Theme imported.");
    } catch {
      setStatusMessage("That file is not a valid FACT3 Code theme.");
    } finally {
      if (importInputRef.current) importInputRef.current.value = "";
    }
  };

  return (
    <>
      <div className="border-b border-border/70 px-4 py-4 sm:px-5">
        <div className="mb-3">
          <h3 className="text-sm font-medium text-foreground">Mode</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Choose when the light and dark palettes are used.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {MODE_OPTIONS.map((option) => (
            <ModeCard
              active={theme === option.value}
              description={option.description}
              icon={option.icon}
              key={option.value}
              label={option.label}
              onClick={() => setTheme(option.value)}
            />
          ))}
        </div>
      </div>

      <SettingsRow
        title="Color theme"
        description={`Choose the palette and syntax colors used in ${resolvedTheme} mode.`}
        resetAction={
          appearance.presetId !== DEFAULT_APPEARANCE_PREFERENCES.presetId ? (
            <SettingResetButton
              label="color theme"
              onClick={() =>
                setAppearance((current) => ({
                  ...current,
                  presetId: DEFAULT_APPEARANCE_PREFERENCES.presetId,
                  colors: DEFAULT_APPEARANCE_PREFERENCES.colors,
                }))
              }
            />
          ) : null
        }
        control={
          <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
            <input
              ref={importInputRef}
              className="sr-only"
              type="file"
              accept="application/json,.json"
              aria-label="Import theme file"
              onChange={(event) => void importTheme(event.currentTarget.files?.[0])}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => importInputRef.current?.click()}
            >
              <ImportIcon className="size-3.5" />
              Import
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 gap-1.5"
              onClick={() => void copyTheme()}
            >
              <ClipboardIcon className="size-3.5" />
              Copy theme
            </Button>
            <Select
              value={appearance.presetId}
              onValueChange={(value) => {
                const selected = THEME_PRESETS.find((candidate) => candidate.id === value);
                if (!selected) return;
                setAppearance((current) => ({
                  ...current,
                  presetId: selected.id,
                  colors: { light: EMPTY_OVERRIDES, dark: EMPTY_OVERRIDES },
                }));
              }}
            >
              <SelectTrigger className="w-44" aria-label="Color theme preset">
                <SelectValue>
                  {THEME_PRESETS.find((item) => item.id === appearance.presetId)?.label ??
                    "FACT3 Code"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false} className="max-h-80">
                {THEME_PRESETS.map((item) => (
                  <SelectItem hideIndicator key={item.id} value={item.id}>
                    <span className="flex items-center gap-2">
                      <span
                        className="size-2.5 rounded-full ring-1 ring-foreground/10"
                        style={{ backgroundColor: item[resolvedTheme].accent }}
                      />
                      {item.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          </div>
        }
      />

      {statusMessage ? (
        <div
          className="border-b border-border/70 bg-muted/45 px-5 py-2 text-xs text-muted-foreground"
          role="status"
        >
          {statusMessage}
        </div>
      ) : null}

      <ColorControl
        label="Accent"
        mode={resolvedTheme}
        value={activeColors.accent}
        overridden={activeOverrides.accent !== null}
        onChange={(value) =>
          setAppearance((current) => updateModeColor(current, resolvedTheme, "accent", value))
        }
      />
      <ColorControl
        label="Background"
        mode={resolvedTheme}
        value={activeColors.background}
        overridden={activeOverrides.background !== null}
        onChange={(value) =>
          setAppearance((current) => updateModeColor(current, resolvedTheme, "background", value))
        }
      />
      <ColorControl
        label="Foreground"
        mode={resolvedTheme}
        value={activeColors.foreground}
        overridden={activeOverrides.foreground !== null}
        onChange={(value) =>
          setAppearance((current) => updateModeColor(current, resolvedTheme, "foreground", value))
        }
      />

      <SettingsRow
        title="UI font"
        description="Font used across navigation, conversations, and settings."
        resetAction={
          appearance.uiFont !== DEFAULT_APPEARANCE_PREFERENCES.uiFont ? (
            <SettingResetButton
              label="UI font"
              onClick={() => setPreference("uiFont", DEFAULT_APPEARANCE_PREFERENCES.uiFont)}
            />
          ) : null
        }
        control={
          <FontFamilyInput
            label="UI font"
            value={appearance.uiFont}
            onCommit={(value) => commitFont("uiFont", value)}
          />
        }
      />

      <SettingsRow
        title="Code font"
        description="Monospaced font used for code, diffs, and file previews."
        resetAction={
          appearance.codeFont !== DEFAULT_APPEARANCE_PREFERENCES.codeFont ? (
            <SettingResetButton
              label="code font"
              onClick={() => setPreference("codeFont", DEFAULT_APPEARANCE_PREFERENCES.codeFont)}
            />
          ) : null
        }
        control={
          <FontFamilyInput
            label="Code font"
            value={appearance.codeFont}
            onCommit={(value) => commitFont("codeFont", value)}
          />
        }
      />

      <SettingsRow
        title="Translucent sidebar"
        description="Let the workspace subtly show through the navigation surface."
        resetAction={
          appearance.translucentSidebar !== DEFAULT_APPEARANCE_PREFERENCES.translucentSidebar ? (
            <SettingResetButton
              label="translucent sidebar"
              onClick={() =>
                setPreference(
                  "translucentSidebar",
                  DEFAULT_APPEARANCE_PREFERENCES.translucentSidebar,
                )
              }
            />
          ) : null
        }
        control={
          <Switch
            aria-label="Translucent sidebar"
            checked={appearance.translucentSidebar}
            onCheckedChange={(checked) => setPreference("translucentSidebar", Boolean(checked))}
          />
        }
      />

      <SettingsRow
        title="Contrast"
        description="Increase or soften separation between text, borders, and surfaces."
        resetAction={
          appearance.contrast !== DEFAULT_APPEARANCE_PREFERENCES.contrast ? (
            <SettingResetButton
              label="contrast"
              onClick={() => setPreference("contrast", DEFAULT_APPEARANCE_PREFERENCES.contrast)}
            />
          ) : null
        }
        control={
          <div className="flex w-full items-center gap-3 sm:w-52">
            <output className="min-w-10 rounded-md bg-muted px-2 py-1 text-center font-mono text-xs tabular-nums">
              {appearance.contrast}
            </output>
            <input
              aria-label="Theme contrast"
              className="min-w-0 flex-1 accent-primary"
              min={0}
              max={100}
              step={1}
              type="range"
              value={appearance.contrast}
              onChange={(event) => setPreference("contrast", Number(event.currentTarget.value))}
            />
          </div>
        }
      />

      <div className="border-b border-border/70 bg-muted/18 px-5 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Preferences
        </h3>
      </div>

      <SettingsRow
        title="Use pointer cursors"
        description="Show a hand cursor over buttons, links, and interactive controls."
        control={
          <Switch
            aria-label="Use pointer cursors"
            checked={appearance.pointerCursors}
            onCheckedChange={(checked) => setPreference("pointerCursors", Boolean(checked))}
          />
        }
      />

      <SettingsRow
        title="Reduce motion"
        description="Follow the system setting or override animation behavior."
        control={
          <Select
            value={appearance.reduceMotion}
            onValueChange={(value) => {
              if (value === "system" || value === "on" || value === "off") {
                setPreference("reduceMotion", value);
              }
            }}
          >
            <SelectTrigger className="w-32" aria-label="Reduce motion">
              <SelectValue>
                {appearance.reduceMotion === "system"
                  ? "System"
                  : appearance.reduceMotion === "on"
                    ? "On"
                    : "Off"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="system">
                System
              </SelectItem>
              <SelectItem hideIndicator value="on">
                On
              </SelectItem>
              <SelectItem hideIndicator value="off">
                Off
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />

      <SettingsRow
        title="UI font size"
        description="Base size for interface labels and body text."
        control={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              aria-label="UI font size"
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-right font-mono text-foreground"
              min={12}
              max={20}
              type="number"
              value={appearance.uiFontSize}
              onChange={(event) => setPreference("uiFontSize", Number(event.currentTarget.value))}
            />
            px
          </label>
        }
      />

      <SettingsRow
        title="Code font size"
        description="Base size for snippets, diffs, and file previews."
        control={
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              aria-label="Code font size"
              className="h-8 w-16 rounded-md border border-input bg-background px-2 text-right font-mono text-foreground"
              min={10}
              max={20}
              type="number"
              value={appearance.codeFontSize}
              onChange={(event) => setPreference("codeFontSize", Number(event.currentTarget.value))}
            />
            px
          </label>
        }
      />

      <SettingsRow
        title="Diff markers"
        description="Use color bars or traditional +/− symbols for changed lines."
        control={
          <Select
            value={appearance.diffMarkers}
            onValueChange={(value) => {
              if (value === "color" || value === "symbols") setPreference("diffMarkers", value);
            }}
          >
            <SelectTrigger className="w-32" aria-label="Diff markers">
              <SelectValue>{appearance.diffMarkers === "color" ? "Color" : "+/−"}</SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="color">
                Color
              </SelectItem>
              <SelectItem hideIndicator value="symbols">
                +/−
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}
