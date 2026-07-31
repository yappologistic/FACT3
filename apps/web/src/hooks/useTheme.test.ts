import { afterEach, describe, expect, it, vi } from "vite-plus/test";

function createStorage(overrides: Partial<Storage> = {}): Storage {
  const store = new Map<string, string>();
  return {
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
    removeItem: (key) => {
      store.delete(key);
    },
    setItem: (key, value) => {
      store.set(key, value);
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.doUnmock("react");
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("theme failure handling", () => {
  it("keeps the renderer root transparent while native translucency is enabled", async () => {
    const rootStyle = { backgroundColor: "" };
    const bodyStyle = { backgroundColor: "" };
    const themeColor = { setAttribute: vi.fn() };
    const chromeSurface = {};
    vi.stubGlobal("document", {
      body: { style: bodyStyle },
      documentElement: {
        getAttribute: (name: string) => (name === "data-translucent-sidebar" ? "true" : null),
        style: rootStyle,
      },
      querySelector: (selector: string) =>
        selector.includes("sidebar-inset") ? chromeSurface : themeColor,
    });
    vi.stubGlobal("getComputedStyle", (element: unknown) => ({
      backgroundColor: element === chromeSurface ? "rgb(45, 45, 43)" : "transparent",
    }));

    const { syncBrowserChromeTheme } = await import("./useTheme");
    syncBrowserChromeTheme();

    expect(rootStyle.backgroundColor).toBe("transparent");
    expect(bodyStyle.backgroundColor).toBe("transparent");
    expect(themeColor.setAttribute).toHaveBeenCalledWith("content", "rgb(45, 45, 43)");
  });

  it("syncs native sidebar translucency through the desktop bridge", async () => {
    const module = await import("./useTheme");
    const syncDesktopWindowTranslucencyPreference = (module as Record<string, unknown>)[
      "syncDesktopWindowTranslucencyPreference"
    ];
    expect(syncDesktopWindowTranslucencyPreference).toBeTypeOf("function");
    if (typeof syncDesktopWindowTranslucencyPreference !== "function") return;

    const setWindowTranslucency = vi.fn().mockResolvedValue(undefined);
    await syncDesktopWindowTranslucencyPreference({ setWindowTranslucency }, true);

    expect(setWindowTranslucency).toHaveBeenCalledWith(true);
  });

  it("falls back safely when a stored appearance payload is malformed", async () => {
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: (key) => (key === "t3code:appearance:v1" ? "{broken json" : null),
      }),
    });

    const { readAppearancePreferences } = await import("./useTheme");

    expect(readAppearancePreferences()).toMatchObject({
      presetId: "t3-code",
      contrast: 50,
      reduceMotion: "system",
      diffMarkers: "color",
    });
  });

  it("preserves exact storage causes and operation context", async () => {
    const readCause = new Error("storage read blocked");
    const writeCause = new Error("storage quota exceeded");
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw readCause;
        },
        setItem: () => {
          throw writeCause;
        },
      }),
    });

    const { readThemePreference, ThemeStorageError, writeThemePreference } =
      await import("./useTheme");

    try {
      readThemePreference();
      expect.unreachable("expected the theme read to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "read",
        storageKey: "t3code:theme",
        cause: readCause,
      });
    }

    try {
      writeThemePreference("dark");
      expect.unreachable("expected the theme write to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeStorageError);
      expect(error).toMatchObject({
        operation: "write",
        storageKey: "t3code:theme",
        theme: "dark",
        cause: writeCause,
      });
    }
  });

  it("falls back during initial theme application and logs only safe attributes", async () => {
    const cause = new Error("private browsing storage failure");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal("window", {
      localStorage: createStorage({
        getItem: () => {
          throw cause;
        },
      }),
      matchMedia: () => ({ matches: false }),
    });
    vi.stubGlobal("document", {
      documentElement: {
        classList: { toggle: vi.fn() },
      },
    });

    await expect(import("./useTheme")).resolves.toBeDefined();

    expect(errorLog).toHaveBeenCalledWith(
      "Failed to read theme preference for t3code:theme.",
      expect.objectContaining({
        operation: "read",
        storageKey: "t3code:theme",
        errorTag: "ThemeStorageError",
      }),
    );
    const attributes = errorLog.mock.calls[0]?.[1];
    expect(attributes).not.toHaveProperty("cause");
    expect(JSON.stringify(attributes)).not.toContain(cause.message);
  });

  it("retries a failed storage read only after a relevant storage event", async () => {
    const cause = new Error("persistent storage failure");
    const getItem = vi.fn(() => {
      throw cause;
    });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    let readSnapshot: (() => unknown) | undefined;
    let subscribeToTheme: ((listener: () => void) => () => void) | undefined;
    let storageHandler: ((event: StorageEvent) => void) | undefined;
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: (
        subscribe: (listener: () => void) => () => void,
        getSnapshot: () => unknown,
      ) => {
        subscribeToTheme = subscribe;
        readSnapshot = getSnapshot;
        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: StorageEvent) => void) => {
        if (type === "storage") storageHandler = listener;
      },
      localStorage: createStorage({ getItem }),
      matchMedia: () => ({
        matches: false,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }),
      removeEventListener: () => undefined,
    });

    const { useTheme } = await import("./useTheme");
    useTheme();
    readSnapshot?.();
    readSnapshot?.();

    // Mode and appearance are separate storage records; each failed key is
    // memoized independently so repeated snapshots do not hammer storage.
    expect(getItem).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledTimes(2);

    const unsubscribe = subscribeToTheme?.(() => undefined);
    storageHandler?.({ key: "t3code:theme" } as StorageEvent);
    readSnapshot?.();

    expect(getItem).toHaveBeenCalledTimes(3);
    expect(errorLog).toHaveBeenCalledTimes(3);
    unsubscribe?.();
  });

  it("reuses the theme snapshot between change notifications", async () => {
    const getItem = vi.fn(() => null);
    let readSnapshot: (() => unknown) | undefined;
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: (
        _subscribe: (listener: () => void) => () => void,
        getSnapshot: () => unknown,
      ) => {
        readSnapshot = getSnapshot;
        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      localStorage: createStorage({ getItem }),
      matchMedia: () => ({ matches: false }),
    });

    const { useTheme } = await import("./useTheme");
    useTheme();
    readSnapshot?.();
    readSnapshot?.();

    expect(getItem).toHaveBeenCalledTimes(2);
  });

  it("shares browser listeners across theme consumers without multiplying notifications", async () => {
    const subscribeFunctions: Array<(listener: () => void) => () => void> = [];
    const mediaListeners = new Set<() => void>();
    const storageListeners = new Set<(event: StorageEvent) => void>();
    let systemDark = false;
    const removeMediaListener = vi.fn((_: string, listener: () => void) => {
      mediaListeners.delete(listener);
    });
    const removeStorageListener = vi.fn((_: string, listener: (event: StorageEvent) => void) => {
      storageListeners.delete(listener);
    });
    vi.doMock("react", () => ({
      useCallback: <A>(callback: A) => callback,
      useEffect: () => undefined,
      useSyncExternalStore: (
        subscribe: (listener: () => void) => () => void,
        getSnapshot: () => unknown,
      ) => {
        subscribeFunctions.push(subscribe);
        return getSnapshot();
      },
    }));
    vi.stubGlobal("window", {
      addEventListener: (_: string, listener: (event: StorageEvent) => void) => {
        storageListeners.add(listener);
      },
      localStorage: createStorage(),
      matchMedia: () => ({
        matches: systemDark,
        addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
        removeEventListener: removeMediaListener,
      }),
      removeEventListener: removeStorageListener,
    });

    const { useTheme } = await import("./useTheme");
    useTheme();
    useTheme();

    const firstListener = vi.fn();
    const secondListener = vi.fn();
    const unsubscribeFirst = subscribeFunctions[0]?.(firstListener);
    const unsubscribeSecond = subscribeFunctions[1]?.(secondListener);

    expect(mediaListeners).toHaveLength(1);
    expect(storageListeners).toHaveLength(1);

    mediaListeners.values().next().value?.();

    expect(firstListener).toHaveBeenCalledTimes(1);
    expect(secondListener).toHaveBeenCalledTimes(1);

    unsubscribeFirst?.();
    expect(removeMediaListener).not.toHaveBeenCalled();
    expect(removeStorageListener).not.toHaveBeenCalled();

    unsubscribeSecond?.();
    expect(removeMediaListener).toHaveBeenCalledTimes(1);
    expect(removeStorageListener).toHaveBeenCalledTimes(1);

    systemDark = true;
    expect(useTheme().resolvedTheme).toBe("dark");
  });

  it("preserves desktop sync causes and retries after a failed cosmetic sync", async () => {
    const cause = new Error("desktop IPC unavailable");
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const setTheme = vi.fn().mockRejectedValue(cause);
    vi.stubGlobal("window", { desktopBridge: { setTheme } });

    const { DesktopThemeSyncError, syncDesktopTheme, syncDesktopThemePreference } =
      await import("./useTheme");

    const error = await syncDesktopThemePreference({ setTheme }, "dark").then(
      () => undefined,
      (failure: unknown) => failure,
    );
    expect(error).toBeInstanceOf(DesktopThemeSyncError);
    expect(error).toMatchObject({ theme: "dark", cause });

    setTheme.mockClear();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();
    syncDesktopTheme("dark");
    await Promise.resolve();
    await Promise.resolve();

    expect(setTheme).toHaveBeenCalledTimes(2);
    expect(errorLog).toHaveBeenCalledWith(
      "Failed to sync the dark theme to the desktop shell.",
      expect.objectContaining({
        theme: "dark",
        errorTag: "DesktopThemeSyncError",
      }),
    );
    for (const [, attributes] of errorLog.mock.calls) {
      expect(attributes).not.toHaveProperty("cause");
      expect(JSON.stringify(attributes)).not.toContain(cause.message);
    }
  });
});
