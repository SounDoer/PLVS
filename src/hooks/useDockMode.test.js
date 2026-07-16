import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enterDock: vi.fn(async () => {}),
  exitDock: vi.fn(async () => {}),
  getDockState: vi.fn(async () => undefined),
  setDockReserveSpace: vi.fn(async () => {}),
  setDockHeight: vi.fn(async ({ height }) => height),
  setDockSuspended: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
  patchPresets: vi.fn(),
}));

vi.mock("../ipc/commands.js", () => ({
  enterDock: mocks.enterDock,
  exitDock: mocks.exitDock,
  getDockState: mocks.getDockState,
  setDockReserveSpace: mocks.setDockReserveSpace,
  setDockHeight: mocks.setDockHeight,
  setDockSuspended: mocks.setDockSuspended,
}));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("../persistence/index.js", () => ({
  presetsStore: { patch: mocks.patchPresets },
}));

import { useDockMode } from "./useDockMode.js";

describe("useDockMode", () => {
  beforeEach(() => {
    mocks.enterDock.mockClear();
    mocks.exitDock.mockClear();
    mocks.getDockState.mockReset().mockResolvedValue(undefined);
    mocks.setDockReserveSpace.mockReset().mockResolvedValue(undefined);
    mocks.setDockHeight.mockReset().mockImplementation(async ({ height }) => height);
    mocks.setDockSuspended.mockReset().mockResolvedValue(undefined);
    mocks.isTauri.mockReturnValue(true);
    mocks.patchPresets.mockClear();
    delete window.__PLVS_INITIAL_STATE__;
  });

  it("toggles reserve-space through IPC using the current edge", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "top", reserveSpace: false },
    };
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.setReserveSpace(true));
    expect(mocks.setDockReserveSpace).toHaveBeenCalledWith({ enabled: true, edge: "top" });
    expect(result.current.reserveSpace).toBe(true);
  });

  it("uses an explicit edge while applying preset reserve-space", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", reserveSpace: false },
    };
    const { result } = renderHook(() => useDockMode());

    await act(() => result.current.setReserveSpace(true, "top"));

    expect(mocks.setDockReserveSpace).toHaveBeenCalledWith({ enabled: true, edge: "top" });
    expect(result.current).toMatchObject({ dockEdge: "top", reserveSpace: true });
  });

  it("keeps reserve-space enabled when moving to the other edge", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "top", reserveSpace: true },
    };
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.enterDockMode("bottom"));
    expect(result.current).toMatchObject({ dockEdge: "bottom", reserveSpace: true });
  });

  it("applies a preset edge and reserve-space target in one dock transition", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", reserveSpace: false },
    };
    const { result } = renderHook(() => useDockMode());

    await act(() => result.current.enterDockMode("top", true));

    expect(mocks.enterDock).toHaveBeenCalledWith("top", true, undefined, undefined);
    expect(mocks.setDockReserveSpace).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ dockEdge: "top", reserveSpace: true });
  });

  it("marks the active preset dirty after a successful reserve-space change", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "top", reserveSpace: false },
    };
    const { result } = renderHook(() => useDockMode());

    await act(() => result.current.setReserveSpace(true));

    expect(mocks.patchPresets).toHaveBeenCalledWith({ dirty: true });
  });

  it("serializes rapid reserve toggles and computes each from the latest state", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", reserveSpace: false },
    };
    let releaseFirst;
    mocks.setDockReserveSpace.mockImplementationOnce(
      () => new Promise((resolve) => (releaseFirst = resolve))
    );
    const { result } = renderHook(() => useDockMode());

    let first;
    let second;
    await act(async () => {
      first = result.current.toggleReserveSpace();
      second = result.current.toggleReserveSpace();
      await Promise.resolve();
    });

    expect(mocks.setDockReserveSpace).toHaveBeenCalledTimes(1);
    expect(mocks.setDockReserveSpace).toHaveBeenLastCalledWith({
      enabled: true,
      edge: "bottom",
    });

    await act(async () => {
      releaseFirst();
      await Promise.all([first, second]);
    });

    expect(mocks.setDockReserveSpace.mock.calls).toEqual([
      [{ enabled: true, edge: "bottom" }],
      [{ enabled: false, edge: "bottom" }],
    ]);
    expect(result.current.reserveSpace).toBe(false);
  });

  it("starts disabled without injected state", () => {
    const { result } = renderHook(() => useDockMode());
    expect(result.current.dockEnabled).toBe(false);
    expect(result.current.dockEdge).toBe("bottom");
    expect(result.current.reserveSpace).toBe(true);
  });

  it("starts docked from injected boot state", () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "top", monitor: "\\\\.\\DISPLAY2" },
    };
    const { result } = renderHook(() => useDockMode());
    expect(result.current.dockEnabled).toBe(true);
    expect(result.current.dockEdge).toBe("top");
    expect(result.current.dockMonitor).toBe("\\\\.\\DISPLAY2");
    expect(result.current.reserveSpace).toBe(true);
  });

  it("reconciles a failed native boot restore instead of trusting stale injected state", async () => {
    window.__PLVS_INITIAL_STATE__ = { dockState: { enabled: true, edge: "top" } };
    mocks.getDockState.mockResolvedValueOnce({ enabled: false, edge: "top", reserveSpace: false });
    const { result } = renderHook(() => useDockMode());

    await waitFor(() => expect(result.current.dockEnabled).toBe(false));
    expect(result.current.reserveSpace).toBe(false);
  });

  it("enterDockMode invokes IPC and flips state", async () => {
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.enterDockMode("top"));
    expect(mocks.enterDock).toHaveBeenCalledWith("top", undefined, undefined, undefined);
    expect(result.current.dockEnabled).toBe(true);
    expect(result.current.dockEdge).toBe("top");
    expect(mocks.patchPresets).toHaveBeenCalledWith({ dirty: true });
  });

  it("stores the monitor resolved by the dock IPC call", async () => {
    mocks.enterDock.mockResolvedValueOnce({
      enabled: true,
      edge: "top",
      monitor: "\\\\.\\DISPLAY2",
      reserveSpace: true,
    });
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.enterDockMode("top", true, "\\\\.\\DISPLAY2"));
    expect(mocks.enterDock).toHaveBeenCalledWith("top", true, "\\\\.\\DISPLAY2", undefined);
    expect(result.current).toMatchObject({ dockMonitor: "\\\\.\\DISPLAY2" });
  });

  it("exitDockMode passes restore attributes through", async () => {
    window.__PLVS_INITIAL_STATE__ = { dockState: { enabled: true, edge: "bottom" } };
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.exitDockMode({ decorations: true, alwaysOnTop: false }));
    expect(mocks.exitDock).toHaveBeenCalledWith({ decorations: true, alwaysOnTop: false });
    expect(result.current.dockEnabled).toBe(false);
    expect(result.current.reserveSpace).toBe(true);
    expect(mocks.patchPresets).toHaveBeenCalledWith({ dirty: true });
  });

  it("resizes and persists dock height through IPC", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", height: 72 },
    };
    const { result } = renderHook(() => useDockMode());

    await act(() => result.current.resizeDockHeight(110, { persist: true }));

    expect(mocks.setDockHeight).toHaveBeenCalledWith({ height: 110, persist: true });
    expect(result.current.dockHeight).toBe(110);
    expect(mocks.patchPresets).toHaveBeenCalledWith({ dirty: true });
  });

  it("clamps legacy and requested dock heights", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", height: 10 },
    };
    const { result } = renderHook(() => useDockMode());
    expect(result.current.dockHeight).toBe(56);

    await act(() => result.current.resizeDockHeight(999, { persist: false }));
    expect(mocks.setDockHeight).toHaveBeenCalledWith({ height: 160, persist: false });
    expect(result.current.dockHeight).toBe(56);
  });

  it("exposes a render-only preview height until the resize is committed", async () => {
    window.__PLVS_INITIAL_STATE__ = {
      dockState: { enabled: true, edge: "bottom", height: 72 },
    };
    const { result } = renderHook(() => useDockMode());

    await act(() => result.current.resizeDockHeight(124, { persist: false }));
    expect(result.current.dockPreviewHeight).toBe(124);
    expect(result.current.dockHeight).toBe(72);
    expect(mocks.patchPresets).not.toHaveBeenCalled();

    await act(() => result.current.resizeDockHeight(124, { persist: true }));
    expect(result.current.dockPreviewHeight).toBeNull();
    expect(result.current.dockHeight).toBe(124);
    expect(mocks.patchPresets).toHaveBeenCalledWith({ dirty: true });
  });

  it("is inert outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.enterDockMode("top"));
    expect(mocks.enterDock).not.toHaveBeenCalled();
    expect(result.current.dockEnabled).toBe(false);
  });

  it("suspends and resumes the native Dock without exiting it", async () => {
    window.__PLVS_INITIAL_STATE__ = { dockState: { enabled: true, edge: "bottom" } };
    const { result } = renderHook(() => useDockMode());

    await act(() => result.current.suspendDockMode());
    expect(mocks.setDockSuspended).toHaveBeenCalledWith(true);
    expect(result.current).toMatchObject({ dockEnabled: true, dockSuspended: true });

    await act(() => result.current.resumeDockMode());
    expect(mocks.setDockSuspended).toHaveBeenLastCalledWith(false);
    expect(result.current).toMatchObject({ dockEnabled: true, dockSuspended: false });
  });

  it("enterDockMode leaves state unchanged when the IPC call rejects", async () => {
    mocks.enterDock.mockRejectedValueOnce(new Error("apply_dock_form failed"));
    const { result } = renderHook(() => useDockMode());
    await expect(act(() => result.current.enterDockMode("top"))).rejects.toThrow();
    expect(result.current.dockEnabled).toBe(false);
    expect(mocks.patchPresets).not.toHaveBeenCalled();
  });
});
