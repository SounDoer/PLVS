/** @vitest-environment jsdom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

const invokeMock = vi.fn();
const listenMock = vi.fn();
const unlistenMock = vi.fn();
const isTauriMock = vi.fn().mockReturnValue(true);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args) => invokeMock(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args) => listenMock(...args),
}));
vi.mock("../ipc/env.js", () => ({
  isTauri: () => isTauriMock(),
}));

const { useTaskbarColorScheme } = await import("./useTaskbarColorScheme.js");

describe("useTaskbarColorScheme", () => {
  let emit;

  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue("dark");
    listenMock.mockImplementation(async (_event, handler) => {
      emit = (payload) => handler({ payload });
      return unlistenMock;
    });
  });

  it("reads the current mode and follows change events", async () => {
    const { result } = renderHook(() => useTaskbarColorScheme(true));
    await act(async () => {});
    expect(listenMock).toHaveBeenCalledWith("taskbar-color-scheme-changed", expect.any(Function));
    expect(invokeMock).toHaveBeenCalledWith("taskbar_color_scheme");
    expect(result.current).toBe("dark");

    act(() => emit("light"));
    expect(result.current).toBe("light");
  });

  it("reports null where the backend has no taskbar mode", async () => {
    invokeMock.mockResolvedValue(null);
    const { result } = renderHook(() => useTaskbarColorScheme(true));
    await act(async () => {});
    expect(result.current).toBeNull();
  });

  it("does nothing while disabled", async () => {
    const { result } = renderHook(() => useTaskbarColorScheme(false));
    await act(async () => {});
    expect(listenMock).not.toHaveBeenCalled();
    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it("stops listening when disabled or unmounted", async () => {
    const { rerender, result } = renderHook(({ enabled }) => useTaskbarColorScheme(enabled), {
      initialProps: { enabled: true },
    });
    await act(async () => {});
    expect(result.current).toBe("dark");

    rerender({ enabled: false });
    expect(unlistenMock).toHaveBeenCalledTimes(1);
    expect(result.current).toBeNull();
  });
});
