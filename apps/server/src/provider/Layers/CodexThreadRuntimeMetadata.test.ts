// @effect-diagnostics nodeBuiltinImport:off
import * as NodeAssert from "node:assert/strict";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeSqlite from "node:sqlite";

import { afterEach, describe, it } from "vite-plus/test";

import { readCodexThreadRuntimeMetadata } from "./CodexThreadRuntimeMetadata.ts";

describe("readCodexThreadRuntimeMetadata", () => {
  const temporaryDirectories: Array<string> = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      NodeFS.rmSync(directory, { recursive: true, force: true });
    }
  });

  it("reads the effective child runtime from Codex provider state", async () => {
    const codexHome = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-codex-runtime-metadata-"),
    );
    temporaryDirectories.push(codexHome);
    const database = new NodeSqlite.DatabaseSync(NodePath.join(codexHome, "state_5.sqlite"));
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, reasoning_effort TEXT)");
    database
      .prepare("INSERT INTO threads (id, model, reasoning_effort) VALUES (?, ?, ?)")
      .run("child-1", "gpt-5.6-terra", "medium");
    database.close();

    NodeAssert.deepEqual(await readCodexThreadRuntimeMetadata(codexHome, "child-1"), {
      model: "gpt-5.6-terra",
      reasoningEffort: "medium",
    });
  });

  it("returns no metadata when the child is absent", async () => {
    const codexHome = NodeFS.mkdtempSync(
      NodePath.join(NodeOS.tmpdir(), "t3-codex-runtime-metadata-missing-"),
    );
    temporaryDirectories.push(codexHome);
    const database = new NodeSqlite.DatabaseSync(NodePath.join(codexHome, "state_5.sqlite"));
    database.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, model TEXT, reasoning_effort TEXT)");
    database.close();

    NodeAssert.equal(await readCodexThreadRuntimeMetadata(codexHome, "missing-child"), undefined);
  });
});
