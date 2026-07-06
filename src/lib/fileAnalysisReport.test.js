import { describe, expect, it } from "vitest";
import {
  buildFileAnalysisReport,
  defaultFileAnalysisReportName,
  stringifyFileAnalysisReport,
} from "./fileAnalysisReport.js";

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
    samplePeakMaxLDb: -2.4,
    samplePeakMaxRDb: -2.1,
    dialogueIntegrated: -24.0,
    dialogueLra: 2.5,
  },
  analyzedAt: Date.UTC(2026, 6, 6, 12, 0, 0),
  decodedFrames: 480_000,
  historyTruncated: true,
  historyCoveredMs: 8_000,
  analysisSettings: {
    dialogue: { enabled: true, engine: "firered" },
  },
};

describe("fileAnalysisReport", () => {
  it("builds a stable JSON report from a completed file session", () => {
    const report = buildFileAnalysisReport(COMPLETE_SESSION, {
      appVersion: "0.6.4",
      exportedAt: "2026-07-06T12:30:00.000Z",
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      reportType: "fileAnalysis",
      exportedAt: "2026-07-06T12:30:00.000Z",
      app: { name: "PLVS", version: "0.6.4" },
      source: {
        path: "C:\\mixes\\final_mix.wav",
        fileName: "final_mix.wav",
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
      analysis: {
        analyzedAt: "2026-07-06T12:00:00.000Z",
        decodedFrames: 480_000,
        dialogue: { enabled: true, engine: "firered" },
      },
      summary: {
        durationMs: 10_000,
        sampleRateHz: 48_000,
        channelCount: 2,
        integratedLufs: -23.1,
        lra: 4.2,
        mMaxLufs: -18.5,
        stMaxLufs: -20.2,
        truePeakMaxDbtp: -1.0,
        samplePeakMaxLDb: -2.4,
        samplePeakMaxRDb: -2.1,
        samplePeakMaxDb: -2.1,
        dialogueIntegratedLufs: -24.0,
        dialogueLra: 2.5,
      },
      history: {
        retained: true,
        truncated: true,
        coveredMs: 8_000,
      },
    });
  });

  it("uses null for non-finite and disabled dialogue report values", () => {
    const report = buildFileAnalysisReport(
      {
        ...COMPLETE_SESSION,
        summary: {
          ...COMPLETE_SESSION.summary,
          mMaxLufs: -Infinity,
          stMaxLufs: Infinity,
          dialogueIntegrated: -Infinity,
          dialogueLra: 0,
        },
        analysisSettings: { dialogue: { enabled: false, engine: "ten" } },
      },
      { exportedAt: "2026-07-06T12:30:00.000Z" }
    );

    expect(report.summary.mMaxLufs).toBeNull();
    expect(report.summary.stMaxLufs).toBeNull();
    expect(report.summary.dialogueIntegratedLufs).toBeNull();
    expect(report.summary.dialogueLra).toBeNull();
    expect(report.analysis.dialogue).toEqual({ enabled: false, engine: null });
    expect(JSON.parse(stringifyFileAnalysisReport(report)).summary.mMaxLufs).toBeNull();
  });

  it("requires a completed session with a summary", () => {
    expect(() => buildFileAnalysisReport({ state: "analyzing" })).toThrow(
      "completed file analysis"
    );
  });

  it("builds a safe default report filename", () => {
    expect(defaultFileAnalysisReportName({ fileName: "final:mix?.wav" })).toBe(
      "final-mix--plvs-report.json"
    );
  });
});
