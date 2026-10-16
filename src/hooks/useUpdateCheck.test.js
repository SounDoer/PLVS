/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../lib/updateCheck.js", () => ({
  checkForUpdate: vi.fn(),
}));

import { checkForUpdate } from "../lib/updateCheck.js";
import { UPDATE_CHECK_INTERVAL_MS, useUpdateCheck } from "./useUpdateCheck.js";
import { setCoordinatorRole } from "../lib/runtimeRole.js";

describe("useUpdateCheck", () => {
  it("makes no automatic request before opt-in but permits an explicit check", async () => {
    vi.mocked(checkForUpdate).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateCheck());
    expect(checkForUpdate).not.toHaveBeenCalled();
    await act(() => result.current.refreshUpdateCheck());
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("ignores a late automatic response after checking is disabled", async () => {
    let finish;
    const close = vi.fn();
    vi.mocked(checkForUpdate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const { result, rerender } = renderHook(({ enabled }) => useUpdateCheck(0, enabled), {
      initialProps: { enabled: true },
    });
    rerender({ enabled: false });
    await act(async () => finish({ hasUpdate: true, update: { close } }));
    expect(result.current.updateInfo.status).toBe("idle");
    expect(result.current.updateInfo.hasUpdate).not.toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  beforeEach(() => {
    vi.clearAllMocks();
    delete window.__PLVS_INITIAL_STATE__;
    setCoordinatorRole(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks for updates on mount", async () => {
    vi.mocked(checkForUpdate).mockResolvedValue({
      latestVersion: "0.2.4",
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: true,
      update: { version: "0.2.4" },
    });

    const { result } = renderHook(() => useUpdateCheck(undefined, true));

    expect(result.current.isCheckingForUpdate).toBe(true);
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));
    expect(checkForUpdate).toHaveBeenCalledWith();
    expect(result.current.updateInfo.hasUpdate).toBe(true);
    expect(result.current.updateInfo.update).toEqual({ version: "0.2.4" });
  });

  it("exposes a manual refresh that returns to checking while the request is pending", async () => {
    vi.mocked(checkForUpdate).mockResolvedValueOnce({
      latestVersion: null,
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: false,
      update: null,
    });

    const { result } = renderHook(() => useUpdateCheck(0, true));
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));

    let resolveRefresh;
    vi.mocked(checkForUpdate).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRefresh = resolve;
        })
    );

    act(() => {
      result.current.refreshUpdateCheck();
    });

    expect(result.current.isCheckingForUpdate).toBe(true);

    await act(async () => {
      resolveRefresh({
        latestVersion: "0.2.4",
        releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
        hasUpdate: true,
        update: { version: "0.2.4" },
      });
    });

    await waitFor(() => expect(result.current.updateInfo.latestVersion).toBe("0.2.4"));
  });

  it("checks again on the 12 hour interval", async () => {
    vi.useFakeTimers();
    vi.mocked(checkForUpdate).mockResolvedValue({
      latestVersion: null,
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: false,
      update: null,
    });

    renderHook(() => useUpdateCheck(undefined, true));
    await act(async () => {});
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });

  it("does not check from a participant and starts checking after promotion", async () => {
    window.__PLVS_INITIAL_STATE__ = { isCoordinator: false };
    vi.mocked(checkForUpdate).mockResolvedValue(null);
    const { result } = renderHook(() => useUpdateCheck(0, true));
    expect(result.current.updateInfo.status).toBe("idle");
    expect(checkForUpdate).not.toHaveBeenCalled();

    act(() => setCoordinatorRole(true));

    await waitFor(() => expect(checkForUpdate).toHaveBeenCalledTimes(1));
  });
});
