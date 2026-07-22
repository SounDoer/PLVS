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

  it("stays installing until downloadAndInstall completes", async () => {
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
      void result.current.install(update);
    });
    expect(result.current.installStatus).toBe("installing");

    relaunchMock.mockResolvedValue();
    await act(async () => {
      resolveInstall();
    });
    await waitFor(() => expect(relaunchMock).toHaveBeenCalledTimes(1));
  });

  it("automatically relaunches after a successful installation", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock.mockResolvedValue();
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(result.current.installStatus).toBe("restarting");
  });

  it("reports an install error without trying to relaunch", async () => {
    const update = {
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("download failed")),
    };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("install-error");
    expect(relaunchMock).not.toHaveBeenCalled();
  });

  it("reports a restart error after installation succeeds", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock.mockRejectedValueOnce(new Error("relaunch failed"));
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("restart-error");
  });

  it("retries only relaunch after a restart error", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock
      .mockRejectedValueOnce(new Error("relaunch failed"))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });
    await act(async () => {
      await result.current.restartToApply();
    });

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(2);
    expect(result.current.installStatus).toBe("restarting");
  });

  it("resets a dismissed error before the dialog is reopened", async () => {
    const update = {
      downloadAndInstall: vi.fn().mockRejectedValue(new Error("download failed")),
    };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });
    act(() => {
      result.current.resetInstall();
    });

    expect(result.current.installStatus).toBe("idle");
  });

  it("does nothing when install is called with no update handle", async () => {
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(null);
    });

    expect(result.current.installStatus).toBe("idle");
    expect(relaunchMock).not.toHaveBeenCalled();
  });
});
