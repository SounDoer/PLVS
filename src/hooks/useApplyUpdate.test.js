/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

const relaunchMock = vi.fn();
const coordination = vi.hoisted(() => ({
  prepare: vi.fn(),
  commit: vi.fn(),
  abort: vi.fn(),
}));
vi.mock("@tauri-apps/plugin-process", () => ({
  relaunch: (...args) => relaunchMock(...args),
}));
vi.mock("../runtime/coordination.js", () => ({
  prepareGlobalOperation: (...args) => coordination.prepare(...args),
  commitGlobalOperation: (...args) => coordination.commit(...args),
  abortGlobalOperation: (...args) => coordination.abort(...args),
}));

import { useApplyUpdate } from "./useApplyUpdate.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";

describe("useApplyUpdate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    coordination.prepare.mockResolvedValue({ id: "operation", issued: [] });
    coordination.commit.mockResolvedValue();
    coordination.abort.mockResolvedValue();
    delete window.__PLVS_INITIAL_STATE__;
    setCoordinatorRole(undefined);
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
    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalledTimes(1));

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

    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(onEvent).toEqual(expect.any(Function)));

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

  it("keeps download progress unknown when the updater omits a total size", async () => {
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
    await waitFor(() => expect(onEvent).toEqual(expect.any(Function)));
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

  it("downloads before closing peer workbenches and installs only after they close", async () => {
    const calls = [];
    coordination.prepare.mockImplementation(async () => {
      calls.push("prepare");
      return { id: "operation", issued: [] };
    });
    coordination.commit.mockImplementation(async () => calls.push("commit"));
    const update = {
      download: vi.fn(async () => calls.push("download")),
      install: vi.fn(async () => calls.push("install")),
    };
    relaunchMock.mockImplementation(async () => calls.push("relaunch"));
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => result.current.install(update));

    expect(calls).toEqual(["prepare", "download", "commit", "install", "relaunch"]);
  });

  it("relaunches to restore peer workbenches when a split install fails after they close", async () => {
    const update = {
      download: vi.fn().mockResolvedValue(),
      install: vi.fn().mockRejectedValue(new Error("installer failed")),
    };
    relaunchMock.mockResolvedValue();
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => result.current.install(update));

    expect(coordination.commit).toHaveBeenCalledTimes(1);
    expect(update.install).toHaveBeenCalledTimes(1);
    expect(relaunchMock).toHaveBeenCalledTimes(1);
    expect(result.current.installStatus).toBe("restarting");
  });

  it("aborts the prepared operation when peer shutdown cannot commit", async () => {
    coordination.commit.mockRejectedValueOnce(new Error("peer flush failed"));
    const update = {
      download: vi.fn().mockResolvedValue(),
      install: vi.fn(),
    };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => result.current.install(update));

    expect(update.install).not.toHaveBeenCalled();
    expect(coordination.abort).toHaveBeenCalledWith({ id: "operation", issued: [] });
    expect(result.current.installStatus).toBe("restart-error");
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

    await waitFor(() => expect(update.downloadAndInstall).toHaveBeenCalledTimes(1));

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
    expect(coordination.abort).toHaveBeenCalledTimes(1);
  });

  it("does not download when another workbench refuses the prepare barrier", async () => {
    coordination.prepare.mockRejectedValueOnce(new Error("Theme editor is open"));
    const update = { downloadAndInstall: vi.fn() };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => result.current.install(update));

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(result.current.installStatus).toBe("install-error");
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

  it("does not install or relaunch from a participant instance", async () => {
    window.__PLVS_INITIAL_STATE__ = { isCoordinator: false };
    const update = { downloadAndInstall: vi.fn() };
    const { result } = renderHook(() => useApplyUpdate());

    await act(async () => result.current.install(update));

    expect(update.downloadAndInstall).not.toHaveBeenCalled();
    expect(relaunchMock).not.toHaveBeenCalled();
    expect(result.current.installStatus).toBe("idle");
  });
});
