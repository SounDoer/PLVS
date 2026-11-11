import { describe, expect, it } from "vitest";
import { buildFileAnalysisStatisticsCsv } from "./fileAnalysisStatisticsCsv.js";

const REPORT = (channels, id = String(channels), extra = {}) => ({
  id,
  fileName: "mix.wav",
  path: "C:/private/mix.wav",
  state: "complete",
  decodedFrames: 48000,
  analyzedAt: 1794000000000,
  metadata: {
    selectedTrack: { index: channels, codec: "pcm_s16le" },
    sourceVersion: { canonicalPath: "C:/private/mix.wav", sha256: id, byteLength: 1000 },
  },
  analysisSettings: { dialogue: { enabled: false } },
  summary: {
    channels,
    durationMs: 1000,
    sampleRateHz: 48000,
    integratedLufs: -23.01234,
    lra: 0,
    truePeakMaxDbtp: -0.1,
    samplePeakMaxDb: -0.2,
    loudnessLayoutKnown: false,
    channelPeaks: [
      {
        channelIndex: channels - 1,
        truePeakMaxDbtp: -0.1,
        samplePeakMaxDb: -0.2,
        truePeakMaxLocation: { framePosition: -0.125, timeSeconds: -0.125 / 48000 },
      },
    ],
  },
  ...extra,
});

function records(csv) {
  const rows = [[]];
  const text = csv.slice(1).replace(/\r\n$/, "");
  for (const [, separator, field] of text.matchAll(
    /(^|,|\r\n)("(?:[^"]|"")*"|[^,\r\n]*)(?=,|\r\n|$)/g
  )) {
    if (separator === "\r\n") rows.push([]);
    rows.at(-1).push(field.startsWith('"') ? field.slice(1, -1).replace(/""/g, '"') : field);
  }
  const [headers, ...data] = rows;
  for (const row of data) expect(row.length).toBe(headers.length);
  return data.map((row) => Object.fromEntries(headers.map((key, index) => [key, row[index]])));
}

describe("File statistics CSV", () => {
  it("keeps mixed channel counts aligned and separates missing data from missing channels", () => {
    const csv = buildFileAnalysisStatisticsCsv([REPORT(1), REPORT(2), REPORT(6), REPORT(8)]);
    const [mono, stereo, surround, wide] = records(csv);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).not.toContain("private");
    expect(mono).toMatchObject({
      channel_count: "1",
      integrated_lufs: "-23.01234",
      lra_lu: "0",
      dialogue_loudness_lufs: "",
      dialogue_loudness_lufs_reason: "notEnabled",
      ch1_true_peak_max_dbtp: "-0.1",
      ch1_true_peak_max_time_s: String(-0.125 / 48000),
      ch2_label: "",
      ch2_true_peak_max_reason: "",
    });
    expect(stereo).toMatchObject({
      ch1_label: "Ch 1",
      ch1_true_peak_max_reason: "unavailable",
      ch2_label: "Ch 2",
    });
    expect(surround.ch6_sample_peak_max_dbfs).toBe("-0.2");
    expect(wide.ch8_sample_peak_max_dbfs).toBe("-0.2");
    expect(wide.ch9_label).toBeUndefined();
  });

  it("keeps a row self-contained with every rule, severity, unit and metric verdict", () => {
    const rules = [
      { metricId: "integrated", op: ">", value: -23.02, severity: "fail" },
      { metricId: "integrated", op: "<", value: -24, severity: "warn" },
      { metricId: "psr", op: "<", value: 8, severity: "warn" },
    ];
    const csv = buildFileAnalysisStatisticsCsv([REPORT(2, "a"), REPORT(2, "b")], {
      exportedAt: "2026-11-11T00:00:00Z",
      loudnessProfile: { mode: "preview", name: "Broadcast", document: { rules } },
    });
    for (const row of records(csv)) {
      expect(row).toMatchObject({
        profile_mode: "preview",
        profile_name: "Broadcast",
        profile_overall: "fail",
        profile_fail_count: "1",
        profile_not_evaluated_count: "1",
        profile_lra_lu_verdict: "notApplicable",
        exported_at_utc: "2026-11-11T00:00:00Z",
      });
      expect(JSON.parse(row.profile_rules_json)).toEqual(
        rules.map((rule, index) => ({ ...rule, unit: index < 2 ? "LUFS" : "dB" }))
      );
      expect(JSON.parse(row.profile_metric_verdicts_json)).toEqual({
        integrated: { verdict: "fail", reason: null },
        psr: { verdict: "notEvaluated", reason: "unsupportedWholeFileMetric" },
      });
    }
  });

  it("exports only successful results and protects spreadsheet cells without altering numbers", () => {
    const success = REPORT(2, "held", { fileName: '=HYPERLINK("bad")\n混音.wav' });
    const [row] = records(
      buildFileAnalysisStatisticsCsv([
        { id: "pending", state: "analyzing", summary: null },
        { ...success, state: "analyzing", summary: null, successfulResult: success },
      ])
    );
    expect(row.file_name).toBe("'" + success.fileName);
    expect(row.source_sha256).toBe("held");
    expect(row.integrated_lufs).toBe("-23.01234");
    expect(row.profile_overall).toBe("notEvaluated");
    expect(() => buildFileAnalysisStatisticsCsv([{ state: "error" }])).toThrow(
      /completed file analysis/
    );
  });
});
