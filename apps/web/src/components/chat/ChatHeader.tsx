import {
  type EnvironmentId,
  type EditorId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@t3tools/contracts";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { memo } from "react";
import {
  GitBranchPlusIcon,
  HistoryIcon,
  LayoutDashboardIcon,
  MessageSquareIcon,
} from "lucide-react";
import GitActionsControl from "../GitActionsControl";
import { type DraftId } from "~/composerDraftStore";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import ProjectScriptsControl, {
  type NewProjectScriptInput,
  type ProjectScriptActionResult,
} from "../ProjectScriptsControl";
import { OpenInPicker } from "./OpenInPicker";
import { usePrimaryEnvironmentId } from "../../state/environments";
import { useT3ProjectFileScripts } from "~/hooks/useT3ProjectFileScripts";
import { ProjectFavicon } from "../ProjectFavicon";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";

export type WorkspaceView = "chat" | "board";

interface ChatHeaderProps {
  activeThreadEnvironmentId: EnvironmentId;
  activeThreadId: ThreadId;
  draftId?: DraftId;
  activeThreadTitle: string;
  activeProjectName: string | undefined;
  activeProjectCwd: string | null;
  openInCwd: string | null;
  activeProjectScripts: ReadonlyArray<ProjectScript> | undefined;
  preferredScriptId: string | null;
  keybindings: ResolvedKeybindingsConfig;
  availableEditors: ReadonlyArray<EditorId>;
  rightPanelOpen: boolean;
  gitCwd: string | null;
  onNewThreadInProject: () => void;
  onRunProjectScript: (script: ProjectScript) => void;
  onAddProjectScript: (input: NewProjectScriptInput) => Promise<ProjectScriptActionResult>;
  onUpdateProjectScript: (
    scriptId: string,
    input: NewProjectScriptInput,
  ) => Promise<ProjectScriptActionResult>;
  onDeleteProjectScript: (scriptId: string) => Promise<ProjectScriptActionResult>;
  workspaceView: WorkspaceView;
  onWorkspaceViewChange: (view: WorkspaceView) => void;
  kanbanHistoryOpen: boolean;
  onKanbanHistoryOpenChange: (open: boolean) => void;
  onNewWorktree: () => void;
}

export function shouldShowOpenInPicker(input: {
  readonly activeProjectName: string | undefined;
  readonly activeThreadEnvironmentId: EnvironmentId;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): boolean {
  return (
    Boolean(input.activeProjectName) &&
    input.primaryEnvironmentId !== null &&
    input.activeThreadEnvironmentId === input.primaryEnvironmentId
  );
}

export const ChatHeader = memo(function ChatHeader({
  activeThreadEnvironmentId,
  activeThreadId,
  draftId,
  activeThreadTitle,
  activeProjectName,
  activeProjectCwd,
  openInCwd,
  activeProjectScripts,
  preferredScriptId,
  keybindings,
  availableEditors,
  rightPanelOpen,
  gitCwd,
  onNewThreadInProject,
  onRunProjectScript,
  onAddProjectScript,
  onUpdateProjectScript,
  onDeleteProjectScript,
  workspaceView,
  onWorkspaceViewChange,
  kanbanHistoryOpen,
  onKanbanHistoryOpenChange,
  onNewWorktree,
}: ChatHeaderProps) {
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const fileScripts = useT3ProjectFileScripts(
    activeThreadEnvironmentId,
    activeProjectScripts ? activeProjectCwd : null,
  );
  const showOpenInPicker = shouldShowOpenInPicker({
    activeProjectName,
    activeThreadEnvironmentId,
    primaryEnvironmentId,
  });
  return (
    <div className="@container/header-actions grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 sm:gap-3">
      <div className="flex min-w-0 items-center gap-2 overflow-hidden sm:gap-3">
        {/* The project always leads the header: knowing which project a
            thread lives in is priority zero, and the thread title alone
            doesn't answer it. */}
        {activeProjectName ? (
          <span className="inline-flex shrink-0 items-center gap-2">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label={`New thread in ${activeProjectName}`}
                    onClick={onNewThreadInProject}
                    className="inline-flex min-w-0 cursor-pointer items-center gap-1.5 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
                  />
                }
              >
                <ProjectFavicon
                  environmentId={activeThreadEnvironmentId}
                  cwd={activeProjectCwd ?? ""}
                  className="size-3.5"
                />
                <span className="max-w-40 truncate text-sm font-medium">{activeProjectName}</span>
              </TooltipTrigger>
              <TooltipPopup side="top">New thread in {activeProjectName}</TooltipPopup>
            </Tooltip>
            <span aria-hidden className="text-muted-foreground/40">
              /
            </span>
          </span>
        ) : null}
        <Tooltip>
          <TooltipTrigger
            render={
              <h2
                aria-label={activeThreadTitle}
                className="min-w-0 flex-1 truncate text-sm font-medium text-foreground"
              >
                {activeThreadTitle}
              </h2>
            }
          />
          <TooltipPopup side="top">{activeThreadTitle}</TooltipPopup>
        </Tooltip>
      </div>

      {activeProjectName ? (
        <div
          aria-label="Project view"
          className="flex items-center justify-self-center rounded-full border border-foreground/[0.08] bg-foreground/[0.035] p-0.5 [-webkit-app-region:no-drag]"
        >
          <button
            type="button"
            aria-label="Open project board"
            aria-pressed={workspaceView === "board"}
            onClick={() => onWorkspaceViewChange("board")}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-[background-color,color,box-shadow] duration-150",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              workspaceView === "board"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            <LayoutDashboardIcon aria-hidden className="size-3" />
            <span className="hidden sm:inline">Board</span>
          </button>
          <button
            type="button"
            aria-label="Open project chat"
            aria-pressed={workspaceView === "chat"}
            onClick={() => onWorkspaceViewChange("chat")}
            className={cn(
              "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] transition-[background-color,color,box-shadow] duration-150",
              "focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
              workspaceView === "chat"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            <MessageSquareIcon aria-hidden className="size-3" />
            <span className="hidden sm:inline">Chat</span>
          </button>
        </div>
      ) : (
        <span />
      )}

      <div
        data-chat-header-actions
        className={cn(
          "flex min-w-0 shrink-0 items-center justify-self-end gap-2 @3xl/header-actions:gap-3",
          rightPanelOpen ? "pr-0" : "pr-16",
        )}
      >
        {workspaceView === "board" && activeProjectName ? (
          <>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="[-webkit-app-region:no-drag]"
              onClick={onNewWorktree}
            >
              <GitBranchPlusIcon aria-hidden className="size-3.5" />
              <span className="hidden @3xl/header-actions:inline">New worktree</span>
            </Button>
            <Button
              type="button"
              variant={kanbanHistoryOpen ? "secondary" : "outline"}
              size="xs"
              className="[-webkit-app-region:no-drag]"
              aria-pressed={kanbanHistoryOpen}
              onClick={() => onKanbanHistoryOpenChange(!kanbanHistoryOpen)}
            >
              <HistoryIcon aria-hidden className="size-3.5" />
              <span className="hidden @3xl/header-actions:inline">
                {kanbanHistoryOpen ? "Active board" : "History"}
              </span>
            </Button>
          </>
        ) : (
          <>
            {activeProjectScripts && (
              <ProjectScriptsControl
                scripts={activeProjectScripts}
                fileScripts={fileScripts}
                keybindings={keybindings}
                preferredScriptId={preferredScriptId}
                onRunScript={onRunProjectScript}
                onAddScript={onAddProjectScript}
                onUpdateScript={onUpdateProjectScript}
                onDeleteScript={onDeleteProjectScript}
              />
            )}
            {showOpenInPicker && (
              <OpenInPicker
                environmentId={activeThreadEnvironmentId}
                keybindings={keybindings}
                availableEditors={availableEditors}
                openInCwd={openInCwd}
              />
            )}
            {activeProjectName && (
              <GitActionsControl
                gitCwd={gitCwd}
                activeThreadRef={scopeThreadRef(activeThreadEnvironmentId, activeThreadId)}
                {...(draftId ? { draftId } : {})}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
});
