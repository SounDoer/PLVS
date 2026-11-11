/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { useFileStatisticsExport } from "./useFileStatisticsExport.js";
import { saveFileAnalysisReportFile } from "../ipc/fileDialog.js";
import { writeTextFile } from "../ipc/commands.js";

vi.mock("../ipc/fileDialog.js", () => ({ saveFileAnalysisReportFile: vi.fn() }));
vi.mock("../ipc/commands.js", () => ({ writeTextFile: vi.fn() }));
const entry = {
  id: "one",
  state: "complete",
  fileName: "mix.wav",
  summary: { channels: 2, integratedLufs: -23 },
};
const reportOptions = { loudnessProfile: {}, appVersion: "0.0.0", raiseNotice: vi.fn() };

beforeEach(() => vi.resetAllMocks());

it("captures the selected success before waiting for the native save dialog", async () => {
  let resolve;
  vi.mocked(saveFileAnalysisReportFile).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  const { result, rerender } = renderHook(
    ({ fileSessions }) => useFileStatisticsExport({ ...reportOptions, fileSessions }),
    {
      initialProps: { fileSessions: [entry] },
    }
  );
  act(() => result.current.onOpen());
  let pending;
  act(() => {
    pending = result.current.onExport(["one"]);
  });
  rerender({ fileSessions: [{ ...entry, summary: { channels: 2, integratedLufs: -19 } }] });
  await act(async () => {
    resolve("C:/exports/test.csv");
    await pending;
  });
  expect(writeTextFile).toHaveBeenCalledOnce();
  expect(vi.mocked(writeTextFile).mock.calls[0][1]).toContain(",-23,");
  expect(result.current.open).toBe(false);
});

it("writes nothing on cancellation and allows retry after a write error", async () => {
  const { result } = renderHook(() =>
    useFileStatisticsExport({ ...reportOptions, fileSessions: [entry] })
  );
  act(() => result.current.onOpen());
  vi.mocked(saveFileAnalysisReportFile).mockResolvedValueOnce(null);
  await act(async () => {
    await result.current.onExport(["one"]);
  });
  expect(writeTextFile).not.toHaveBeenCalled();
  expect(result.current.open).toBe(true);
  vi.mocked(saveFileAnalysisReportFile).mockResolvedValueOnce("C:/exports/test.csv");
  vi.mocked(writeTextFile).mockRejectedValueOnce(new Error("denied"));
  await act(async () => {
    await result.current.onExport(["one"]);
  });
  expect(reportOptions.raiseNotice).toHaveBeenCalledWith(
    "error",
    "Statistics export failed",
    undefined,
    { requiresAttention: true }
  );
  expect(result.current.busy).toBe(false);
  expect(result.current.open).toBe(true);
});
