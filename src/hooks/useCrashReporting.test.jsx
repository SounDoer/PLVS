/** @vitest-environment jsdom */

import { render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { logFrontendError } = vi.hoisted(() => ({ logFrontendError: vi.fn() }));

vi.mock("../ipc/env.js", () => ({ isTauri: () => true }));
vi.mock("../ipc/commands.js", () => ({ logFrontendError }));

import { useCrashReporting } from "./useCrashReporting.js";

function Harness() {
  useCrashReporting();
  return null;
}

beforeEach(() => {
  logFrontendError.mockReset();
  logFrontendError.mockResolvedValue(undefined);
});

describe("useCrashReporting ordinary error logging", () => {
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
});
