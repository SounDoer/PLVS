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
    const raiseNotice = vi.fn();
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: { state: "empty" },
        appVersion: "0.7.3",
        raiseNotice,
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport();
    });

    expect(raiseNotice).toHaveBeenCalledWith("guard", "Choose a completed file analysis to export");
    expect(mocks.saveFileAnalysisReportFile).not.toHaveBeenCalled();
  });

  it("asks the user to choose a completed analysis before copying", async () => {
    const writeText = vi.fn(async () => {});
    installClipboard(writeText);
    const raiseNotice = vi.fn();
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: { state: "empty" },
        appVersion: "0.7.3",
        raiseNotice,
      })
    );

    let copied;
    await act(async () => {
      copied = await result.current.copyFileAnalysisReportMarkdown();
    });

    expect(copied).toBe(false);
    expect(raiseNotice).toHaveBeenCalledWith("guard", "Choose a completed file analysis to copy");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("writes a desktop report for completed file analysis", async () => {
    const raiseNotice = vi.fn();
    mocks.saveFileAnalysisReportFile.mockResolvedValue("C:\\report.json");
    mocks.writeTextFile.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice,
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport();
    });

    expect(mocks.saveFileAnalysisReportFile).toHaveBeenCalledWith(
      "final_mix-plvs-report.json",
      "json"
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      "C:\\report.json",
      expect.stringContaining('"reportType": "fileAnalysis"')
    );
    expect(raiseNotice).not.toHaveBeenCalled();
  });

  it("raises a notice when report export fails", async () => {
    const raiseNotice = vi.fn();
    mocks.saveFileAnalysisReportFile.mockResolvedValue("C:\\report.json");
    mocks.writeTextFile.mockRejectedValue(new Error("disk full"));
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice,
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport();
    });

    expect(raiseNotice).toHaveBeenCalledWith("error", "Report export failed");
  });

  function installClipboard(writeText) {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }

  it("writes a Markdown report with the Markdown filter and name", async () => {
    mocks.saveFileAnalysisReportFile.mockResolvedValue("C:\\report.md");
    mocks.writeTextFile.mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport("markdown");
    });

    expect(mocks.saveFileAnalysisReportFile).toHaveBeenCalledWith(
      "final_mix-plvs-report.md",
      "markdown"
    );
    expect(mocks.writeTextFile).toHaveBeenCalledWith(
      "C:\\report.md",
      expect.stringMatching(/^# PLVS Loudness Report\n/)
    );
  });

  it("writes nothing when the save dialog is cancelled", async () => {
    mocks.saveFileAnalysisReportFile.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice: vi.fn(),
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport("markdown");
    });

    expect(mocks.writeTextFile).not.toHaveBeenCalled();
  });

  it("records the Loudness Profile in force", async () => {
    mocks.saveFileAnalysisReportFile.mockResolvedValue("C:\\report.json");
    mocks.writeTextFile.mockResolvedValue(undefined);
    const document = {
      id: "p1",
      name: "Broadcast",
      rules: [{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }],
    };
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice: vi.fn(),
        loudnessProfile: { active: "profile:p1", document, draft: null },
      })
    );

    await act(async () => {
      await result.current.exportFileAnalysisReport("json");
    });

    const written = JSON.parse(mocks.writeTextFile.mock.calls[0][1]);
    expect(written.loudnessProfile).toMatchObject({
      mode: "saved",
      id: "p1",
      name: "Broadcast",
      byMetric: { integrated: "ok" },
    });
  });

  it("copies the Markdown report and reports success", async () => {
    const writeText = vi.fn(async () => {});
    installClipboard(writeText);
    const raiseNotice = vi.fn();
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice,
      })
    );

    let copied;
    await act(async () => {
      copied = await result.current.copyFileAnalysisReportMarkdown();
    });

    expect(copied).toBe(true);
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/^# PLVS Loudness Report\n/));
    expect(raiseNotice).not.toHaveBeenCalled();
  });

  it("raises a notice when the copy fails", async () => {
    installClipboard(vi.fn(async () => Promise.reject(new Error("denied"))));
    const raiseNotice = vi.fn();
    const { result } = renderHook(() =>
      useFileAnalysisReportExport({
        fileSession: COMPLETE_SESSION,
        appVersion: "0.7.3",
        raiseNotice,
      })
    );

    let copied;
    await act(async () => {
      copied = await result.current.copyFileAnalysisReportMarkdown();
    });

    expect(copied).toBe(false);
    expect(raiseNotice).toHaveBeenCalledWith("error", "Copy failed");
  });
});
