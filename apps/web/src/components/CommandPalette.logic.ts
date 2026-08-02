import {
  type FilesystemBrowseEntry,
  type KeybindingCommand,
  THREAD_JUMP_KEYBINDING_COMMANDS,
} from "@t3tools/contracts";
import type { SidebarThreadSortOrder } from "@t3tools/contracts/settings";
import { type ReactNode } from "react";
import { sortThreads } from "../lib/threadSort";
import { formatRelativeTimeLabel } from "../timestampFormat";
import { type Project, type SidebarThreadSummary, type Thread } from "../types";

export const RECENT_THREAD_LIMIT = 5;
export const SEARCH_RESULT_LIMIT = 12;
export const SEARCH_GROUP_RESULT_LIMIT = 5;
export const SCOPED_RESULT_LIMIT = 24;
export const ITEM_ICON_CLASS = "size-4 text-muted-foreground/80";
export const ADDON_ICON_CLASS = "size-4";

/**
 * The global search overlay hosts three mutually exclusive surfaces: the
 * command palette (⌘K), the project file picker (⌘P), and project content
 * search (⇧⌘F). One reducer owns open/mode state so the surfaces can never
 * stack and re-triggering a mode's shortcut toggles it closed.
 */
export type SearchOverlayMode = "command" | "files" | "content";

export interface CommandPaletteOpenIntent {
  readonly kind: "add-project" | "new-thread-in";
}

export interface CommandPaletteUiState {
  readonly open: boolean;
  readonly mode: SearchOverlayMode;
  readonly openIntent: CommandPaletteOpenIntent | null;
}

export type CommandPaletteUiAction =
  | { readonly _tag: "SetOpen"; readonly open: boolean }
  | { readonly _tag: "ToggleMode"; readonly mode: SearchOverlayMode }
  | { readonly _tag: "OpenAddProject" }
  | { readonly _tag: "OpenNewThreadIn" }
  | { readonly _tag: "ClearOpenIntent" };

export function reduceCommandPaletteUiState(
  state: CommandPaletteUiState,
  action: CommandPaletteUiAction,
): CommandPaletteUiState {
  switch (action._tag) {
    case "SetOpen":
      return {
        open: action.open,
        mode: "command",
        openIntent: action.open ? state.openIntent : null,
      };
    case "ToggleMode":
      return state.open && state.mode === action.mode
        ? { open: false, mode: "command", openIntent: null }
        : { open: true, mode: action.mode, openIntent: null };
    case "OpenAddProject":
      return { open: true, mode: "command", openIntent: { kind: "add-project" } };
    case "OpenNewThreadIn":
      return { open: true, mode: "command", openIntent: { kind: "new-thread-in" } };
    case "ClearOpenIntent":
      return state.openIntent ? { ...state, openIntent: null } : state;
  }
}

export interface CommandPaletteThreadContentMatch {
  readonly source: "user" | "assistant";
  readonly snippet: string;
  readonly query: string;
}

export interface CommandPaletteItem {
  readonly kind: "action" | "submenu";
  readonly value: string;
  readonly searchTerms: ReadonlyArray<string>;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly threadContentMatch?: CommandPaletteThreadContentMatch;
  readonly timestamp?: string;
  readonly icon: ReactNode;
  readonly disabled?: boolean;
  /** Optional content rendered inline before the title text. */
  readonly titleLeadingContent?: ReactNode;
  /** Optional content rendered inline after the title text (before the timestamp). */
  readonly titleTrailingContent?: ReactNode;
  readonly shortcutCommand?: KeybindingCommand;
}

export interface CommandPaletteActionItem extends CommandPaletteItem {
  readonly kind: "action";
  readonly keepOpen?: boolean;
  readonly run: () => Promise<void>;
}

export interface CommandPaletteSubmenuItem extends CommandPaletteItem {
  readonly kind: "submenu";
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export interface CommandPaletteGroup {
  readonly value: string;
  readonly label: string;
  readonly items: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
}

export interface CommandPaletteView {
  readonly addonIcon: ReactNode;
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly initialQuery?: string;
}

export function enumerateCommandPaletteItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
): CommandPaletteActionItem[] {
  return items.map((item, index) => {
    const shortcutCommand = THREAD_JUMP_KEYBINDING_COMMANDS[index];
    if (shortcutCommand) return { ...item, shortcutCommand };

    const { shortcutCommand: _shortcutCommand, ...itemWithoutShortcut } = item;
    return itemWithoutShortcut;
  });
}

export type CommandPaletteMode = "root" | "root-browse" | "submenu" | "submenu-browse";

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function buildProjectActionItems(input: {
  projects: ReadonlyArray<Project>;
  valuePrefix: string;
  icon: (project: Project) => ReactNode;
  runProject: (project: Project) => Promise<void>;
  searchTerms?: (project: Project) => ReadonlyArray<string>;
  shortcutCommand?: KeybindingCommand;
}): CommandPaletteActionItem[] {
  return input.projects.map((project) => ({
    kind: "action",
    value: `${input.valuePrefix}:${project.environmentId}:${project.id}`,
    searchTerms: [project.title, project.workspaceRoot, ...(input.searchTerms?.(project) ?? [])],
    title: project.title,
    description: project.workspaceRoot,
    icon: input.icon(project),
    ...(input.shortcutCommand !== undefined ? { shortcutCommand: input.shortcutCommand } : {}),
    run: async () => {
      await input.runProject(project);
    },
  }));
}

export type BuildThreadActionItemsThread = Pick<
  SidebarThreadSummary,
  "archivedAt" | "branch" | "createdAt" | "environmentId" | "id" | "projectId" | "title"
> & {
  updatedAt: string;
  latestUserMessageAt?: string | null;
};

export function buildThreadActionItems<TThread extends BuildThreadActionItemsThread>(input: {
  threads: ReadonlyArray<TThread>;
  activeThreadId?: Thread["id"];
  projectTitleById: ReadonlyMap<Project["id"], string>;
  sortOrder: SidebarThreadSortOrder;
  icon: ReactNode;
  /** Optional content rendered inline before the title text per-thread. */
  renderLeadingContent?: (thread: TThread) => ReactNode;
  /** Optional content rendered inline after the title text per-thread. */
  renderTrailingContent?: (thread: TThread) => ReactNode;
  getContentMatch?: (thread: TThread) => CommandPaletteThreadContentMatch | undefined;
  runThread: (thread: Pick<SidebarThreadSummary, "environmentId" | "id">) => Promise<void>;
  limit?: number;
}): CommandPaletteActionItem[] {
  const sortedThreads = sortThreads(
    input.threads.filter((thread) => thread.archivedAt === null),
    input.sortOrder,
  );
  const visibleThreads =
    input.limit === undefined ? sortedThreads : sortedThreads.slice(0, input.limit);

  return visibleThreads.map((thread) => {
    const projectTitle = input.projectTitleById.get(thread.projectId);
    const descriptionParts: string[] = [];

    if (projectTitle) {
      descriptionParts.push(projectTitle);
    }
    if (thread.branch) {
      descriptionParts.push(`#${thread.branch}`);
    }
    if (thread.id === input.activeThreadId) {
      descriptionParts.push("Current thread");
    }

    const leadingContent = input.renderLeadingContent?.(thread);
    const trailingContent = input.renderTrailingContent?.(thread);
    const contentMatch = input.getContentMatch?.(thread);

    return Object.assign(
      {
        kind: "action" as const,
        value: `thread:${thread.id}`,
        searchTerms: [
          thread.title,
          projectTitle ?? ``,
          thread.branch ?? ``,
          contentMatch?.snippet ?? ``,
        ],
        title: thread.title,
        description: descriptionParts.join(` · `),
        timestamp: formatRelativeTimeLabel(
          thread.latestUserMessageAt ?? thread.updatedAt ?? thread.createdAt,
        ),
        icon: input.icon,
      },
      leadingContent ? { titleLeadingContent: leadingContent } : {},
      trailingContent ? { titleTrailingContent: trailingContent } : {},
      contentMatch ? { threadContentMatch: contentMatch } : {},
      {
        run: async () => {
          await input.runThread(thread);
        },
      },
    );
  });
}

export function buildRecentThreadItems(
  items: ReadonlyArray<CommandPaletteActionItem>,
  activeThreadId: Thread["id"] | undefined,
): CommandPaletteActionItem[] {
  const activeValue = activeThreadId ? `thread:${activeThreadId}` : null;
  return items.filter((item) => item.value !== activeValue).slice(0, RECENT_THREAD_LIMIT);
}

function rankSearchFieldMatch(field: string, normalizedQuery: string): number {
  const normalizedField = normalizeSearchText(field);
  if (normalizedField.length === 0 || normalizedQuery.length === 0) {
    return Number.NEGATIVE_INFINITY;
  }
  if (normalizedField === normalizedQuery) {
    return 500;
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 420;
  }
  if (normalizedField.includes(normalizedQuery)) {
    return 320;
  }

  const fieldWords = normalizedField.split(" ");
  const queryWords = normalizedQuery.split(" ");
  let score = 0;
  for (const queryWord of queryWords) {
    if (queryWord.length < 2) return Number.NEGATIVE_INFINITY;
    let bestWordScore = Number.NEGATIVE_INFINITY;
    for (const fieldWord of fieldWords) {
      let cursor = 0;
      let previousMatchIndex = -2;
      let wordScore = 0;
      for (const character of queryWord) {
        const matchIndex = fieldWord.indexOf(character, cursor);
        if (matchIndex === -1) {
          wordScore = Number.NEGATIVE_INFINITY;
          break;
        }
        if (matchIndex === 0) wordScore += 8;
        if (matchIndex === previousMatchIndex + 1) wordScore += 5;
        wordScore -= Math.min(matchIndex - cursor, 4);
        previousMatchIndex = matchIndex;
        cursor = matchIndex + 1;
      }
      bestWordScore = Math.max(bestWordScore, wordScore);
    }
    if (bestWordScore === Number.NEGATIVE_INFINITY) {
      return Number.NEGATIVE_INFINITY;
    }
    score += bestWordScore;
  }
  return 100 + score;
}

function rankCommandPaletteItemMatch(
  item: CommandPaletteActionItem | CommandPaletteSubmenuItem,
  normalizedQuery: string,
): number {
  const terms = [
    typeof item.title === "string" ? item.title : "",
    typeof item.description === "string" ? item.description : "",
    ...item.searchTerms,
  ].filter((term) => term.length > 0);
  if (terms.length === 0) {
    return 0;
  }

  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery);
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      return 4_000 - index * 500 + fieldRank;
    }
  }

  return Number.NEGATIVE_INFINITY;
}

export type CommandPaletteSearchScope = "all" | "actions" | "projects" | "threads";

export function parseCommandPaletteQuery(query: string): {
  readonly query: string;
  readonly scope: CommandPaletteSearchScope;
} {
  const trimmedStart = query.trimStart();
  const prefix = trimmedStart[0];
  const scope =
    prefix === ">" ? "actions" : prefix === "@" ? "projects" : prefix === "#" ? "threads" : "all";
  return {
    scope,
    query: scope === "all" ? query : trimmedStart.slice(1).trimStart(),
  };
}

function rankSearchGroups(
  groups: ReadonlyArray<CommandPaletteGroup>,
  normalizedQuery: string,
  scope: CommandPaletteSearchScope,
): CommandPaletteGroup[] {
  const rankedItems = groups
    .flatMap((group, groupIndex) =>
      group.items.flatMap((item, itemIndex) => {
        const rank = rankCommandPaletteItemMatch(item, normalizedQuery);
        return rank === Number.NEGATIVE_INFINITY
          ? []
          : [{ group, groupIndex, item, itemIndex, rank }];
      }),
    )
    .toSorted(
      (left, right) =>
        right.rank - left.rank ||
        left.groupIndex - right.groupIndex ||
        left.itemIndex - right.itemIndex,
    );

  const totalLimit = scope === "all" ? SEARCH_RESULT_LIMIT : SCOPED_RESULT_LIMIT;
  const groupLimit = scope === "all" ? SEARCH_GROUP_RESULT_LIMIT : SCOPED_RESULT_LIMIT;
  const accepted: typeof rankedItems = [];
  const countByGroup = new Map<string, number>();
  for (const candidate of rankedItems) {
    if (accepted.length >= totalLimit) break;
    const groupCount = countByGroup.get(candidate.group.value) ?? 0;
    if (groupCount >= groupLimit) continue;
    countByGroup.set(candidate.group.value, groupCount + 1);
    accepted.push(candidate);
  }

  const outputGroups = new Map<string, CommandPaletteGroup>();
  for (const candidate of accepted) {
    const existing = outputGroups.get(candidate.group.value);
    if (existing) {
      outputGroups.set(candidate.group.value, {
        ...existing,
        items: [...existing.items, candidate.item],
      });
      continue;
    }
    outputGroups.set(candidate.group.value, {
      value: candidate.group.value,
      label: candidate.group.label,
      items: [candidate.item],
    });
  }
  return [...outputGroups.values()];
}

export function filterCommandPaletteGroups(input: {
  activeGroups: ReadonlyArray<CommandPaletteGroup>;
  actionSearchItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  query: string;
  isInSubmenu: boolean;
  projectSearchItems: ReadonlyArray<CommandPaletteActionItem>;
  threadSearchItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const parsedQuery = input.isInSubmenu
    ? { query: input.query, scope: "all" as const }
    : parseCommandPaletteQuery(input.query);
  const normalizedQuery = normalizeSearchText(parsedQuery.query);

  if (normalizedQuery.length === 0) {
    if (input.isInSubmenu || parsedQuery.scope === "all") {
      return [...input.activeGroups];
    }
    const items =
      parsedQuery.scope === "actions"
        ? input.actionSearchItems.toSorted(
            (left, right) => Number(Boolean(left.disabled)) - Number(Boolean(right.disabled)),
          )
        : parsedQuery.scope === "projects"
          ? input.projectSearchItems
          : input.threadSearchItems;
    const label =
      parsedQuery.scope === "actions"
        ? "Actions"
        : parsedQuery.scope === "projects"
          ? "Projects"
          : "Threads";
    return items.length === 0
      ? []
      : [
          {
            value: `${parsedQuery.scope}-search`,
            label,
            items: items.slice(0, SCOPED_RESULT_LIMIT),
          },
        ];
  }

  if (input.isInSubmenu) {
    return rankSearchGroups(input.activeGroups, normalizedQuery, "all");
  }

  const searchableGroups: CommandPaletteGroup[] = [];
  if (parsedQuery.scope === "all" || parsedQuery.scope === "actions") {
    searchableGroups.push({
      value: "actions-search",
      label: "Actions",
      items: input.actionSearchItems,
    });
  }
  if (parsedQuery.scope === "all" || parsedQuery.scope === "projects") {
    if (input.projectSearchItems.length > 0) {
      searchableGroups.push({
        value: "projects-search",
        label: "Projects",
        items: input.projectSearchItems,
      });
    }
  }
  if (parsedQuery.scope === "all" || parsedQuery.scope === "threads") {
    if (input.threadSearchItems.length > 0) {
      searchableGroups.push({
        value: "threads-search",
        label: "Threads",
        items: input.threadSearchItems,
      });
    }
  }
  return rankSearchGroups(searchableGroups, normalizedQuery, parsedQuery.scope);
}

export function findCommandPaletteExecutionItem(
  groups: ReadonlyArray<CommandPaletteGroup>,
  highlightedValue: string | null,
): CommandPaletteActionItem | CommandPaletteSubmenuItem | null {
  const executableItems = groups.flatMap((group) => group.items).filter((item) => !item.disabled);
  return (
    executableItems.find((item) => item.value === highlightedValue) ?? executableItems[0] ?? null
  );
}

export function buildBrowseGroups(input: {
  browseEntries: ReadonlyArray<FilesystemBrowseEntry>;
  browseQuery: string;
  canBrowseUp: boolean;
  upIcon: ReactNode;
  directoryIcon: ReactNode;
  browseUp: () => void | Promise<void>;
  browseTo: (name: string) => void | Promise<void>;
}): CommandPaletteGroup[] {
  const items: CommandPaletteActionItem[] = [];

  if (input.canBrowseUp) {
    items.push({
      kind: "action",
      value: "browse:up",
      searchTerms: [input.browseQuery, ".."],
      title: "..",
      icon: input.upIcon,
      keepOpen: true,
      run: async () => {
        await input.browseUp();
      },
    });
  }

  for (const entry of input.browseEntries) {
    items.push({
      kind: "action",
      value: `browse:${entry.fullPath}`,
      searchTerms: [input.browseQuery, entry.fullPath, entry.name],
      title: entry.name,
      icon: input.directoryIcon,
      keepOpen: true,
      run: async () => {
        await input.browseTo(entry.name);
      },
    });
  }

  return [{ value: "directories", label: "Directories", items }];
}

export function getCommandPaletteMode(input: {
  currentView: CommandPaletteView | null;
  isBrowsing: boolean;
}): CommandPaletteMode {
  if (input.currentView) {
    return input.isBrowsing ? "submenu-browse" : "submenu";
  }
  return input.isBrowsing ? "root-browse" : "root";
}

export function buildRootGroups(input: {
  suggestedActionItems: ReadonlyArray<CommandPaletteActionItem | CommandPaletteSubmenuItem>;
  recentThreadItems: ReadonlyArray<CommandPaletteActionItem>;
}): CommandPaletteGroup[] {
  const groups: CommandPaletteGroup[] = [];
  if (input.suggestedActionItems.length > 0) {
    groups.push({
      value: "suggested",
      label: "Suggested",
      items: input.suggestedActionItems,
    });
  }
  if (input.recentThreadItems.length > 0) {
    groups.push({
      value: "recent-threads",
      label: "Recent threads",
      items: input.recentThreadItems,
    });
  }
  return groups;
}

export function getCommandPaletteInputPlaceholder(mode: CommandPaletteMode): string {
  switch (mode) {
    case "root":
      return "Search threads, projects, or actions...";
    case "root-browse":
      return "Enter project path (e.g. ~/projects/my-app)";
    case "submenu":
      return "Search...";
    case "submenu-browse":
      return "Enter path (e.g. ~/projects/my-app)";
  }
}
