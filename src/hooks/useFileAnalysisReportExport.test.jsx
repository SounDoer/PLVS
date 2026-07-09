/** @vitest-environment jsdom */
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useFileAnalysisReportExport } from "./useFileAnalysisReportExport.js";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  saveFileAnalysisReportFile: vi.fn(),
  writeTextFile: vi.fn(),
}));

vi.mock("../ipc/env.js", () => ({ isTauri: mocks.isTauri }));
vi.mock("../ipc/fileDialog.js", () => ({
  saveFileAnalysisReportFile: mocks.saveFileAnalysisReportFile,
}));
vi.mock("../ipc/commands.js", () => ({
  writeTextFile: mocks.writeTextFile,
}));

const COMPLETE_SESSION = {
  state: "complete",
  path: "C:\\mixes\\final_mix.wav",
  fileName: "final_mix.wav",
  metadata: {
    container: "wav",
    durationMs: 10_000,
    selectedTrack: {
      index: 0,
      codec: "pcm_s16le",
      sampleRateHz: 48_000,
      channels: 2,
      language: "eng",
    },
  },
  summary: {
    durationMs: 10_000,
    sampleRateHz: 48_000,
    channels: 2,
    integratedLufs: -23.1,
    lra: 4.2,
    mMaxLufs: -18.5,
    stMaxLufs: -20.2,
    truePeakMaxDbtp: -1.0,
  },
  analyzedAt: Date.UTC(2026, 6, 6, 12, 0, 0),
  decodedFrames: 480_000,
};

describe("useFileAnalysisReportExport", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.isTauri.mockReturnValue(true);
  });

  it("asks the user to choose a completed analysis before exporting", async () => {
    const setStatus = vi.fn();
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: { state: "empty" },
        appVersion: "0.7.3",
        setStatus,
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport();
    });

    expect(setStatus).toHaveBeenCalledWith("Choose a completed file analysis to export");
    expect(mocks.saveFileAnalysisReportFile).not.toHaveBeenCalled();
  });

  it("writes a desktop report for completed file analysis", async () => {
    const setStatus = vi.fn();
    mocks.saveFileAnalysisReportFile.mockResolvedValue("C:\\report.json");
    mocks.writeTextFile.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        setStatus,
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport();
    });

    expect(mocks.saveFileAnalysisReportFile).toHaveBeenCalledWith("final_mix-plvs-report.json");
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      "C:\\report.json",
      expect.stringContaining('"reportType": "fileAnalysis"')
    );
    expect(setStatus).toHaveBeenCalledWith("File analysis report exported");
  });
});
