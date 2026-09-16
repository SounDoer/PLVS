import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCrashReportRequest, submitCrashReport } from "./crashReporting.js";

const report = {
  schemaVersion: 1,
  id: "20260916T120000Z-01234567",
  kind: "rust_panic",
};

afterEach(() => vi.useRealTimers());

describe("crash report request", () => {
  it("builds the same payload used by preview and submission", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const request = buildCrashReportRequest({
      report,
      note: "Steps to reproduce",
      email: "user@example.com",
    });

    await submitCrashReport({
      report,
      note: "Steps to reproduce",
      email: "user@example.com",
      fetchImpl,
    });

    expect(request).toEqual({
      report,
      note: "Steps to reproduce",
      email: "user@example.com",
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://list.plvs.soundoer.com/crash-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
      signal: expect.any(AbortSignal),
    });
  });

  it("omits blank optional metadata", () => {
    expect(buildCrashReportRequest({ report, note: "  ", email: "" })).toEqual({ report });
  });

  it("rejects non-2xx and network failures", async () => {
    await expect(
      submitCrashReport({
        report,
        fetchImpl: vi.fn().mockResolvedValue({ ok: false, status: 503 }),
      })
    ).rejects.toThrow("503");
    await expect(
      submitCrashReport({ report, fetchImpl: vi.fn().mockRejectedValue(new Error("offline")) })
    ).rejects.toThrow("offline");
  });

  it("aborts after fifteen seconds", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url, { signal }) => {
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    });

    const pending = submitCrashReport({ report, fetchImpl });
    const rejected = expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    await vi.advanceTimersByTimeAsync(15_000);

    await rejected;
  });
});
