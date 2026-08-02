import { describe, expect, it, vi } from "vite-plus/test";
import { EnvironmentId, ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import type { Thread } from "../types";
import {
  buildBrowseGroups,
  buildRecentThreadItems,
  buildThreadActionItems,
  enumerateCommandPaletteItems,
  filterCommandPaletteGroups,
  findCommandPaletteExecutionItem,
  parseCommandPaletteQuery,
  reduceCommandPaletteUiState,
  SEARCH_GROUP_RESULT_LIMIT,
  SEARCH_RESULT_LIMIT,
  type CommandPaletteActionItem,
} from "./CommandPalette.logic";

describe("reduceCommandPaletteUiState", () => {
  const closedState = { open: false, mode: "command", openIntent: null } as const;

  it("toggles each overlay mode open and closed", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(filesOpen).toEqual({ open: true, mode: "files", openIntent: null });

    const contentOpen = reduceCommandPaletteUiState(filesOpen, {
      _tag: "ToggleMode",
      mode: "content",
    });
    expect(contentOpen).toEqual({ open: true, mode: "content", openIntent: null });

    expect(
      reduceCommandPaletteUiState(contentOpen, { _tag: "ToggleMode", mode: "content" }),
    ).toEqual({ open: false, mode: "command", openIntent: null });
  });

  it("switches between open modes without closing", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "ToggleMode", mode: "command" })).toEqual(
      {
        open: true,
        mode: "command",
        openIntent: null,
      },
    );
  });

  it("routes open intents to command mode", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenAddProject" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "add-project" },
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "OpenNewThreadIn" })).toEqual({
      open: true,
      mode: "command",
      openIntent: { kind: "new-thread-in" },
    });
  });

  it("resets to command mode for dialog-driven opens and closes", () => {
    const filesOpen = reduceCommandPaletteUiState(closedState, {
      _tag: "ToggleMode",
      mode: "files",
    });

    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: false })).toEqual({
      open: false,
      mode: "command",
      openIntent: null,
    });
    expect(reduceCommandPaletteUiState(filesOpen, { _tag: "SetOpen", open: true })).toEqual({
      open: true,
      mode: "command",
      openIntent: null,
    });
  });
});

describe("enumerateCommandPaletteItems", () => {
  it("assigns positional jump shortcuts to the first nine displayed items", () => {
    const items = Array.from({ length: 10 }, (_, index) => ({
      kind: "action" as const,
      value: `project-${index + 1}`,
      searchTerms: [],
      title: `Project ${index + 1}`,
      icon: null,
      shortcutCommand: "chat.new" as const,
      run: async () => undefined,
    }));

    expect(enumerateCommandPaletteItems(items).map((item) => item.shortcutCommand)).toEqual([
      "thread.jump.1",
      "thread.jump.2",
      "thread.jump.3",
      "thread.jump.4",
      "thread.jump.5",
      "thread.jump.6",
      "thread.jump.7",
      "thread.jump.8",
      "thread.jump.9",
      undefined,
    ]);
  });
});

const LOCAL_ENVIRONMENT_ID = EnvironmentId.make("environment-local");
const PROJECT_ID = ProjectId.make("project-1");

function makeThread(overrides: Partial<Thread> = {}): Thread {
  return {
    id: ThreadId.make("thread-1"),
    environmentId: LOCAL_ENVIRONMENT_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    session: null,
    messages: [],
    proposedPlans: [],
    createdAt: "2026-03-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
    updatedAt: "2026-03-01T00:00:00.000Z",
    latestTurn: null,
    branch: null,
    worktreePath: null,
    checkpoints: [],
    activities: [],
    ...overrides,
  };
}

describe("buildThreadActionItems", () => {
  it("orders threads by most recent activity and formats timestamps from updatedAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-25T12:00:00.000Z"));

    try {
      const items = buildThreadActionItems({
        threads: [
          makeThread({
            id: ThreadId.make("thread-older"),
            title: "Older thread",
            updatedAt: "2026-03-24T12:00:00.000Z",
          }),
          makeThread({
            id: ThreadId.make("thread-newer"),
            title: "Newer thread",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z",
          }),
        ],
        projectTitleById: new Map([[PROJECT_ID, "Project"]]),
        sortOrder: "updated_at",
        icon: null,
        runThread: async (_thread) => undefined,
      });

      expect(items.map((item) => item.value)).toEqual([
        "thread:thread-older",
        "thread:thread-newer",
      ]);
      expect(items[0]?.timestamp).toBe("1d ago");
      expect(items[1]?.timestamp).toBe("5d ago");
    } finally {
      vi.useRealTimers();
    }
  });

  it("ranks thread title matches ahead of contextual project-name matches", () => {
    const threadItems = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-context-match"),
          title: "Fix navbar spacing",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-title-match"),
          title: "Project kickoff notes",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      actionSearchItems: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: threadItems,
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.value).toBe("threads-search");
    expect(groups[0]?.items.map((item) => item.value)).toEqual([
      "thread:thread-title-match",
      "thread:thread-context-match",
    ]);
  });

  it("preserves thread project-name matches when there is no stronger title match", () => {
    const item: CommandPaletteActionItem = {
      kind: "action",
      value: "thread:project-context-only",
      searchTerms: ["Fix navbar spacing", "Project"],
      title: "Fix navbar spacing",
      description: "Project",
      icon: null,
      run: async () => undefined,
    };

    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      actionSearchItems: [],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [item],
    });

    expect(groups).toHaveLength(1);
    expect(groups[0]?.items.map((item) => item.value)).toEqual(["thread:project-context-only"]);
  });

  it("keeps message excerpts searchable without replacing thread metadata", () => {
    const [item] = buildThreadActionItems({
      threads: [makeThread({ branch: "feat/search" })],
      projectTitleById: new Map([[PROJECT_ID, "T3 Code"]]),
      sortOrder: "updated_at",
      icon: null,
      getContentMatch: () => ({
        source: "assistant",
        snippet: "The relay reconnect is now bounded.",
        query: "reconnect",
      }),
      runThread: async (_thread) => undefined,
    });

    expect(item?.searchTerms).toContain("The relay reconnect is now bounded.");
    expect(item?.threadContentMatch).toEqual({
      source: "assistant",
      snippet: "The relay reconnect is now bounded.",
      query: "reconnect",
    });
    expect(item?.description).toBe("T3 Code · #feat/search");
  });

  it("filters archived threads out of thread search items", () => {
    const items = buildThreadActionItems({
      threads: [
        makeThread({
          id: ThreadId.make("thread-active"),
          title: "Active thread",
          createdAt: "2026-03-02T00:00:00.000Z",
          updatedAt: "2026-03-19T00:00:00.000Z",
        }),
        makeThread({
          id: ThreadId.make("thread-archived"),
          title: "Archived thread",
          archivedAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z",
        }),
      ],
      projectTitleById: new Map([[PROJECT_ID, "Project"]]),
      sortOrder: "updated_at",
      icon: null,
      runThread: async (_thread) => undefined,
    });

    expect(items.map((item) => item.value)).toEqual(["thread:thread-active"]);
  });
});

function actionItem(
  value: string,
  title: string,
  searchTerms: ReadonlyArray<string> = [title],
): CommandPaletteActionItem {
  return {
    kind: "action",
    value,
    searchTerms,
    title,
    icon: null,
    run: async () => undefined,
  };
}

describe("command palette search", () => {
  it("parses root scopes while preserving ordinary queries", () => {
    expect(parseCommandPaletteQuery("  > terminal")).toEqual({
      scope: "actions",
      query: "terminal",
    });
    expect(parseCommandPaletteQuery("@workspace")).toEqual({
      scope: "projects",
      query: "workspace",
    });
    expect(parseCommandPaletteQuery("# reconnect")).toEqual({
      scope: "threads",
      query: "reconnect",
    });
    expect(parseCommandPaletteQuery("regular search")).toEqual({
      scope: "all",
      query: "regular search",
    });
  });

  it("shows the curated default groups until a query or scope is entered", () => {
    const suggested = actionItem("action:new", "New thread");
    const recent = actionItem("thread:recent", "Recent thread");
    const groups = filterCommandPaletteGroups({
      activeGroups: [
        { value: "suggested", label: "Suggested", items: [suggested] },
        { value: "recent-threads", label: "Recent threads", items: [recent] },
      ],
      actionSearchItems: [suggested, actionItem("action:terminal", "Toggle terminal")],
      query: "",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [recent],
    });

    expect(groups.map((group) => group.value)).toEqual(["suggested", "recent-threads"]);
  });

  it("exposes complete scoped collections even before scope text is entered", () => {
    const actions = [
      actionItem("action:new", "New thread"),
      actionItem("action:terminal", "Toggle terminal"),
    ];
    const projects = [actionItem("project:t3", "T3 Code")];
    const threads = [actionItem("thread:palette", "Fix command palette")];
    const base = {
      activeGroups: [],
      actionSearchItems: actions,
      isInSubmenu: false,
      projectSearchItems: projects,
      threadSearchItems: threads,
    } as const;

    expect(filterCommandPaletteGroups({ ...base, query: ">" })[0]?.items).toEqual(actions);
    expect(filterCommandPaletteGroups({ ...base, query: "@" })[0]?.items).toEqual(projects);
    expect(filterCommandPaletteGroups({ ...base, query: "#" })[0]?.items).toEqual(threads);
  });

  it("ranks exact matches globally instead of preserving source-group order", () => {
    const weakAction = actionItem("action:project-settings", "Project settings");
    const exactThread = actionItem("thread:project", "Project");
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      actionSearchItems: [weakAction],
      query: "project",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [exactThread],
    });

    expect(groups.map((group) => group.value)).toEqual(["threads-search", "actions-search"]);
    expect(groups[0]?.items[0]?.value).toBe("thread:project");
  });

  it("always searches visible string titles even when synonyms omit the exact copy", () => {
    const rename = {
      ...actionItem("action:rename", "Rename current thread"),
      searchTerms: ["edit title", "change name"],
    };
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      actionSearchItems: [rename],
      query: "rename current thread",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups[0]?.items[0]?.value).toBe(rename.value);
  });

  it("accepts a bounded fuzzy subsequence without matching unrelated text", () => {
    const terminal = actionItem("command:terminal.toggle", "Toggle terminal");
    const sidebar = actionItem("command:sidebar.toggle", "Toggle sidebar");
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      actionSearchItems: [terminal, sidebar],
      query: "termnal",
      isInSubmenu: false,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups[0]?.items.map((item) => item.value)).toEqual(["command:terminal.toggle"]);
  });

  it("caps global results and prevents one group from crowding out every other type", () => {
    const actions = Array.from({ length: 20 }, (_, index) =>
      actionItem(`action:${index}`, `Common action ${index}`),
    );
    const projects = Array.from({ length: 20 }, (_, index) =>
      actionItem(`project:${index}`, `Common project ${index}`),
    );
    const threads = Array.from({ length: 20 }, (_, index) =>
      actionItem(`thread:${index}`, `Common thread ${index}`),
    );
    const groups = filterCommandPaletteGroups({
      activeGroups: [],
      actionSearchItems: actions,
      query: "common",
      isInSubmenu: false,
      projectSearchItems: projects,
      threadSearchItems: threads,
    });

    expect(groups.flatMap((group) => group.items)).toHaveLength(SEARCH_RESULT_LIMIT);
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group.items.length).toBeLessThanOrEqual(SEARCH_GROUP_RESULT_LIMIT);
    }
  });

  it("treats scope characters literally inside submenus", () => {
    const scopedName = actionItem("project:at", "@workspace");
    const groups = filterCommandPaletteGroups({
      activeGroups: [{ value: "projects", label: "Projects", items: [scopedName] }],
      actionSearchItems: [],
      query: "@workspace",
      isInSubmenu: true,
      projectSearchItems: [],
      threadSearchItems: [],
    });

    expect(groups[0]?.items[0]?.value).toBe("project:at");
  });
});

describe("buildRecentThreadItems", () => {
  it("excludes the active thread and caps the empty-state list", () => {
    const items = Array.from({ length: 8 }, (_, index) =>
      actionItem(`thread:thread-${index}`, `Thread ${index}`),
    );

    expect(
      buildRecentThreadItems(items, ThreadId.make("thread-1")).map((item) => item.value),
    ).toEqual([
      "thread:thread-0",
      "thread:thread-2",
      "thread:thread-3",
      "thread:thread-4",
      "thread:thread-5",
    ]);
  });
});

describe("findCommandPaletteExecutionItem", () => {
  it("uses the highlighted executable item and falls back past disabled rows", () => {
    const disabled = { ...actionItem("action:disabled", "Disabled"), disabled: true };
    const first = actionItem("action:first", "First");
    const highlighted = actionItem("action:highlighted", "Highlighted");
    const groups = [{ value: "actions", label: "Actions", items: [disabled, first, highlighted] }];

    expect(findCommandPaletteExecutionItem(groups, highlighted.value)).toBe(highlighted);
    expect(findCommandPaletteExecutionItem(groups, disabled.value)).toBe(first);
    expect(findCommandPaletteExecutionItem(groups, "missing")).toBe(first);
  });

  it("returns null when every visible row is disabled", () => {
    const disabled = { ...actionItem("action:disabled", "Disabled"), disabled: true };
    expect(
      findCommandPaletteExecutionItem(
        [{ value: "actions", label: "Actions", items: [disabled] }],
        null,
      ),
    ).toBeNull();
  });
});

describe("buildBrowseGroups", () => {
  it("waits for asynchronous browse navigation actions", async () => {
    let finishNavigation: (() => void) | undefined;
    const browseTo = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishNavigation = resolve;
        }),
    );
    const groups = buildBrowseGroups({
      browseEntries: [{ name: "Downloads", fullPath: "/Users/test/Downloads" }],
      browseQuery: "~/",
      canBrowseUp: false,
      upIcon: null,
      directoryIcon: null,
      browseUp: vi.fn(),
      browseTo,
    });
    const item = groups[0]?.items[0];
    if (!item || item.kind !== "action") {
      throw new Error("Expected a browse action");
    }

    let actionSettled = false;
    const action = item.run().then(() => {
      actionSettled = true;
    });
    await Promise.resolve();

    expect(browseTo).toHaveBeenCalledWith("Downloads");
    expect(actionSettled).toBe(false);

    finishNavigation?.();
    await action;
    expect(actionSettled).toBe(true);
  });
});
