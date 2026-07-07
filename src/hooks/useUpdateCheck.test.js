/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("../lib/updateCheck.js", () => ({
  checkForUpdate: vi.fn(),
}));

import { checkForUpdate } from "../lib/updateCheck.js";
import { UPDATE_CHECK_INTERVAL_MS, useUpdateCheck } from "./useUpdateCheck.js";

describe("useUpdateCheck", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("checks for updates on mount", async () => {
    checkForUpdate.mockResolvedValue({
      latestVersion: "0.2.4",
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: true,
      update: { version: "0.2.4" },
    });

    const { result } = renderHook(() => useUpdateCheck());

    expect(result.current.isCheckingForUpdate).toBe(true);
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));
    expect(checkForUpdate).toHaveBeenCalledWith();
    expect(result.current.updateInfo.hasUpdate).toBe(true);
    expect(result.current.updateInfo.update).toEqual({ version: "0.2.4" });
  });

  it("exposes a manual refresh that returns to checking while the request is pending", async () => {
    checkForUpdate.mockResolvedValueOnce({
      latestVersion: null,
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: false,
      update: null,
    });

    const { result } = renderHook(() => useUpdateCheck(0));
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));

    let resolveRefresh;
    checkForUpdate.mockImplementationOnce(
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
    checkForUpdate.mockResolvedValue({
      latestVersion: null,
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/latest",
      hasUpdate: false,
      update: null,
    });

    renderHook(() => useUpdateCheck());
    await act(async () => {});
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });
});
