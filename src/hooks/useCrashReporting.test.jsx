/** @vitest-environment jsdom */

import { act, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logFrontendError, readPendingCrashReport } = vi.hoisted(() => ({
  logFrontendError: vi.fn(),
  readPendingCrashReport: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ logFrontendError, readPendingCrashReport }));

import { useCrashReporting } from "./useCrashReporting.js";

function Harness({ promptEnabled = true }) {
  const { pendingReport, dismissPending } = useCrashReporting({ promptEnabled });
  return pendingReport ? (
    <button type="button" onClick={dismissPending}>
      {pendingReport.id}
    </button>
  ) : null;
}

beforeEach(() => {
  logFrontendError.mockReset();
  logFrontendError.mockResolvedValue(undefined);
  readPendingCrashReport.mockReset();
  readPendingCrashReport.mockResolvedValue(null);
});

describe("useCrashReporting ordinary error logging", () => {
  it("establishes and resets only its exact development fixture without discarding it", async () => {
    const report = { id: "development-crash-report" };
    const { result } = renderHook(() => useCrashReporting({ promptEnabled: false }));
    expect(readPendingCrashReport).not.toHaveBeenCalled();

    act(() => result.current.developmentFixture.establish("fixture-aaaaaaaaaaaaaaaa", report));
    expect(result.current.pendingReport).toEqual(report);
    expect(result.current.developmentFixture.matches("fixture-aaaaaaaaaaaaaaaa")).toBe(true);

    act(() => result.current.developmentFixture.reset("fixture-bbbbbbbbbbbbbbbb"));
    expect(result.current.pendingReport).toEqual(report);
    act(() => result.current.developmentFixture.reset("fixture-aaaaaaaaaaaaaaaa"));
    expect(result.current.pendingReport).toBeNull();
  });

  it("logs window errors without creating a crash report", async () => {
    const view = render(<Harness />);
    window.dispatchEvent(
      new ErrorEvent("error", {
        message: "ordinary failure",
        error: Object.assign(new Error("ordinary failure"), { name: "TypeError" }),
      })
    );

    await waitFor(() => expect(logFrontendError).toHaveBeenCalledTimes(1));
    expect(logFrontendError.mock.calls[0][0]).toContain("window.error");
    expect(logFrontendError.mock.calls[0][0]).toContain("TypeError: ordinary failure");

    view.unmount();
    window.dispatchEvent(new ErrorEvent("error", { message: "after cleanup" }));
    expect(logFrontendError).toHaveBeenCalledTimes(1);
  });

  it("normalizes non-Error promise rejection values without throwing", async () => {
    render(<Harness />);
    const event = new Event("unhandledrejection");
    Object.defineProperty(event, "reason", {
      value: { code: 17, detail: "rejected" },
    });

    expect(() => window.dispatchEvent(event)).not.toThrow();
    await waitFor(() => expect(logFrontendError).toHaveBeenCalledTimes(1));
    expect(logFrontendError.mock.calls[0][0]).toContain("unhandledrejection");
    expect(logFrontendError.mock.calls[0][0]).toContain('"code":17');
  });

  it("does not turn a logging failure into another uncaught error", async () => {
    logFrontendError.mockRejectedValueOnce(new Error("native logger unavailable"));
    render(<Harness />);

    expect(() =>
      window.dispatchEvent(new ErrorEvent("error", { message: "ordinary failure" }))
    ).not.toThrow();
    await waitFor(() => expect(logFrontendError).toHaveBeenCalledTimes(1));
  });

  it("loads at most the newest pending report when asking is enabled", async () => {
    readPendingCrashReport.mockResolvedValueOnce({ id: "report-1" });
    render(<Harness />);

    const pending = await screen.findByRole("button", { name: "report-1" });
    expect(readPendingCrashReport).toHaveBeenCalledTimes(1);
    fireEvent.click(pending);
    expect(screen.queryByRole("button", { name: "report-1" })).toBeNull();
  });

  it("does not load a pending prompt when asking is disabled", () => {
    render(<Harness promptEnabled={false} />);
    expect(readPendingCrashReport).not.toHaveBeenCalled();
  });
});
