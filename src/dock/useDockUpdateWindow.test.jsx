/** @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useDockUpdateWindow } from "./useDockUpdateWindow.js";

const mock = vi.hoisted(() => ({
  ready: vi.fn(),
  action: vi.fn(),
  invoke: vi.fn(),
  emit: vi.fn(),
}));
vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mock.invoke }));
vi.mock("../ipc/dockAccessoryEvents.js", () => ({
  emitDockAccessoryState: mock.emit,
  listenDockAccessoryReady: mock.ready,
  listenDockAccessoryAction: mock.action,
}));
vi.mock("../theme/themeRuntime.js", () => ({
  createThemePublication: () => null,
  themeRuntime: { getSnapshot: () => null, subscribe: () => () => {} },
}));
const options = {
  active: false,
  edge: "bottom",
  payload: { key: null },
  onAction: vi.fn(),
  onGeometry: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  mock.invoke.mockResolvedValue(null);
  mock.emit.mockResolvedValue(undefined);
  mock.ready.mockResolvedValue(vi.fn());
  mock.action.mockResolvedValue(vi.fn());
});

it("releases each late listener exactly once after owner unmount", async () => {
  let resolveReady;
  const disposeReady = vi.fn();
  const disposeAction = vi.fn();
  mock.ready.mockReturnValue(
    new Promise((resolve) => {
      resolveReady = resolve;
    })
  );
  mock.action.mockResolvedValue(disposeAction);
  const { unmount } = renderHook(() => useDockUpdateWindow(options));
  unmount();
  await act(async () => {
    resolveReady(disposeReady);
  });
  expect(disposeReady).toHaveBeenCalledOnce();
  expect(disposeAction).toHaveBeenCalledOnce();
});

it("reports native creation failures to the owner fallback", async () => {
  mock.invoke.mockRejectedValue(new Error("Window unavailable"));
  const { result } = renderHook(() => useDockUpdateWindow(options));
  await waitFor(() => expect(result.current.error).toContain("Window unavailable"));
});

it("resizes current content and ignores stale or invalid height reports", async () => {
  let dispatch;
  mock.action.mockImplementation(async (listener) => {
    dispatch = listener;
    return vi.fn();
  });
  renderHook(() =>
    useDockUpdateWindow({ ...options, active: true, payload: { key: "details:a" } })
  );
  await waitFor(() => expect(dispatch).toBeTypeOf("function"));
  const send = (key, height) =>
    dispatch({
      surface: "dock-update",
      type: "update-resize",
      payload: { key, height },
    });
  act(() => {
    dispatch({ surface: "dock-update", type: "update-ready", payload: { key: "details:a" } });
    send("details:a", 178);
  });
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenLastCalledWith(
      "set_dock_update_window",
      expect.objectContaining({ visible: true, contentHeight: 178 })
    )
  );
  act(() => send("details:a", 410));
  await waitFor(() =>
    expect(mock.invoke).toHaveBeenLastCalledWith(
      "set_dock_update_window",
      expect.objectContaining({ contentHeight: 410 })
    )
  );
  const count = mock.invoke.mock.calls.length;
  act(() => {
    send("details:old", 999);
    send("details:a", NaN);
    send("details:a", -1);
  });
  expect(mock.invoke.mock.calls).toHaveLength(count);
});
