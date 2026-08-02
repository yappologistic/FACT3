import type { KeybindingCommand } from "@t3tools/contracts";

export type CommandPaletteCommandCategory = "app" | "composer" | "model" | "preview" | "terminal";

export type CommandPaletteCommandAvailability =
  | "always"
  | "active-thread"
  | "preview-open"
  | "terminal-open";

export interface CommandPaletteCommandDefinition {
  readonly availability: CommandPaletteCommandAvailability;
  readonly category: CommandPaletteCommandCategory;
  readonly command: KeybindingCommand;
  readonly description: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: string;
}

export interface CommandPaletteCommandContext {
  readonly hasActiveThread: boolean;
  readonly preferredEditorAvailable: boolean;
  readonly previewOpen: boolean;
  readonly previewSupported: boolean;
  readonly terminalOpen: boolean;
}

export function commandPaletteCommandUnavailableReason(
  definition: CommandPaletteCommandDefinition,
  context: CommandPaletteCommandContext,
): string | null {
  if (definition.availability !== "always" && !context.hasActiveThread) {
    return "Open a thread to use this action";
  }
  if (definition.category === "preview" && !context.previewSupported) {
    return "Available in the desktop app";
  }
  if (definition.command === "editor.openFavorite" && !context.preferredEditorAvailable) {
    return "Available for local projects with a supported editor";
  }
  if (definition.availability === "preview-open" && !context.previewOpen) {
    return "Open Preview to use this action";
  }
  if (definition.availability === "terminal-open" && !context.terminalOpen) {
    return "Open the terminal to use this action";
  }
  return null;
}

export function suggestedCommandPaletteActionValues(context: {
  readonly hasActiveProject: boolean;
  readonly hasActiveThread: boolean;
  readonly hasProjects: boolean;
  readonly previewSupported: boolean;
}): ReadonlyArray<string> {
  if (!context.hasActiveProject) {
    return [
      ...(context.hasProjects ? ["action:new-thread-in"] : []),
      "action:add-project",
      "action:settings",
      "command:sidebar.toggle",
    ];
  }

  return [
    "action:new-thread",
    "action:open-file-picker",
    ...(context.hasActiveThread ? ["command:terminal.toggle"] : []),
    ...(context.hasActiveThread && context.previewSupported
      ? ["command:preview.toggle"]
      : ["action:search-project-contents"]),
    "action:add-project",
  ];
}

/**
 * Commands that have a concrete programmatic owner in the web client. Positional
 * thread/model jump commands stay out of the palette because their meaning only
 * exists inside the corresponding ordered picker.
 */
export const COMMAND_PALETTE_COMMANDS = [
  {
    command: "sidebar.toggle",
    title: "Toggle sidebar",
    description: "Show or hide the main sidebar",
    searchTerms: ["navigation", "projects", "threads", "left panel"],
    category: "app",
    availability: "always",
  },
  {
    command: "rightPanel.toggle",
    title: "Toggle right panel",
    description: "Show or hide the active right panel",
    searchTerms: ["panel", "terminal", "preview", "right"],
    category: "app",
    availability: "active-thread",
  },
  {
    command: "diff.toggle",
    title: "Toggle diff",
    description: "Open or close the current thread diff",
    searchTerms: ["changes", "git", "review"],
    category: "app",
    availability: "active-thread",
  },
  {
    command: "terminal.toggle",
    title: "Toggle terminal",
    description: "Open or close the terminal",
    searchTerms: ["shell", "console", "command line"],
    category: "terminal",
    availability: "active-thread",
  },
  {
    command: "terminal.new",
    title: "New terminal",
    description: "Create another terminal session",
    searchTerms: ["shell", "console", "tab"],
    category: "terminal",
    availability: "active-thread",
  },
  {
    command: "terminal.split",
    title: "Split terminal horizontally",
    description: "Add a horizontal terminal pane",
    searchTerms: ["shell", "console", "pane", "row"],
    category: "terminal",
    availability: "active-thread",
  },
  {
    command: "terminal.splitVertical",
    title: "Split terminal vertically",
    description: "Add a vertical terminal pane",
    searchTerms: ["shell", "console", "pane", "column"],
    category: "terminal",
    availability: "active-thread",
  },
  {
    command: "terminal.close",
    title: "Close terminal",
    description: "Close the active terminal session",
    searchTerms: ["shell", "console", "remove"],
    category: "terminal",
    availability: "terminal-open",
  },
  {
    command: "preview.toggle",
    title: "Toggle preview",
    description: "Open or close the in-app browser preview",
    searchTerms: ["browser", "website", "web app"],
    category: "preview",
    availability: "active-thread",
  },
  {
    command: "preview.refresh",
    title: "Refresh preview",
    description: "Reload the active preview page",
    searchTerms: ["browser", "reload", "website"],
    category: "preview",
    availability: "preview-open",
  },
  {
    command: "preview.focusUrl",
    title: "Focus preview address",
    description: "Move focus to the preview URL field",
    searchTerms: ["browser", "address", "location", "url"],
    category: "preview",
    availability: "preview-open",
  },
  {
    command: "preview.zoomIn",
    title: "Zoom preview in",
    description: "Increase the preview scale",
    searchTerms: ["browser", "magnify", "scale"],
    category: "preview",
    availability: "preview-open",
  },
  {
    command: "preview.zoomOut",
    title: "Zoom preview out",
    description: "Decrease the preview scale",
    searchTerms: ["browser", "shrink", "scale"],
    category: "preview",
    availability: "preview-open",
  },
  {
    command: "preview.resetZoom",
    title: "Reset preview zoom",
    description: "Return the preview to its default scale",
    searchTerms: ["browser", "actual size", "scale"],
    category: "preview",
    availability: "preview-open",
  },
  {
    command: "modelPicker.toggle",
    title: "Choose model",
    description: "Open or close the model picker",
    searchTerms: ["provider", "agent", "llm", "change model"],
    category: "model",
    availability: "active-thread",
  },
  {
    command: "composer.stash",
    title: "Stash prompt",
    description: "Stash the draft or open saved prompts",
    searchTerms: ["composer", "draft", "save", "prompt"],
    category: "composer",
    availability: "active-thread",
  },
  {
    command: "editor.openFavorite",
    title: "Open in preferred editor",
    description: "Open the current workspace in your preferred editor",
    searchTerms: ["ide", "vscode", "cursor", "workspace"],
    category: "app",
    availability: "active-thread",
  },
  {
    command: "thread.previous",
    title: "Previous thread",
    description: "Move to the previous visible thread",
    searchTerms: ["navigate", "back", "conversation"],
    category: "app",
    availability: "active-thread",
  },
  {
    command: "thread.next",
    title: "Next thread",
    description: "Move to the next visible thread",
    searchTerms: ["navigate", "forward", "conversation"],
    category: "app",
    availability: "active-thread",
  },
] as const satisfies ReadonlyArray<CommandPaletteCommandDefinition>;
