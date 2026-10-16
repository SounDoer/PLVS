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
