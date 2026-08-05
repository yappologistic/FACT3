import type { VcsListRefsResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveKanbanBranchValidation } from "./KanbanBranchValidation";

const RESULT: VcsListRefsResult = {
  refs: [
    {
      name: "main",
      current: true,
      isDefault: true,
      worktreePath: "D:/repo",
    },
    {
      name: "origin/release",
      isRemote: true,
      remoteName: "origin",
      current: false,
      isDefault: false,
      worktreePath: null,
    },
  ],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 2,
};

describe("resolveKanbanBranchValidation", () => {
  it("requires a non-empty branch and waits for the lookup", () => {
    expect(
      resolveKanbanBranchValidation({ branch: " ", data: RESULT, error: null, pending: false }),
    ).toMatchObject({ status: "empty", canContinue: false });
    expect(
      resolveKanbanBranchValidation({ branch: "main", data: null, error: null, pending: true }),
    ).toMatchObject({ status: "checking", canContinue: false });
  });

  it("accepts an exact local branch and rejects missing or remote-only refs", () => {
    expect(
      resolveKanbanBranchValidation({ branch: "main", data: RESULT, error: null, pending: false }),
    ).toMatchObject({ status: "valid", canContinue: true });
    expect(
      resolveKanbanBranchValidation({ branch: "main", data: RESULT, error: null, pending: true }),
    ).toMatchObject({ status: "valid", canContinue: true });
    expect(
      resolveKanbanBranchValidation({
        branch: "origin/release",
        data: RESULT,
        error: null,
        pending: false,
      }),
    ).toMatchObject({ status: "missing", canContinue: false });
    expect(
      resolveKanbanBranchValidation({
        branch: "missing",
        data: RESULT,
        error: null,
        pending: false,
      }),
    ).toMatchObject({ status: "missing", canContinue: false });
  });

  it("blocks non-repositories but leaves transient lookup errors to server validation", () => {
    expect(
      resolveKanbanBranchValidation({
        branch: "main",
        data: { ...RESULT, isRepo: false },
        error: null,
        pending: false,
      }),
    ).toMatchObject({ status: "not-repository", canContinue: false });
    expect(
      resolveKanbanBranchValidation({
        branch: "main",
        data: null,
        error: "connection interrupted",
        pending: false,
      }),
    ).toMatchObject({ status: "unavailable", canContinue: true });
  });
});
