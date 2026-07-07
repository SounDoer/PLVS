/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const relaunchMock = vi.fn();
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args) => relaunchMock(...args),
}));

import { useApplyUpdate } from "./useApplyUpdate.js";

describe("useApplyUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("starts idle", () => {
    const { result } = renderHook(() => useApplyUpdate());
    expect(result.current.installStatus).toBe("idle");
  });

  it("moves to installing then ready on a successful download+install", async () => {
    let resolveInstall;
    const update = {
      downloadAndInstall: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveInstall = resolve;
          })
      ),
    };
    const { result } = renderHook(() => useApplyUpdate());

    act(() => {
      result.current.install(update);
    });
    expect(result.current.installStatus).toBe("installing");

    await act(async () => {
      resolveInstall();
    });
    await waitFor(() => expect(result.current.installStatus).toBe("ready"));
  });

  it("moves to error when downloadAndInstall rejects", async () => {
    const update = { downloadAndInstall: vi.fn().mockRejectedValue(new Error("boom")) };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("error");
  });

  it("does nothing when install is called with no update handle", async () => {
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(null);
    });

    expect(result.current.installStatus).toBe("idle");
  });

  it("relaunches the app on restartToApply", () => {
    const { result } = renderHook(() => useApplyUpdate());

    act(() => {
      result.current.restartToApply();
    });

    expect(relaunchMock).toHaveBeenCalledTimes(1);
  });
});
