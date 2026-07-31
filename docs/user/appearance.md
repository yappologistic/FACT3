# Appearance and color themes

T3 Code separates **mode** from **color theme**:

- **Mode** controls whether the light palette, dark palette, or the operating system preference is used.
- **Color theme** controls the palette and matching syntax-highlighting colors. Choose **T3 Code** to keep the original T3 Code appearance.

The Appearance page also provides per-mode Accent, Background, and Foreground overrides; editable UI and code font stacks; translucent sidebar and contrast controls; pointer cursor and reduced-motion preferences; UI and code font sizes; and color-bar or `+/-` diff markers.

UI font and Code font are free-text fields. Enter one font family or a comma-separated fallback stack such as `Geist, Inter, sans-serif`. The bundled defaults are `Geist, Inter` for the interface and `Geist Mono` for code, diffs, file previews, and the terminal. Press Enter or move focus away from the field to apply the value; press Escape to discard an uncommitted edit.

## Included themes

The built-in themes are T3 Code, Absolutely, Ayu, Catppuccin, Codex, Dracula, Everforest, GitHub, Gruvbox, Linear, Lobster, Material, Matrix, Monokai, Night Owl, Nord, Notion, One, Oscurange, Raycast, Rose Pine, Sentry, Solarized, Temple, Tokyo Night, Vercel, VS Code Plus, and Xcode.

Each preset contains both a light and dark semantic palette plus light and dark Shiki themes. Conversation snippets, file previews, search matches, review diffs, and the diff worker all resolve from the same active preset.

## Copy and import

Use **Copy theme** to copy the current appearance settings as JSON. Use **Import** to load a copied `.json` file.

Imported data is normalized before it is applied:

- unknown presets fall back to the T3 Code preset;
- font stacks accept up to eight safely quoted family names; malformed or CSS-injecting values fall back to the bundled Geist defaults;
- colors must be six-digit hexadecimal values;
- contrast and font sizes are clamped to supported ranges;
- unknown preference values are ignored.

Mode is not included in copied theme JSON, so importing a palette does not unexpectedly change a user's System, Light, or Dark selection.

## Persistence and recovery

Mode remains in the existing `t3code:theme` local-storage key for backward compatibility. Extended appearance preferences are stored in the versioned `t3code:appearance:v1` key. Missing, unreadable, or malformed appearance data falls back to the original T3 Code preset without blocking app startup.

**Restore default settings** resets both mode and all appearance preferences.

## Native translucency

Translucent sidebar uses the operating system's native window material when the desktop shell supports it: acrylic on Windows and sidebar vibrancy on macOS. The renderer keeps the conversation surface opaque while allowing only the navigation surface to reveal the material. Unsupported platforms retain the CSS translucency and blur fallback.

The native material follows the saved Appearance setting on startup, across theme changes, and after reloading the renderer. Turning the setting off restores the normal opaque window background.

## Adding a preset

Add a preset to `apps/web/src/lib/themeCatalog.ts` with:

1. a unique stable ID and user-facing name;
2. complete light and dark seeds (`background`, `foreground`, `surface`, `sidebar`, and `accent`);
3. a bundled Pierre/Shiki syntax theme for each mode.

The catalog test iterates through every preset and mode, verifying complete hexadecimal palettes, semantic CSS output, and syntax-theme mappings. Add the new ID to the expected catalog list in `themeCatalog.test.ts` so an accidental removal or rename fails loudly.
