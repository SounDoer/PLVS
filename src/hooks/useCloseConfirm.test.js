/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCloseConfirm as useCloseConfirmHook } from "./useCloseConfirm.js";
import { useRuntimeCoordination } from "../runtime/coordination.js";

/** @param {Parameters<typeof useCloseConfirmHook>[0] & { blockingEditors?: string[] }} input */
function useCloseConfirm({ blockingEditors = [], ...options }) {
  useRuntimeCoordination({
    blockingEditors,
    running: false,
    stop: async () => {},
    start: async () => {},
    show: async () => {},
  });
  return useCloseConfirmHook(options);
}

const { mockExit, mockInvoke, mockFlushPersistence, closeRequestedCallback } = vi.hoisted(() => {
  const cb = { current: null, registration: null };
  return {
    mockExit: vi.fn().mockResolvedValue(undefined),
    mockInvoke: vi.fn().mockResolvedValue(undefined),
    mockFlushPersistence: vi.fn().mockResolvedValue(undefined),
    closeRequestedCallback: cb,
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (cb) => {
      closeRequestedCallback.current = cb;
      return closeRequestedCallback.registration ?? Promise.resolve(() => {});
    },
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: mockExit,
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

// Keep persistence backed by localStorage so tests can seed/check it directly.
vi.mock("../persistence/index.js", () => {
  const settingsStore = {
    read: () => JSON.parse(localStorage.getItem("plvs:settings") ?? "{}"),
    patch: (partial) => {
      const prev = JSON.parse(localStorage.getItem("plvs:settings") ?? "{}");
      localStorage.setItem("plvs:settings", JSON.stringify({ ...prev, ...partial }));
    },
    persist: (partial) => {
      const prev = JSON.parse(localStorage.getItem("plvs:settings") ?? "{}");
      localStorage.setItem("plvs:settings", JSON.stringify({ ...prev, ...partial }));
      return Promise.resolve();
    },
    subscribe: () => () => {},
    notifyLocal: vi.fn(),
  };
  return { settingsStore, flushPersistence: mockFlushPersistence };
});

describe("useCloseConfirm", () => {
  beforeEach(() => {
    localStorage.clear();
    closeRequestedCallback.current = null;
    closeRequestedCallback.registration = null;
    mockExit.mockClear();
    mockInvoke.mockClear();
    mockFlushPersistence.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => vi.clearAllMocks());

  it("dialogOpen starts false", () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    expect(result.current.dialogOpen).toBe(false);
  });

  it("cleans up a late native registration and ignores its old callback", async () => {
    const unlisten = vi.fn();
    let finish;
    closeRequestedCallback.registration = new Promise((resolve) => {
      finish = resolve;
    });
    const { unmount } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    const listener = closeRequestedCallback.current;
    unmount();
    await act(async () => finish(unlisten));
    expect(unlisten).toHaveBeenCalledOnce();
    const preventDefault = vi.fn();
    await listener({ preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it("opens dialog when no preference saved and close is requested", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    expect(result.current.dialogOpen).toBe(true);
  });

  it("opens and resets only the exact development fixture without running a close action", () => {
    const onHideWindow = vi.fn();
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));

    act(() => result.current.developmentFixture.establish("fixture-aaaaaaaaaaaaaaaa"));
    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.developmentFixture.matches("fixture-aaaaaaaaaaaaaaaa")).toBe(true);
    expect(mockFlushPersistence).not.toHaveBeenCalled();
    expect(onHideWindow).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();

    act(() => result.current.developmentFixture.reset("fixture-bbbbbbbbbbbbbbbb"));
    expect(result.current.dialogOpen).toBe(true);
    act(() => result.current.developmentFixture.reset("fixture-aaaaaaaaaaaaaaaa"));
    expect(result.current.dialogOpen).toBe(false);
  });

  it("hides window without dialog when saved preference is 'tray'", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "tray" }));
    const onHideWindow = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    expect(mockFlushPersistence).toHaveBeenCalledOnce();
    expect(mockFlushPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      onHideWindow.mock.invocationCallOrder[0]
    );
  });

  it("does not open dialog when saved preference is 'tray'", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "tray" }));
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    expect(result.current.dialogOpen).toBe(false);
  });

  it("calls exit(0) without dialog when saved preference is 'quit'", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "quit" }));
    renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    expect(mockExit).toHaveBeenCalledWith(0);
    expect(mockFlushPersistence).toHaveBeenCalledOnce();
    expect(mockFlushPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      mockExit.mock.invocationCallOrder[0]
    );
  });

  it("leaves a blocking editor and its draft open when the saved window action is Quit", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "quit" }));
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = renderHook(() =>
        useCloseConfirm({ onHideWindow: vi.fn(), blockingEditors: ["theme-editor"] })
      );
      await act(async () => closeRequestedCallback.current({ preventDefault: vi.fn() }));
      expect(mockExit).not.toHaveBeenCalled();
      expect(mockFlushPersistence).not.toHaveBeenCalled();
      expect(mockInvoke).not.toHaveBeenCalledWith("runtime_retire_current_workspace");
      expect(result.current.closeError).toContain("Close the open editor");
    } finally {
      report.mockRestore();
    }
  });

  it("restores the saved workbench position if the native quit fails", async () => {
    mockInvoke.mockImplementation(async (name) =>
      name === "runtime_retire_current_workspace" ? 2 : undefined
    );
    mockExit.mockRejectedValueOnce(new Error("Quit failed"));
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
      await act(async () => {
        expect(await result.current.requestCloseAction("quit")).toBe(false);
      });
      expect(mockInvoke).toHaveBeenCalledWith("runtime_restore_retired_workspace", { position: 2 });
      expect(result.current.dialogOpen).toBe(true);
    } finally {
      report.mockRestore();
      mockInvoke.mockReset().mockResolvedValue(undefined);
    }
  });

  it("blocks close requests during an update even when quit is saved", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "quit" }));
    const onHideWindow = vi.fn();
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow, closeBlocked: true }));

    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });

    expect(mockExit).not.toHaveBeenCalled();
    expect(onHideWindow).not.toHaveBeenCalled();
    expect(result.current.dialogOpen).toBe(false);
  });

  it("blocks a close request captured before the update became busy", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "quit" }));
    const onHideWindow = vi.fn();
    const { rerender } = renderHook(
      ({ closeBlocked }) => useCloseConfirm({ onHideWindow, closeBlocked }),
      {
        initialProps: { closeBlocked: false },
      }
    );
    const staleCloseCallback = closeRequestedCallback.current;

    rerender({ closeBlocked: true });
    await act(async () => {
      await staleCloseCallback({ preventDefault: vi.fn() });
    });

    expect(mockExit).not.toHaveBeenCalled();
    expect(onHideWindow).not.toHaveBeenCalled();
  });

  it("handleConfirm('tray', false) calls onHideWindow and closes dialog", async () => {
    const onHideWindow = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    await act(async () => {
      await result.current.handleConfirm("tray", false);
    });
    expect(onHideWindow).toHaveBeenCalled();
    expect(result.current.dialogOpen).toBe(false);
  });

  it("handleConfirm('quit', false) calls exit(0)", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await result.current.handleConfirm("quit", false);
    });
    expect(mockExit).toHaveBeenCalledWith(0);
    const retireCall = mockInvoke.mock.calls.findIndex(
      ([command]) => command === "runtime_retire_current_workspace"
    );
    expect(retireCall).toBeGreaterThanOrEqual(0);
    expect(mockFlushPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      mockInvoke.mock.invocationCallOrder[retireCall]
    );
    expect(mockInvoke.mock.invocationCallOrder[retireCall]).toBeLessThan(
      mockExit.mock.invocationCallOrder[0]
    );
  });

  it("flushes a saved close action before quitting", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await result.current.handleConfirm("quit", true);
    });
    expect(JSON.parse(localStorage.getItem("plvs:settings")).closeAction).toBe("quit");
    expect(mockFlushPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      mockExit.mock.invocationCallOrder[0]
    );
  });

  it("flushes a saved close action before hiding", async () => {
    const onHideWindow = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));

    await act(async () => {
      await result.current.handleConfirm("tray", true);
    });

    expect(JSON.parse(localStorage.getItem("plvs:settings")).closeAction).toBe("tray");
    expect(mockFlushPersistence.mock.invocationCallOrder[0]).toBeLessThan(
      onHideWindow.mock.invocationCallOrder[0]
    );
  });

  it("keeps the window open and shows a recoverable error when flush fails", async () => {
    mockFlushPersistence.mockRejectedValueOnce(new Error("disk full"));
    const onHideWindow = vi.fn();
    const onShowWindow = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow, onShowWindow }));

    await act(async () => {
      await result.current.requestCloseAction("tray");
    });

    expect(onHideWindow).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
    expect(onShowWindow).toHaveBeenCalledOnce();
    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.closeError).toContain("window was left open");
  });

  it("retries the pending action and closes after persistence succeeds", async () => {
    mockFlushPersistence
      .mockRejectedValueOnce(new Error("disk full"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));

    await act(async () => {
      await result.current.requestCloseAction("quit");
    });
    await act(async () => {
      await result.current.handleRetry();
    });

    expect(mockFlushPersistence).toHaveBeenCalledTimes(2);
    expect(mockExit).toHaveBeenCalledWith(0);
    expect(result.current.dialogOpen).toBe(false);
    expect(result.current.closeError).toBeNull();
  });

  it("keeps the Retry action when the native hide fails", async () => {
    const onHideWindow = vi
      .fn()
      .mockRejectedValueOnce(new Error("native hide failed"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));

    await act(async () => {
      await expect(result.current.requestCloseAction("tray")).resolves.toBe(false);
    });
    expect(result.current.dialogOpen).toBe(true);
    expect(result.current.closeError).toContain("hide the window");

    await act(() => result.current.handleRetry());
    expect(onHideWindow).toHaveBeenCalledTimes(2);
    expect(result.current.dialogOpen).toBe(false);
  });

  it("handleConfirm with dontAskAgain=false does not write to localStorage", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await result.current.handleConfirm("tray", false);
    });
    expect(JSON.parse(localStorage.getItem("plvs:settings") ?? "{}").closeAction).toBeUndefined();
  });

  it("handleCancel closes dialog without any action", () => {
    const onHideWindow = vi.fn();
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow }));
    act(() => result.current.handleCancel());
    expect(result.current.dialogOpen).toBe(false);
    expect(onHideWindow).not.toHaveBeenCalled();
    expect(mockExit).not.toHaveBeenCalled();
  });
});
