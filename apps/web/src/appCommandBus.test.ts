import { describe, expect, it, vi } from "vite-plus/test";

import { dispatchAppCommand, onAppCommand } from "./appCommandBus";

describe("appCommandBus", () => {
  it("stops at the first mounted owner that handles a command", () => {
    const first = vi.fn(() => false);
    const owner = vi.fn(() => true);
    const later = vi.fn(() => true);
    const unsubscribeFirst = onAppCommand(first);
    const unsubscribeOwner = onAppCommand(owner);
    const unsubscribeLater = onAppCommand(later);

    try {
      expect(dispatchAppCommand("terminal.toggle")).toBe(true);
      expect(first).toHaveBeenCalledWith("terminal.toggle");
      expect(owner).toHaveBeenCalledWith("terminal.toggle");
      expect(later).not.toHaveBeenCalled();
    } finally {
      unsubscribeFirst();
      unsubscribeOwner();
      unsubscribeLater();
    }
  });

  it("reports unhandled commands and removes unsubscribed owners", () => {
    const owner = vi.fn(() => true);
    const unsubscribe = onAppCommand(owner);
    unsubscribe();

    expect(dispatchAppCommand("terminal.toggle")).toBe(false);
    expect(owner).not.toHaveBeenCalled();
  });
});
