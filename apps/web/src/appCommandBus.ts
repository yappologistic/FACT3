import type { KeybindingCommand } from "@t3tools/contracts";

export type AppCommandId = KeybindingCommand;

type AppCommandListener = (command: AppCommandId) => boolean;

const listeners = new Set<AppCommandListener>();

/**
 * Executes an application command through the mounted UI owner that already
 * implements it. Returning false lets callers report context-dependent
 * commands that are not currently available instead of silently doing nothing.
 */
export function dispatchAppCommand(command: AppCommandId): boolean {
  for (const listener of listeners) {
    if (listener(command)) {
      return true;
    }
  }
  return false;
}

export function onAppCommand(listener: AppCommandListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
