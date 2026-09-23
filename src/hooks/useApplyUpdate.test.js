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

  it("passes a finite timeout to the updater download", async () => {
    const update = { downloadAndInstall: vi.fn().mockResolvedValue() };
    relaunchMock.mockResolvedValue();
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(update.downloadAndInstall).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 10 * 60 * 1000,
    });
  });

  it("publishes download progress when the integer percent changes", async () => {
    let onEvent;
    let resolveInstall;
    const update = {
      downloadAndInstall: vi.fn(
        (callback) =>
          new Promise((resolve) => {
            onEvent = callback;
            resolveInstall = resolve;
          })
      ),
    };
    const { result } = renderHook(() => useApplyUpdate());

    act(() => {
      void result.current.install(update);
    });
    expect(result.current.downloadProgress).toBeNull();

    act(() => {
      onEvent({ event: "Started", data: { contentLength: 1000 } });
    });
    expect(result.current.downloadProgress).toBe(0);

    act(() => {
      onEvent({ event: "Progress", data: { chunkLength: 4 } });
    });
    expect(result.current.downloadProgress).toBe(0);

    act(() => {
      onEvent({ event: "Progress", data: { chunkLength: 6 } });
    });
    expect(result.current.downloadProgress).toBe(0.01);

    act(() => {
      onEvent({ event: "Progress", data: { chunkLength: 1 } });
    });
    expect(result.current.downloadProgress).toBe(0.01);

    act(() => {
      onEvent({ event: "Finished" });
    });
    expect(result.current.downloadProgress).toBe(1);

    relaunchMock.mockResolvedValue();
    await act(async () => {
      resolveInstall();
    });
  });

  it("keeps download progress unknown when the updater omits a total size", () => {
    let onEvent;
    const update = {
      downloadAndInstall: vi.fn((callback) => {
        onEvent = callback;
        return new Promise(() => {});
      }),
    };
    const { result } = renderHook(() => useApplyUpdate());

    act(() => {
      void result.current.install(update);
    });
    act(() => {
      onEvent({ event: "Started", data: {} });
      onEvent({ event: "Progress", data: { chunkLength: 400 } });
      onEvent({ event: "Finished" });
    });

    expect(result.current.installStatus).toBe("installing");
    expect(result.current.downloadProgress).toBeNull();
  });

  it("clears download progress when installation fails", async () => {
    const update = {
      downloadAndInstall: vi.fn(async (onEvent) => {
        onEvent({ event: "Started", data: { contentLength: 100 } });
        onEvent({ event: "Progress", data: { chunkLength: 40 } });
        throw new Error("download failed");
      }),
    };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => {
      await result.current.install(update);
    });

    expect(result.current.installStatus).toBe("install-error");
    expect(result.current.downloadProgress).toBeNull();
  });

  it("ignores a concurrent install request before React state updates", async () => {
    let resolveInstall;
    const pendingInstall = new Promise((resolve) => {
      resolveInstall = resolve;
    });
    const update = { downloadAndInstall: vi.fn().mockReturnValue(pendingInstall) };
    relaunchMock.mockResolvedValue();
    const { result } = renderHook(() => useApplyUpdate());

    let firstInstall;
    let secondInstall;
    act(() => {
      firstInstall = result.current.install(update);
      secondInstall = result.current.install(update);
    });

    expect(update.downloadAndInstall).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveInstall();
      await Promise.all([firstInstall, secondInstall]);
    });
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
