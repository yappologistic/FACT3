import { describe, expect, it } from "vite-plus/test";

import { deriveActiveWorkStartedAt, isLatestTurnSettled } from "./orchestrationTiming.ts";

const completedTurn = {
  turnId: "turn-1",
  startedAt: "2026-08-01T00:00:00.000Z",
  completedAt: "2026-08-01T00:00:05.000Z",
};

describe("orchestration timing settlement", () => {
  it("treats a matching completed turn as settled when the session flag is stale", () => {
    const session = { orchestrationStatus: "running", activeTurnId: "turn-1" };

    expect(isLatestTurnSettled(completedTurn, session)).toBe(true);
    expect(deriveActiveWorkStartedAt(completedTurn, session, null)).toBeNull();
  });

  it("keeps a different active turn busy while its projection catches up", () => {
    const session = { orchestrationStatus: "running", activeTurnId: "turn-2" };

    expect(isLatestTurnSettled(completedTurn, session)).toBe(false);
    expect(deriveActiveWorkStartedAt(completedTurn, session, null)).toBe(completedTurn.startedAt);
  });

  it("trusts a ready session while the latest-turn snapshot catches up", () => {
    const session = { orchestrationStatus: "ready", activeTurnId: null };
    const staleTurn = { ...completedTurn, completedAt: null };

    expect(isLatestTurnSettled(staleTurn, session)).toBe(true);
    expect(deriveActiveWorkStartedAt(staleTurn, session, null)).toBeNull();
  });
});
