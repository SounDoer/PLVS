import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  enterDock: vi.fn(async () => {}),
  exitDock: vi.fn(async () => {}),
  setDockReserveSpace: vi.fn(async () => {}),
  isTauri: vi.fn(() => true),
}));

vi.mock("../ipc/commands.js", () => ({
  enterDock: mocks.enterDock,
  exitDock: mocks.exitDock,
  setDockReserveSpace: mocks.setDockReserveSpace,
}));
vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));

import { useDockMode } from "./useDockMode.js";

describe("useDockMode", () => {
  beforeEach(() => {
    mocks.enterDock.mockClear();
    mocks.exitDock.mockClear();
    mocks.setDockReserveSpace.mockClear();
    mocks.isTauri.mockReturnValue(true);
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

  it("starts disabled without injected state", () => {
    const { result } = renderHook(() => useDockMode());
    expect(result.current.dockEnabled).toBe(false);
    expect(result.current.dockEdge).toBe("bottom");
  });

  it("starts docked from injected boot state", () => {
    window.__PLVS_INITIAL_STATE__ = { dockState: { enabled: true, edge: "top" } };
    const { result } = renderHook(() => useDockMode());
    expect(result.current.dockEnabled).toBe(true);
    expect(result.current.dockEdge).toBe("top");
  });

  it("enterDockMode invokes IPC and flips state", async () => {
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.enterDockMode("top"));
    expect(mocks.enterDock).toHaveBeenCalledWith("top");
    expect(result.current.dockEnabled).toBe(true);
    expect(result.current.dockEdge).toBe("top");
  });

  it("exitDockMode passes restore attributes through", async () => {
    window.__PLVS_INITIAL_STATE__ = { dockState: { enabled: true, edge: "bottom" } };
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.exitDockMode({ decorations: true, alwaysOnTop: false }));
    expect(mocks.exitDock).toHaveBeenCalledWith({ decorations: true, alwaysOnTop: false });
    expect(result.current.dockEnabled).toBe(false);
  });

  it("is inert outside Tauri", async () => {
    mocks.isTauri.mockReturnValue(false);
    const { result } = renderHook(() => useDockMode());
    await act(() => result.current.enterDockMode("top"));
    expect(mocks.enterDock).not.toHaveBeenCalled();
    expect(result.current.dockEnabled).toBe(false);
  });

  it("enterDockMode leaves state unchanged when the IPC call rejects", async () => {
    mocks.enterDock.mockRejectedValueOnce(new Error("apply_dock_form failed"));
    const { result } = renderHook(() => useDockMode());
    await expect(act(() => result.current.enterDockMode("top"))).rejects.toThrow();
    expect(result.current.dockEnabled).toBe(false);
  });
});
