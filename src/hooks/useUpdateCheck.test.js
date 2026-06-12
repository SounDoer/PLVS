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
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/tag/v0.2.4",
      hasUpdate: true,
    });

    const { result } = renderHook(() => useUpdateCheck("0.2.3"));

    expect(result.current.isCheckingForUpdate).toBe(true);
    await waitFor(() => expect(result.current.updateInfo.status).toBe("ok"));
    expect(checkForUpdate).toHaveBeenCalledWith("0.2.3");
    expect(result.current.updateInfo.hasUpdate).toBe(true);
  });

  it("exposes a manual refresh that returns to checking while the request is pending", async () => {
    checkForUpdate.mockResolvedValueOnce({
      latestVersion: "0.2.3",
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/tag/v0.2.3",
      hasUpdate: false,
    });

    const { result } = renderHook(() => useUpdateCheck("0.2.3", 0));
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
        releaseUrl: "https://github.com/SounDoer/PLVS/releases/tag/v0.2.4",
        hasUpdate: true,
      });
    });

    await waitFor(() => expect(result.current.updateInfo.latestVersion).toBe("0.2.4"));
  });

  it("checks again on the 12 hour interval", async () => {
    vi.useFakeTimers();
    checkForUpdate.mockResolvedValue({
      latestVersion: "0.2.3",
      releaseUrl: "https://github.com/SounDoer/PLVS/releases/tag/v0.2.3",
      hasUpdate: false,
    });

    renderHook(() => useUpdateCheck("0.2.3"));
    await act(async () => {});
    expect(checkForUpdate).toHaveBeenCalledTimes(1);

    await act(async () => {
      vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    });

    expect(checkForUpdate).toHaveBeenCalledTimes(2);
  });
});
