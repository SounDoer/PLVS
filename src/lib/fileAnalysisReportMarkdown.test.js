import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFileAnalysisReport } from "./fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "./fileAnalysisReportMarkdown.js";

const ORIGINAL_TZ = globalThis.process.env.TZ;

const SESSION = {
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
  analysisSettings: { dialogue: { enabled: true, engine: "firered" } },
};

function profile(rules, mode = "saved") {
  return { mode, id: "p1", name: "Broadcast", document: { id: "p1", name: "Broadcast", rules } };
}

const BROADCAST_RULES = [
  { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
  { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
  { metricId: "truePeak", op: ">", value: -2, severity: "fail" },
  { metricId: "psr", op: "<", value: 8, severity: "warn" },
];

function render(session = SESSION, loudnessProfile = profile(BROADCAST_RULES)) {
  return renderFileAnalysisReportMarkdown(
    buildFileAnalysisReport(session, {
      appVersion: "0.6.4",
      exportedAt: "2026-07-06T12:30:00.000Z",
      loudnessProfile,
    })
  );
}

const cells = (line) =>
  line
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());

describe("renderFileAnalysisReportMarkdown", () => {
  beforeAll(() => {
    globalThis.process.env.TZ = "Asia/Shanghai";
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete globalThis.process.env.TZ;
    else globalThis.process.env.TZ = ORIGINAL_TZ;
  });

  it("renders the header, file details, and whole-file measurements", () => {
    const lines = render().split("\n");

    expect(lines.slice(0, 5)).toEqual([
      "# PLVS Loudness Report",
      "",
      "**final_mix.wav**",
      "",
      "Exported 2026-07-06 20:30 (UTC+08:00) · PLVS 0.6.4",
    ]);
    for (const line of [
      "- Path: `C:\\mixes\\final_mix.wav`",
      "- Container: WAV",
      "- Duration: 00:00:10",
      "- Track: Audio track 0 - English - PCM s16le - 48 kHz - Stereo",
      "- Integrated: -23.1 LUFS",
      "- Loudness Range: 4.2 LU",
      "- Momentary Max: -18.5 LUFS",
      "- Short-term Max: -20.2 LUFS",
      "- True Peak Max: -1.0 dBTP",
      "- Sample Peak Max: -2.1 dBFS (L -2.4 · R -2.1)",
      "- Engine: firered",
      "- Dialogue Integrated: -24.0 LUFS",
      "- Dialogue Range: 2.5 LU",
    ]) {
      expect(lines).toContain(line);
    }
  });

  it("orders the sections and ends with a newline", () => {
    const markdown = render();
    const order = ["## File", "## Loudness", "## Dialogue", "## Loudness Profile: Broadcast"].map(
      (heading) => markdown.indexOf(`\n${heading}\n`)
    );

    expect(order.every((index) => index > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(markdown.endsWith("\n")).toBe(true);
    expect(markdown.endsWith("\n\n")).toBe(false);
  });

  it("renders one padded table row per judged metric", () => {
    const table = render()
      .split("\n")
      .filter((line) => line.startsWith("|"));

    expect(cells(table[0])).toEqual(["Metric", "Rule", "Measured", "Result"]);
    expect(table[1]).toMatch(/^\| -+ \| -+ \| -+ \| -+ \|$/);
    expect(table.slice(2).map(cells)).toEqual([
      ["Integrated", "fail if > -22.5 or < -23.5 LUFS", "-23.1 LUFS", "OK"],
      ["True Peak Max", "fail if > -2.0 dBTP", "-1.0 dBTP", "Fail"],
      ["Short-term Dynamics", "warn if < 8.0 dB", "—", "Not evaluated"],
    ]);
    expect(new Set(table.map((line) => line.length)).size).toBe(1);
  });

  it("merges several severities on one metric into one row", () => {
    const table = render(
      SESSION,
      profile([
        { metricId: "integrated", op: ">", value: -22, severity: "warn" },
        { metricId: "integrated", op: ">", value: -21, severity: "fail" },
      ])
    )
      .split("\n")
      .filter((line) => line.startsWith("|"));

    expect(cells(table[2])[1]).toBe("warn if > -22.0; fail if > -21.0 LUFS");
  });

  it("marks a verdict judged against an unsaved draft", () => {
    expect(render(SESSION, profile(BROADCAST_RULES, "preview"))).toContain(
      "\nUnsaved draft — rules may change before they are saved.\n"
    );
  });

  it("says so when the profile has no rules", () => {
    expect(render(SESSION, profile([]))).toContain("\nNo rules are set.\n");
  });

  it("omits the profile when off and dialogue when disabled", () => {
    const markdown = render(
      { ...SESSION, analysisSettings: { dialogue: { enabled: false } } },
      null
    );

    expect(markdown).not.toContain("## Loudness Profile");
    expect(markdown).not.toContain("## Dialogue");
  });

  it("renders missing values as a dash", () => {
    const lines = render({
      ...SESSION,
      path: undefined,
      summary: { ...SESSION.summary, mMaxLufs: -Infinity },
    }).split("\n");

    expect(lines).toContain("- Path: —");
    expect(lines).toContain("- Momentary Max: —");
  });
});
