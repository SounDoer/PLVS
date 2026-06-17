/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCloseConfirm } from "./useCloseConfirm.js";

const { mockExit, closeRequestedCallback } = vi.hoisted(() => {
  const cb = { current: null };
  return {
    mockExit: vi.fn().mockResolvedValue(undefined),
    closeRequestedCallback: cb,
  };
});

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    onCloseRequested: (cb) => {
      closeRequestedCallback.current = cb;
      return Promise.resolve(() => {});
    },
  }),
}));

vi.mock("@tauri-apps/plugin-process", () => ({
  exit: mockExit,
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: () => true,
}));

describe("useCloseConfirm", () => {
  beforeEach(() => {
    localStorage.clear();
    closeRequestedCallback.current = null;
    mockExit.mockClear();
  });

  afterEach(() => vi.clearAllMocks());

  it("dialogOpen starts false", () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    expect(result.current.dialogOpen).toBe(false);
  });

  it("opens dialog when no preference saved and close is requested", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    expect(result.current.dialogOpen).toBe(true);
  });

  it("hides window without dialog when saved preference is 'tray'", async () => {
    localStorage.setItem("plvs:settings", JSON.stringify({ closeAction: "tray" }));
    const onHideWindow = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useCloseConfirm({ onHideWindow }));
    await act(async () => {
      await closeRequestedCallback.current({ preventDefault: vi.fn() });
    });
    expect(onHideWindow).toHaveBeenCalled();
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
  });

  it("handleConfirm with dontAskAgain=true writes to localStorage", async () => {
    const { result } = renderHook(() => useCloseConfirm({ onHideWindow: vi.fn() }));
    await act(async () => {
      await result.current.handleConfirm("tray", true);
    });
    expect(JSON.parse(localStorage.getItem("plvs:settings")).closeAction).toBe("tray");
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
