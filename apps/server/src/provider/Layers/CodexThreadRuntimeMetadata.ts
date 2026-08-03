// @effect-diagnostics nodeBuiltinImport:off - Codex's provider-owned SQLite state is a Node filesystem boundary.
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export interface CodexThreadRuntimeMetadata {
  readonly model: string;
  readonly reasoningEffort?: string;
}

interface CodexThreadRuntimeRow {
  readonly model?: unknown;
  readonly reasoning_effort?: unknown;
}

async function stateDatabaseCandidates(codexHome: string): Promise<ReadonlyArray<string>> {
  const directories = [codexHome, NodePath.join(codexHome, "sqlite")];
  const candidates: Array<{ readonly path: string; readonly modifiedAt: number }> = [];

  for (const directory of directories) {
    let entries: ReadonlyArray<string>;
    try {
      entries = await NodeFSP.readdir(directory);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!/^state_\d+\.sqlite$/u.test(entry)) continue;
      const path = NodePath.join(directory, entry);
      try {
        const stat = await NodeFSP.stat(path);
        candidates.push({ path, modifiedAt: stat.mtimeMs });
      } catch {
        // A concurrently rotated provider database is safe to skip.
      }
    }
  }

  return candidates.toSorted((a, b) => b.modifiedAt - a.modifiedAt).map(({ path }) => path);
}

function normalizeRuntimeRow(
  row: CodexThreadRuntimeRow | undefined,
): CodexThreadRuntimeMetadata | undefined {
  const model = typeof row?.model === "string" ? row.model.trim() : "";
  const reasoningEffort =
    typeof row?.reasoning_effort === "string" ? row.reasoning_effort.trim() : "";
  if (!model) return undefined;
  return {
    model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
  };
}

async function readRuntimeRow(
  databasePath: string,
  threadId: string,
): Promise<CodexThreadRuntimeMetadata | undefined> {
  if (process.versions.bun !== undefined) {
    const { Database } = await import("bun:sqlite");
    const database = new Database(databasePath, { readonly: true });
    try {
      const row = database
        .query("SELECT model, reasoning_effort FROM threads WHERE id = ? LIMIT 1")
        .get(threadId) as CodexThreadRuntimeRow | undefined;
      return normalizeRuntimeRow(row);
    } finally {
      database.close();
    }
  }

  const { DatabaseSync } = await import("node:sqlite");
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const row = database
      .prepare("SELECT model, reasoning_effort FROM threads WHERE id = ? LIMIT 1")
      .get(threadId) as CodexThreadRuntimeRow | undefined;
    return normalizeRuntimeRow(row);
  } finally {
    database.close();
  }
}

/**
 * Reads the effective runtime that Codex persisted for one spawned child.
 * App-server activity items currently omit these fields, while the provider's
 * state database records the model after fallback and normalization.
 */
export async function readCodexThreadRuntimeMetadata(
  codexHome: string,
  threadId: string,
): Promise<CodexThreadRuntimeMetadata | undefined> {
  for (const databasePath of await stateDatabaseCandidates(codexHome)) {
    try {
      const metadata = await readRuntimeRow(databasePath, threadId);
      if (metadata) return metadata;
    } catch {
      // Older provider database versions can coexist with the active one.
    }
  }
  return undefined;
}
