import { describe, expect, it } from "vite-plus/test";

import {
  COMMAND_PALETTE_COMMANDS,
  commandPaletteCommandUnavailableReason,
  suggestedCommandPaletteActionValues,
} from "./CommandPalette.commands";

describe("COMMAND_PALETTE_COMMANDS", () => {
  it("contains unique executable command ids with searchable copy", () => {
    const commands = COMMAND_PALETTE_COMMANDS.map((definition) => definition.command);

    expect(new Set(commands).size).toBe(commands.length);
    for (const definition of COMMAND_PALETTE_COMMANDS) {
      expect(definition.title.trim().length).toBeGreaterThan(0);
      expect(definition.description.trim().length).toBeGreaterThan(0);
      expect(definition.searchTerms.length).toBeGreaterThan(0);
    }
  });

  it("does not expose positional jump commands outside their ordered pickers", () => {
    expect(
      COMMAND_PALETTE_COMMANDS.some(
        (definition) =>
          definition.command.startsWith("thread.jump.") ||
          definition.command.startsWith("modelPicker.jump."),
      ),
    ).toBe(false);
  });

  it("explains context-dependent command availability in priority order", () => {
    const previewRefresh = COMMAND_PALETTE_COMMANDS.find(
      (definition) => definition.command === "preview.refresh",
    );
    const terminalClose = COMMAND_PALETTE_COMMANDS.find(
      (definition) => definition.command === "terminal.close",
    );

    expect(previewRefresh).toBeDefined();
    expect(terminalClose).toBeDefined();
    if (!previewRefresh || !terminalClose) return;

    expect(
      commandPaletteCommandUnavailableReason(previewRefresh, {
        hasActiveThread: false,
        preferredEditorAvailable: false,
        previewOpen: false,
        previewSupported: false,
        terminalOpen: false,
      }),
    ).toBe("Open a thread to use this action");
    expect(
      commandPaletteCommandUnavailableReason(previewRefresh, {
        hasActiveThread: true,
        preferredEditorAvailable: true,
        previewOpen: false,
        previewSupported: false,
        terminalOpen: false,
      }),
    ).toBe("Available in the desktop app");
    expect(
      commandPaletteCommandUnavailableReason(previewRefresh, {
        hasActiveThread: true,
        preferredEditorAvailable: true,
        previewOpen: false,
        previewSupported: true,
        terminalOpen: false,
      }),
    ).toBe("Open Preview to use this action");
    expect(
      commandPaletteCommandUnavailableReason(terminalClose, {
        hasActiveThread: true,
        preferredEditorAvailable: true,
        previewOpen: false,
        previewSupported: true,
        terminalOpen: false,
      }),
    ).toBe("Open the terminal to use this action");
  });

  it("keeps the empty state short and adapts it to the active context", () => {
    expect(
      suggestedCommandPaletteActionValues({
        hasActiveProject: true,
        hasActiveThread: true,
        hasProjects: true,
        previewSupported: true,
      }),
    ).toContain("command:preview.toggle");
    expect(
      suggestedCommandPaletteActionValues({
        hasActiveProject: true,
        hasActiveThread: false,
        hasProjects: true,
        previewSupported: false,
      }),
    ).toEqual([
      "action:new-thread",
      "action:open-file-picker",
      "action:search-project-contents",
      "action:add-project",
    ]);
    expect(
      suggestedCommandPaletteActionValues({
        hasActiveProject: false,
        hasActiveThread: false,
        hasProjects: false,
        previewSupported: false,
      }),
    ).toEqual(["action:add-project", "action:settings", "command:sidebar.toggle"]);
  });
});
