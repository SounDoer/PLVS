# File Report Markdown and Profile Verdicts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export a completed file analysis as readable Markdown (file, clipboard, CLI) and record per-metric Loudness Profile verdicts in the `fileAnalysis` JSON report.

**Architecture:** The JSON report stays the single source. `buildFileAnalysisReport` gains a `loudnessProfile` block judged by the existing `loudnessProfileEvaluate`; a pure `renderFileAnalysisReportMarkdown(report)` turns that JSON into Markdown, and the GUI export menu, the clipboard copy, and the Agent Control bridge all call it. The Rust CLI only forwards `--report-format` and writes the returned string verbatim.

**Tech Stack:** React 19 + Vitest (jsdom for hooks/components), Radix Popover, Rust `plvs-cli` (`cli_control.rs`), JSON command manifest.

**Spec:** [`../specs/2026-09-11-file-report-markdown-design.md`](../specs/2026-09-11-file-report-markdown-design.md)

**Repository rules that apply to every task**

- Work lands on `main`; do not branch. History stays linear.
- Commit messages are English, never start with `@`, and end with the trailer
  `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Use several `-m` flags, not a
  PowerShell here-string.
- Run `npm run check` (the full merge gate) before **every** commit and expect exit code 0.
- React/persistence tests need `/** @vitest-environment jsdom */`; jest-dom matchers are unavailable
  (use `toBeTruthy()` / `toBeNull()`).
- Never hand-edit `docs/agent-control/generated/`; regenerate with `npm run docs:agent-control`.

---

## File structure

| File                                                                                                           | Change | Responsibility                                                           |
| -------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------ |
| `src/lib/activeLoudnessProfile.js`                                                                             | Create | `{ active, document, draft }` → `{ mode, id, name, document }` or `null` |
| `src/lib/activeLoudnessProfile.test.js`                                                                        | Create | Saved / preview / off resolution                                         |
| `src/lib/fileAnalysisReport.js`                                                                                | Modify | `loudnessProfile` block, metric→field map, filename extension            |
| `src/lib/fileAnalysisReport.test.js`                                                                           | Modify | Verdict and filename tests                                               |
| `src/lib/fileAnalysisReportMarkdown.js`                                                                        | Create | Pure JSON report → Markdown renderer                                     |
| `src/lib/fileAnalysisReportMarkdown.test.js`                                                                   | Create | Renderer tests                                                           |
| `src/ipc/fileDialog.js`                                                                                        | Modify | Save dialog filter per report format                                     |
| `src/ipc/fileDialog.test.js`                                                                                   | Modify | Filter test                                                              |
| `src/hooks/useFileAnalysisReportExport.js`                                                                     | Modify | Export by format, copy Markdown, read profile                            |
| `src/hooks/useFileAnalysisReportExport.test.jsx`                                                               | Modify | Format, profile, copy tests                                              |
| `src/components/FileAnalysisSummary.jsx`                                                                       | Modify | Export button becomes a Popover menu with `Copied` feedback              |
| `src/components/FileAnalysisSummary.test.jsx`                                                                  | Modify | Menu tests                                                               |
| `src/App.jsx`                                                                                                  | Modify | Pass `loudnessProfile`, wire `onCopyReport`                              |
| `src/agentControl/protocol.js` (+ test)                                                                        | Modify | Optional `reportFormat` param                                            |
| `src/agentControl/useAgentControlBridge.js` (+ test)                                                           | Modify | Shared profile helper; profile + Markdown in `transport.file.report`     |
| `src-tauri/src/cli_control.rs`                                                                                 | Modify | `--report-format`, wire param, verbatim string export                    |
| `src/agentControl/commandManifest.json`                                                                        | Modify | Usage, option, wire param                                                |
| `docs/agent-control/transport.md`, `docs/cli.md`, file-report spec, `scripts/cliDocumentationContract.test.js` | Modify | Documentation and its contract                                           |
| `src-tauri/src/cli_report.rs`                                                                                  | Modify | Remove the dead Markdown renderer                                        |

---

### Task 1: Shared active-profile helper

**Files:**

- Create: `src/lib/activeLoudnessProfile.js`
- Create: `src/lib/activeLoudnessProfile.test.js`
- Modify: `src/agentControl/useAgentControlBridge.js` (imports; the profile block inside `buildCurrentMeasurement`, currently lines 859-873)

- [ ] **Step 1: Write the failing test**

`src/lib/activeLoudnessProfile.test.js`:

```js
import { describe, expect, it } from "vitest";
import { describeActiveLoudnessProfile } from "./activeLoudnessProfile.js";

const broadcast = { id: "p1", name: "Broadcast", referenceLufs: -23, rules: [] };

describe("describeActiveLoudnessProfile", () => {
  it("is null when no profile document is in force", () => {
    expect(
      describeActiveLoudnessProfile({ active: "off", document: null, draft: null })
    ).toBeNull();
    expect(describeActiveLoudnessProfile({})).toBeNull();
  });

  it("describes the selected saved profile", () => {
    expect(
      describeActiveLoudnessProfile({ active: "profile:p1", document: broadcast, draft: null })
    ).toEqual({ mode: "saved", id: "p1", name: "Broadcast", document: broadcast });
  });

  it("describes an open draft as preview under the id being edited", () => {
    const edited = { ...broadcast, name: "Broadcast (editing)" };
    expect(
      describeActiveLoudnessProfile({
        active: "profile:p1",
        document: edited,
        draft: { editingId: "p1", document: edited, dirty: true },
      })
    ).toEqual({ mode: "preview", id: "p1", name: "Broadcast (editing)", document: edited });
  });

  it("gives a new, never-saved draft no id", () => {
    expect(
      describeActiveLoudnessProfile({
        active: "off",
        document: broadcast,
        draft: { editingId: null, document: broadcast, dirty: false },
      }).id
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/activeLoudnessProfile.test.js`
Expected: FAIL — cannot resolve `./activeLoudnessProfile.js`.

- [ ] **Step 3: Implement the helper**

`src/lib/activeLoudnessProfile.js`:

```js
import { parseSelection } from "./loudnessProfileCatalog.js";

/// The Loudness Profile a reading is judged against right now, or null when there is none.
///
/// `document` is what `LoudnessProfileContext` exposes: the open editor's draft when there is one,
/// otherwise the active saved profile. A draft is `preview` and carries the id of the profile being
/// edited (null for one never saved). Measurement inspection and file reports both describe the
/// profile through this, so they cannot disagree about which profile judged a number.
export function describeActiveLoudnessProfile({ active, document, draft } = {}) {
  if (!document) return null;
  const preview = draft != null;
  const selection = parseSelection(active);
  return {
    mode: preview ? "preview" : "saved",
    id: preview ? (draft.editingId ?? null) : selection.kind === "profile" ? selection.id : null,
    name: document.name ?? null,
    document,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/activeLoudnessProfile.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Route `measurement inspect` through the helper**

In `src/agentControl/useAgentControlBridge.js`, add next to the other `../lib/` imports:

```js
import { describeActiveLoudnessProfile } from "../lib/activeLoudnessProfile.js";
```

Replace this block inside `buildCurrentMeasurement`:

```js
const selection = parseSelection(currentProfile.active);
const preview = currentProfile.profile?.draft != null;
const profileDocument = currentProfile.profile?.document ?? null;
const profile = profileDocument
  ? {
      mode: preview ? "preview" : "saved",
      id: preview
        ? (currentProfile.profile.draft.editingId ?? null)
        : selection.kind === "profile"
          ? selection.id
          : null,
      name: profileDocument.name ?? null,
      document: profileDocument,
    }
  : null;
```

with:

```js
const profile = describeActiveLoudnessProfile({
  active: currentProfile.active,
  document: currentProfile.profile?.document,
  draft: currentProfile.profile?.draft,
});
```

Keep the `parseSelection` import: it is still used by `activeLoudnessProfileId` near line 285.

- [ ] **Step 6: Run the measurement tests to verify nothing changed**

Run: `npx vitest run src/agentControl/measurementControl.test.js src/agentControl/useAgentControlBridge.test.jsx`
Expected: PASS, with no test edits.

- [ ] **Step 7: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/lib/activeLoudnessProfile.js src/lib/activeLoudnessProfile.test.js src/agentControl/useAgentControlBridge.js
git commit -m "refactor(loudness-profile): share active profile resolution" -m "Measurement inspection resolved saved versus preview inline; file reports need the same answer, so the resolution moves into one helper." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `loudnessProfile` block in the JSON report

**Files:**

- Modify: `src/lib/fileAnalysisReport.js` (whole file below)
- Modify: `src/lib/fileAnalysisReport.test.js`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("fileAnalysisReport", ...)` in `src/lib/fileAnalysisReport.test.js`
(after the last `it`), and add the fixture above the `describe`:

```js
const BROADCAST = {
  mode: "saved",
  id: "p1",
  name: "Broadcast",
  document: {
    id: "p1",
    name: "Broadcast",
    referenceLufs: -23,
    rules: [
      { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
      { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
      { metricId: "truePeak", op: ">", value: -2, severity: "fail" },
      { metricId: "psr", op: "<", value: 8, severity: "warn" },
      { metricId: "lra", op: ">", value: undefined, severity: "fail" },
    ],
  },
};
```

```js
it("records an off profile when none is in force", () => {
  const report = buildFileAnalysisReport(COMPLETE_SESSION, {
    exportedAt: "2026-07-06T12:30:00.000Z",
  });

  expect(report.loudnessProfile).toEqual({
    mode: "off",
    id: null,
    name: null,
    rules: [],
    byMetric: {},
  });
});

it("judges whole-file readings against the profile and records its filled rules", () => {
  const report = buildFileAnalysisReport(COMPLETE_SESSION, {
    exportedAt: "2026-07-06T12:30:00.000Z",
    loudnessProfile: BROADCAST,
  });

  expect(report.loudnessProfile).toEqual({
    mode: "saved",
    id: "p1",
    name: "Broadcast",
    rules: [
      { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
      { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
      { metricId: "truePeak", op: ">", value: -2, severity: "fail" },
      { metricId: "psr", op: "<", value: 8, severity: "warn" },
    ],
    byMetric: { integrated: "ok", truePeak: "fail", psr: "notEvaluated" },
  });
});

it("keeps preview mode for an open editor's draft", () => {
  const report = buildFileAnalysisReport(COMPLETE_SESSION, {
    exportedAt: "2026-07-06T12:30:00.000Z",
    loudnessProfile: { ...BROADCAST, mode: "preview" },
  });

  expect(report.loudnessProfile.mode).toBe("preview");
});

it("does not evaluate a judged metric the file has no value for", () => {
  const report = buildFileAnalysisReport(
    {
      ...COMPLETE_SESSION,
      summary: { ...COMPLETE_SESSION.summary, mMaxLufs: -Infinity },
      analysisSettings: { dialogue: { enabled: false } },
    },
    {
      exportedAt: "2026-07-06T12:30:00.000Z",
      loudnessProfile: {
        ...BROADCAST,
        document: {
          ...BROADCAST.document,
          rules: [
            { metricId: "momentaryMax", op: ">", value: -10, severity: "fail" },
            { metricId: "dialogueIntegrated", op: ">", value: -20, severity: "fail" },
          ],
        },
      },
    }
  );

  expect(report.loudnessProfile.byMetric).toEqual({
    momentaryMax: "notEvaluated",
    dialogueIntegrated: "notEvaluated",
  });
});

it("names a Markdown report with its own extension", () => {
  expect(defaultFileAnalysisReportName({ fileName: "final_mix.wav" }, "md")).toBe(
    "final_mix-plvs-report.md"
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/fileAnalysisReport.test.js`
Expected: FAIL — `report.loudnessProfile` is `undefined`; the filename test gets `.json`.

- [ ] **Step 3: Implement**

Replace `src/lib/fileAnalysisReport.js` with:

```js
import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";

const REPORT_SCHEMA_VERSION = 1;
const REPORT_TYPE = "fileAnalysis";

/// The Loudness Profile metrics a whole-file report can judge, keyed to the `summary` field that
/// holds each. A rule on any other metric describes a moment or a derived reading, which a
/// completed file does not have, so it is reported `notEvaluated`.
export const REPORT_PROFILE_METRIC_FIELDS = Object.freeze({
  integrated: "integratedLufs",
  lra: "lra",
  momentaryMax: "mMaxLufs",
  shortTermMax: "stMaxLufs",
  truePeak: "truePeakMaxDbtp",
  dialogueIntegrated: "dialogueIntegratedLufs",
  dialogueRange: "dialogueLra",
});

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function optionalNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function basenameWithoutExtension(fileName) {
  const raw = String(fileName || "plvs-report").replace(/\\/g, "/");
  const base = raw.split("/").pop() || "plvs-report";
  return base.replace(/\.[^.]+$/, "") || "plvs-report";
}

function safeFileStem(fileName) {
  return basenameWithoutExtension(fileName)
    .replace(/[<>:"/\\|?*]/g, "-")
    .split("")
    .map((ch) => (ch.charCodeAt(0) < 32 ? "-" : ch))
    .join("")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

export function defaultFileAnalysisReportName(fileSession, extension = "json") {
  const stem = safeFileStem(fileSession?.fileName || fileSession?.path || "plvs-report");
  return `${stem || "plvs-report"}-plvs-report.${extension}`;
}

/// `profile` is `describeActiveLoudnessProfile`'s result, or null when no profile is in force.
function buildLoudnessProfileBlock(profile, summary) {
  if (!profile?.document) {
    return { mode: "off", id: null, name: null, rules: [], byMetric: {} };
  }
  const rules = (profile.document.rules ?? [])
    .filter((rule) => !isRuleEmpty(rule))
    .map(({ metricId, op, value, severity }) => ({ metricId, op, value, severity }));
  const values = {};
  for (const [metricId, field] of Object.entries(REPORT_PROFILE_METRIC_FIELDS)) {
    if (Number.isFinite(summary[field])) values[metricId] = summary[field];
  }
  const statuses = loudnessProfileEvaluate(
    { rules },
    { values, integratedReady: Number.isFinite(values.integrated) }
  );
  const byMetric = {};
  for (const [metricId, status] of Object.entries(statuses)) {
    // `pending` means "no reading yet"; a completed analysis will never produce one.
    byMetric[metricId] = status === "pending" ? "notEvaluated" : status;
  }
  return {
    mode: profile.mode === "preview" ? "preview" : "saved",
    id: profile.id ?? null,
    name: profile.name ?? null,
    rules,
    byMetric,
  };
}

export function buildFileAnalysisReport(fileSession, options = {}) {
  if (fileSession?.state !== "complete" || !fileSession.summary) {
    throw new Error("A completed file analysis is required to export a report.");
  }

  const summary = fileSession.summary;
  const metadata = fileSession.metadata ?? {};
  const selectedTrack = metadata.selectedTrack ?? {};
  const dialogue = fileSession.analysisSettings?.dialogue ?? {};
  const dialogueEnabled = dialogue.enabled === true;
  const samplePeakMaxDb = Math.max(
    Number.isFinite(summary.samplePeakMaxLDb) ? summary.samplePeakMaxLDb : -Infinity,
    Number.isFinite(summary.samplePeakMaxRDb) ? summary.samplePeakMaxRDb : -Infinity
  );
  const reportSummary = {
    durationMs: optionalNumber(summary.durationMs),
    sampleRateHz: optionalNumber(summary.sampleRateHz),
    channelCount: optionalNumber(summary.channelCount ?? summary.channels),
    integratedLufs: finiteOrNull(summary.integratedLufs),
    lra: finiteOrNull(summary.lra),
    mMaxLufs: finiteOrNull(summary.mMaxLufs),
    stMaxLufs: finiteOrNull(summary.stMaxLufs),
    truePeakMaxDbtp: finiteOrNull(summary.truePeakMaxDbtp),
    samplePeakMaxLDb: finiteOrNull(summary.samplePeakMaxLDb),
    samplePeakMaxRDb: finiteOrNull(summary.samplePeakMaxRDb),
    samplePeakMaxDb: finiteOrNull(samplePeakMaxDb),
    dialogueIntegratedLufs: dialogueEnabled ? finiteOrNull(summary.dialogueIntegrated) : null,
    dialogueLra: dialogueEnabled ? finiteOrNull(summary.dialogueLra) : null,
  };

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportType: REPORT_TYPE,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    app: {
      name: "PLVS",
      version: options.appVersion ?? null,
    },
    source: {
      path: stringOrNull(fileSession.path ?? metadata.path),
      fileName: stringOrNull(fileSession.fileName ?? metadata.fileName),
      container: stringOrNull(metadata.container),
      durationMs: optionalNumber(metadata.durationMs ?? summary.durationMs),
      selectedTrack: {
        index: Number.isInteger(selectedTrack.index) ? selectedTrack.index : null,
        codec: stringOrNull(selectedTrack.codec),
        sampleRateHz: optionalNumber(selectedTrack.sampleRateHz),
        channels: optionalNumber(selectedTrack.channels),
        language: stringOrNull(selectedTrack.language),
      },
    },
    analysis: {
      analyzedAt: fileSession.analyzedAt
        ? new Date(fileSession.analyzedAt).toISOString()
        : (options.analyzedAt ?? null),
      decodedFrames: optionalNumber(fileSession.decodedFrames),
      dialogue: {
        enabled: dialogueEnabled,
        engine: dialogueEnabled ? stringOrNull(dialogue.engine) : null,
      },
    },
    summary: reportSummary,
    history: {
      retained: true,
      truncated: fileSession.historyTruncated === true,
      coveredMs: optionalNumber(fileSession.historyCoveredMs),
    },
    loudnessProfile: buildLoudnessProfileBlock(options.loudnessProfile, reportSummary),
  };
}

export function stringifyFileAnalysisReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/fileAnalysisReport.test.js src/agentControl/useAgentControlBridge.test.jsx src/hooks/useFileAnalysisReportExport.test.jsx`
Expected: PASS. The bridge's existing report test builds its expectation with the same builder, so
both sides now carry the same `off` block.

- [ ] **Step 5: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/lib/fileAnalysisReport.js src/lib/fileAnalysisReport.test.js
git commit -m "feat(file-report): record Loudness Profile verdicts" -m "The fileAnalysis report gains an optional loudnessProfile block with the profile's filled rules and a per-metric verdict. Only whole-file readings are judged; everything else is notEvaluated." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Markdown renderer

**Files:**

- Create: `src/lib/fileAnalysisReportMarkdown.js`
- Create: `src/lib/fileAnalysisReportMarkdown.test.js`

- [ ] **Step 1: Write the failing tests**

`src/lib/fileAnalysisReportMarkdown.test.js`:

```js
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildFileAnalysisReport } from "./fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "./fileAnalysisReportMarkdown.js";

const ORIGINAL_TZ = process.env.TZ;

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
    process.env.TZ = "Asia/Shanghai";
  });
  afterAll(() => {
    if (ORIGINAL_TZ === undefined) delete process.env.TZ;
    else process.env.TZ = ORIGINAL_TZ;
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/lib/fileAnalysisReportMarkdown.test.js`
Expected: FAIL — cannot resolve `./fileAnalysisReportMarkdown.js`.

- [ ] **Step 3: Implement the renderer**

`src/lib/fileAnalysisReportMarkdown.js`:

```js
import { formatClock } from "../hooks/useSessionTimer.js";
import { formatContainer, formatTrackLabel } from "./fileAnalysisDisplay.js";
import { REPORT_PROFILE_METRIC_FIELDS } from "./fileAnalysisReport.js";
import { STATS_META, statDecimals } from "./statsCatalog.js";

/// Renders a `fileAnalysis` report as Markdown that also reads cleanly unrendered: headed lists for
/// measurements, one padded table for the profile. It reads only the report, so the file export,
/// the clipboard, and the CLI all produce the same text from the same JSON.

const MISSING = "—";
const RESULT_LABELS = { ok: "OK", warn: "Warn", fail: "Fail", notEvaluated: "Not evaluated" };

function fixed(value, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : null;
}

function withUnit(text, unit) {
  if (text == null) return MISSING;
  return unit ? `${text} ${unit}` : text;
}

function item(label, value) {
  return `- ${label}: ${value}`;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

/// Local time with the UTC offset, so a reader in another zone can place it.
function formatExportedAt(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return MISSING;
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const abs = Math.abs(offset);
  const day = `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  return `${day} ${time} (UTC${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)})`;
}

function metricValue(metricId, summary) {
  const field = REPORT_PROFILE_METRIC_FIELDS[metricId];
  const text = field ? fixed(summary[field], statDecimals(metricId)) : null;
  return withUnit(text, STATS_META[metricId]?.unit ?? "");
}

function samplePeak(summary) {
  const max = fixed(summary.samplePeakMaxDb);
  if (max == null) return MISSING;
  const left = fixed(summary.samplePeakMaxLDb);
  const right = fixed(summary.samplePeakMaxRDb);
  return left != null && right != null ? `${max} dBFS (L ${left} · R ${right})` : `${max} dBFS`;
}

/// One metric's rules as one phrase: same severity joins with `or`, severities with `;`.
function ruleText(metricId, rules) {
  const decimals = statDecimals(metricId);
  const groups = [];
  for (const rule of rules) {
    let group = groups.find(({ severity }) => severity === rule.severity);
    if (!group) {
      group = { severity: rule.severity, conditions: [] };
      groups.push(group);
    }
    group.conditions.push(`${rule.op} ${rule.value.toFixed(decimals)}`);
  }
  const text = groups
    .map(({ severity, conditions }) => `${severity} if ${conditions.join(" or ")}`)
    .join("; ");
  return withUnit(text, STATS_META[metricId]?.unit ?? "");
}

function table(header, rows) {
  const all = [header, ...rows];
  const widths = header.map((_, column) => Math.max(3, ...all.map((row) => row[column].length)));
  const line = (row) => `| ${row.map((cell, column) => cell.padEnd(widths[column])).join(" | ")} |`;
  return [
    line(header),
    `| ${widths.map((width) => "-".repeat(width)).join(" | ")} |`,
    ...rows.map(line),
  ];
}

function profileSection(profile, summary) {
  if (!profile || profile.mode === "off") return [];
  const lines = [`## Loudness Profile: ${profile.name ?? "Untitled"}`, ""];
  if (profile.mode === "preview") {
    lines.push("Unsaved draft — rules may change before they are saved.", "");
  }
  const metricIds = [...new Set(profile.rules.map(({ metricId }) => metricId))];
  if (metricIds.length === 0) {
    lines.push("No rules are set.");
    return lines;
  }
  const rows = metricIds.map((metricId) => {
    const status = profile.byMetric[metricId] ?? "notEvaluated";
    return [
      STATS_META[metricId]?.label ?? metricId,
      ruleText(
        metricId,
        profile.rules.filter((rule) => rule.metricId === metricId)
      ),
      status === "notEvaluated" ? MISSING : metricValue(metricId, summary),
      RESULT_LABELS[status] ?? status,
    ];
  });
  lines.push(...table(["Metric", "Rule", "Measured", "Result"], rows));
  return lines;
}

export function renderFileAnalysisReportMarkdown(report) {
  const source = report.source ?? {};
  const summary = report.summary ?? {};
  const dialogue = report.analysis?.dialogue ?? {};
  const track = source.selectedTrack;
  const hasTrack = track != null && Object.values(track).some((value) => value != null);

  const lines = [
    "# PLVS Loudness Report",
    "",
    `**${source.fileName ?? "Unknown file"}**`,
    "",
    `Exported ${formatExportedAt(report.exportedAt)} · PLVS ${report.app?.version ?? MISSING}`,
    "",
    "## File",
    "",
    // Inline code keeps Windows backslashes and underscores from being read as Markdown.
    item("Path", source.path ? `\`${source.path}\`` : MISSING),
    item("Container", formatContainer(source.container) ?? MISSING),
    item("Duration", Number.isFinite(source.durationMs) ? formatClock(source.durationMs) : MISSING),
    item("Track", hasTrack ? formatTrackLabel(track) : MISSING),
    "",
    "## Loudness",
    "",
    item(STATS_META.integrated.label, metricValue("integrated", summary)),
    item(STATS_META.lra.label, metricValue("lra", summary)),
    item(STATS_META.momentaryMax.label, metricValue("momentaryMax", summary)),
    item(STATS_META.shortTermMax.label, metricValue("shortTermMax", summary)),
    item(STATS_META.truePeak.label, metricValue("truePeak", summary)),
    item("Sample Peak Max", samplePeak(summary)),
  ];
  if (dialogue.enabled) {
    lines.push(
      "",
      "## Dialogue",
      "",
      item("Engine", dialogue.engine ?? MISSING),
      item(STATS_META.dialogueIntegrated.label, metricValue("dialogueIntegrated", summary)),
      item(STATS_META.dialogueRange.label, metricValue("dialogueRange", summary))
    );
  }
  const profile = profileSection(report.loudnessProfile, summary);
  if (profile.length > 0) lines.push("", ...profile);
  return `${lines.join("\n")}\n`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/lib/fileAnalysisReportMarkdown.test.js`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

Run `npm run check` (expect exit 0; it runs Prettier, so run `npx prettier --write` on the two new
files first if `format:check` complains), then:

```bash
git add src/lib/fileAnalysisReportMarkdown.js src/lib/fileAnalysisReportMarkdown.test.js
git commit -m "feat(file-report): render reports as Markdown" -m "One pure renderer turns the fileAnalysis JSON into Markdown that reads cleanly raw or rendered, so every Markdown output shares a single source." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Save dialog filter and export hook

**Files:**

- Modify: `src/ipc/fileDialog.js` (`REPORT_EXTENSIONS`, `saveFileAnalysisReportFile`)
- Modify: `src/ipc/fileDialog.test.js`
- Modify: `src/hooks/useFileAnalysisReportExport.js` (whole file below)
- Modify: `src/hooks/useFileAnalysisReportExport.test.jsx`

- [ ] **Step 1: Write the failing dialog test**

In `src/ipc/fileDialog.test.js`, change the imports and append a `describe`:

```js
import { open, save } from "@tauri-apps/plugin-dialog";
import { MEDIA_EXTENSIONS, pickMediaFile, saveFileAnalysisReportFile } from "./fileDialog.js";
```

```js
describe("saveFileAnalysisReportFile", () => {
  it("filters the save dialog by report format", async () => {
    save.mockResolvedValue("C:\\report.md");

    await expect(saveFileAnalysisReportFile("mix-plvs-report.md", "markdown")).resolves.toBe(
      "C:\\report.md"
    );
    expect(save).toHaveBeenLastCalledWith({
      defaultPath: "mix-plvs-report.md",
      filters: [{ name: "PLVS Report (Markdown)", extensions: ["md"] }],
    });

    await saveFileAnalysisReportFile("mix-plvs-report.json");
    expect(save).toHaveBeenLastCalledWith({
      defaultPath: "mix-plvs-report.json",
      filters: [{ name: "PLVS Report", extensions: ["json"] }],
    });
  });
});
```

- [ ] **Step 2: Write the failing hook tests**

In `src/hooks/useFileAnalysisReportExport.test.jsx`:

1. The existing "writes a desktop report" test now expects the format argument. Change
   `expect(mocks.saveFileAnalysisReportFile).toHaveBeenCalledWith("final_mix-plvs-report.json");`
   to
   `expect(mocks.saveFileAnalysisReportFile).toHaveBeenCalledWith("final_mix-plvs-report.json", "json");`
2. Add `vi.fn` clipboard setup and new tests inside the `describe`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/ipc/fileDialog.test.js src/hooks/useFileAnalysisReportExport.test.jsx`
Expected: FAIL — the dialog ignores the format, the hook calls the dialog with one argument, and
`copyFileAnalysisReportMarkdown` is not a function.

- [ ] **Step 4: Implement the dialog filter**

In `src/ipc/fileDialog.js`, replace `const REPORT_EXTENSIONS = ["json"];` with:

```js
const REPORT_FILTERS = {
  json: { name: "PLVS Report", extensions: ["json"] },
  markdown: { name: "PLVS Report (Markdown)", extensions: ["md"] },
};
```

and replace `saveFileAnalysisReportFile` with:

```js
/** @returns {Promise<string | null>} Absolute path, or null if the user cancelled. */
export async function saveFileAnalysisReportFile(
  defaultPath = "plvs-report.json",
  format = "json"
) {
  const selected = await save({
    defaultPath,
    filters: [REPORT_FILTERS[format]],
  });
  return typeof selected === "string" ? selected : null;
}
```

- [ ] **Step 5: Implement the hook**

Replace `src/hooks/useFileAnalysisReportExport.js` with:

```js
import { useCallback } from "react";
import { writeTextFile } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { saveFileAnalysisReportFile } from "../ipc/fileDialog.js";
import { describeActiveLoudnessProfile } from "../lib/activeLoudnessProfile.js";
import {
  buildFileAnalysisReport,
  defaultFileAnalysisReportName,
  stringifyFileAnalysisReport,
} from "../lib/fileAnalysisReport.js";
import { renderFileAnalysisReportMarkdown } from "../lib/fileAnalysisReportMarkdown.js";

const REPORT_FORMATS = {
  json: { extension: "json", mediaType: "application/json", render: stringifyFileAnalysisReport },
  markdown: {
    extension: "md",
    mediaType: "text/markdown",
    render: renderFileAnalysisReportMarkdown,
  },
};

/// `loudnessProfile` is the `useLoudnessProfile()` value; the report judges against whatever it
/// has in force, the open editor's draft included.
export function useFileAnalysisReportExport({
  fileSession,
  appVersion,
  raiseNotice,
  loudnessProfile = null,
}) {
  const buildReport = useCallback(
    () =>
      buildFileAnalysisReport(fileSession, {
        appVersion,
        loudnessProfile: describeActiveLoudnessProfile(loudnessProfile ?? {}),
      }),
    [appVersion, fileSession, loudnessProfile]
  );

  const exportFileAnalysisReport = useCallback(
    async (format = "json") => {
      if (fileSession.state !== "complete") {
        raiseNotice("guard", "Choose a completed file analysis to export");
        return;
      }

      const { extension, mediaType, render } = REPORT_FORMATS[format];
      try {
        const contents = render(buildReport());
        const defaultName = defaultFileAnalysisReportName(fileSession, extension);

        if (isTauri()) {
          const path = await saveFileAnalysisReportFile(defaultName, format);
          if (!path) return;
          await writeTextFile(path, contents);
        } else {
          const blob = new Blob([contents], { type: mediaType });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = defaultName;
          a.click();
          URL.revokeObjectURL(url);
        }
      } catch (_) {
        raiseNotice("error", "Report export failed");
      }
    },
    [buildReport, fileSession, raiseNotice]
  );

  /// Resolves true once the Markdown is on the clipboard, so the caller can confirm it.
  const copyFileAnalysisReportMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(renderFileAnalysisReportMarkdown(buildReport()));
      return true;
    } catch (_) {
      raiseNotice("error", "Copy failed");
      return false;
    }
  }, [buildReport, raiseNotice]);

  return {
    exportFileAnalysisReport,
    copyFileAnalysisReportMarkdown,
  };
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/ipc/fileDialog.test.js src/hooks/useFileAnalysisReportExport.test.jsx`
Expected: PASS.

- [ ] **Step 7: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/ipc/fileDialog.js src/ipc/fileDialog.test.js src/hooks/useFileAnalysisReportExport.js src/hooks/useFileAnalysisReportExport.test.jsx
git commit -m "feat(file-report): export Markdown and copy it to the clipboard" -m "The export hook writes either format through a matching save filter, copies the Markdown, and judges the report against the Loudness Profile in force." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Export menu in the File summary bar

**Files:**

- Modify: `src/components/FileAnalysisSummary.jsx`
- Modify: `src/components/FileAnalysisSummary.test.jsx`
- Modify: `src/App.jsx` (the `useFileAnalysisReportExport` call near line 1776; `fileSummaryProps` near line 2239)

- [ ] **Step 1: Write the failing tests**

In `src/components/FileAnalysisSummary.test.jsx`:

1. Change the testing-library import to
   `import { fireEvent, render, screen, waitFor } from "@testing-library/react";`
2. In "renders completed file metadata and authoritative delivery metrics", replace the last two
   lines:

```js
fireEvent.click(screen.getByRole("button", { name: "Export" }));
expect(onExportReport).toHaveBeenCalledTimes(1);
```

with:

```js
fireEvent.click(screen.getByRole("button", { name: "Export" }));
fireEvent.click(screen.getByRole("button", { name: "Export Markdown…" }));
expect(onExportReport).toHaveBeenCalledWith("markdown");
```

3. Add:

```js
it("exports JSON and copies Markdown from the export menu", async () => {
  const onExportReport = vi.fn();
  const onCopyReport = vi.fn(async () => true);
  render(
    <FileAnalysisSummary
      fileSession={{ state: "complete", fileName: "final.wav", summary: {} }}
      onExportReport={onExportReport}
      onCopyReport={onCopyReport}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  fireEvent.click(screen.getByRole("button", { name: "Export JSON…" }));
  expect(onExportReport).toHaveBeenCalledWith("json");

  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));
  expect(onCopyReport).toHaveBeenCalledTimes(1);
  expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
});

it("keeps the Export label when the copy fails", async () => {
  const onCopyReport = vi.fn(async () => false);
  render(
    <FileAnalysisSummary
      fileSession={{ state: "complete", fileName: "final.wav", summary: {} }}
      onCopyReport={onCopyReport}
    />
  );

  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  fireEvent.click(screen.getByRole("button", { name: "Copy as Markdown" }));

  await waitFor(() => expect(onCopyReport).toHaveBeenCalledTimes(1));
  expect(screen.getByRole("button", { name: "Export" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/components/FileAnalysisSummary.test.jsx`
Expected: FAIL — no `Export Markdown…` button exists.

- [ ] **Step 3: Implement the menu**

In `src/components/FileAnalysisSummary.jsx`:

Replace the first import line with:

```js
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Download } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
```

Add `onCopyReport,` after `onExportReport,` in the `FileAnalysisSummary` props, and replace the
whole `{isComplete ? ( <button ... Export ... </button> ) : null}` block (the second `isComplete`
block) with:

```jsx
{
  isComplete ? (
    <ExportReportMenu onExportReport={onExportReport} onCopyReport={onCopyReport} />
  ) : null;
}
```

Add below `FileAnalysisSummary` (above `MetricPair`):

```jsx
const COPIED_FEEDBACK_MS = 1500;

function ExportReportMenu({ onExportReport, onCopyReport }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const resetTimerRef = useRef(null);

  useEffect(
    () => () => {
      if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    },
    []
  );

  const choose = (action) => {
    setOpen(false);
    action();
  };

  // The menu closes on the click, so the confirmation lands on the trigger, for as long as
  // `CopyableTextBlock` shows its own. A failure is reported by the hook's notice instead.
  const copy = async () => {
    if (!(await onCopyReport?.())) return;
    setCopied(true);
    if (resetTimerRef.current) window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setCopied(false);
      resetTimerRef.current = null;
    }, COPIED_FEEDBACK_MS);
  };

  const Icon = copied ? Check : Download;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[color:color-mix(in_srgb,var(--border)_70%,transparent)] bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--background)_35%,transparent)_var(--panel-opacity-header),transparent)] px-2.5 text-[length:var(--ui-fs-control)] font-medium text-foreground shadow-sm transition-colors hover:bg-[color:color-mix(in_srgb,color-mix(in_srgb,var(--muted)_55%,transparent)_var(--panel-opacity-header),transparent)]"
        >
          <Icon className="size-[1.15em]" aria-hidden="true" />
          <span>{copied ? "Copied" : "Export"}</span>
          <ChevronDown className="size-[1em] text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={6} className="w-48 p-1">
        <MenuItem onClick={() => choose(() => onExportReport?.("markdown"))}>
          Export Markdown…
        </MenuItem>
        <MenuItem onClick={() => choose(() => onExportReport?.("json"))}>Export JSON…</MenuItem>
        <MenuItem onClick={() => choose(copy)}>Copy as Markdown</MenuItem>
      </PopoverContent>
    </Popover>
  );
}

function MenuItem({ onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center rounded-xs px-2 py-1.5 text-left text-[length:var(--ui-fs-control)] text-foreground transition-colors hover:bg-muted/50"
    >
      {children}
    </button>
  );
}
```

- [ ] **Step 4: Wire it in `App.jsx`**

Replace:

```js
const { exportFileAnalysisReport } = useFileAnalysisReportExport({
  fileSession,
  appVersion: APP_VERSION,
  raiseNotice,
});
```

with:

```js
const { exportFileAnalysisReport, copyFileAnalysisReportMarkdown } = useFileAnalysisReportExport({
  fileSession,
  appVersion: APP_VERSION,
  raiseNotice,
  loudnessProfile,
});
```

(`loudnessProfile` is the `useLoudnessProfile()` value already declared near line 296.) In
`fileSummaryProps`, after `onExportReport: exportFileAnalysisReport,` add:

```js
    onCopyReport: copyFileAnalysisReportMarkdown,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/components/FileAnalysisSummary.test.jsx src/App.smoke.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/components/FileAnalysisSummary.jsx src/components/FileAnalysisSummary.test.jsx src/App.jsx
git commit -m "feat(file-report): add the Export menu" -m "The summary bar's Export button opens a menu with Export Markdown, Export JSON, and Copy as Markdown; a successful copy briefly shows Copied on the button." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: `reportFormat` wire parameter

**Files:**

- Modify: `src/agentControl/protocol.js:912-926`
- Modify: `src/agentControl/protocol.test.js` (the `transport.file.report` tests near line 1170)

- [ ] **Step 1: Write the failing tests**

After the "normalizes transport.file.report to its session id" test, add:

```js
it("keeps an explicit transport.file.report format", () => {
  expect(
    normalizeAgentControlRequest(
      request("transport.file.report", { sessionId: "file-1", reportFormat: "markdown" })
    )
  ).toEqual({
    ok: true,
    request: {
      id: "req-1",
      method: "transport.file.report",
      params: { sessionId: "file-1", reportFormat: "markdown" },
    },
  });
});
```

Add two rows to the existing `it.each` rejection table:

```js
    [{ sessionId: "file-1", reportFormat: "pdf" }, "$.params.reportFormat"],
    [{ sessionId: "file-1", reportFormat: 1 }, "$.params.reportFormat"],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agentControl/protocol.test.js -t "transport.file.report"`
Expected: FAIL — `reportFormat` is rejected as an unknown parameter.

- [ ] **Step 3: Implement**

Replace the `transport.file.report` branch in `src/agentControl/protocol.js` with:

```js
if (input.method === "transport.file.report") {
  const field = unknownField(input.params, new Set(["sessionId", "reportFormat"]));
  if (field) return invalidParams(`$.params.${field}`, `Unknown parameter: ${field}.`);
  if (typeof input.params.sessionId !== "string" || input.params.sessionId.trim() === "") {
    return invalidParams("$.params.sessionId", "sessionId must be a non-empty string.");
  }
  const { reportFormat } = input.params;
  if (reportFormat !== undefined && reportFormat !== "json" && reportFormat !== "markdown") {
    return invalidParams("$.params.reportFormat", 'reportFormat must be "json" or "markdown".');
  }
  return {
    ok: true,
    request: {
      id: input.id,
      method: input.method,
      params: {
        sessionId: input.params.sessionId,
        ...(reportFormat === undefined ? {} : { reportFormat }),
      },
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agentControl/protocol.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/agentControl/protocol.js src/agentControl/protocol.test.js
git commit -m "feat(agent-control): accept a file report format" -m "transport.file.report takes an optional reportFormat of json or markdown." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Profile and Markdown in the bridge

**Files:**

- Modify: `src/agentControl/useAgentControlBridge.js` (imports; the `transport.file.report` branch near line 1797)
- Modify: `src/agentControl/useAgentControlBridge.test.jsx` (the `describe("File analysis report")` block near line 5273)

- [ ] **Step 1: Write the failing tests**

Inside `describe("File analysis report", ...)`, after `reportTransport`, add the fixture and tests:

```js
const broadcast = {
  id: "p1",
  name: "Broadcast",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
  ],
};
const profileContext = (draft = null) => ({
  active: "profile:p1",
  document: broadcast,
  draft,
  profiles: [broadcast],
});

it("records the Loudness Profile in force when the report is made", async () => {
  mount({ agentTransport: reportTransport([completeSession]), loudnessProfile: profileContext() });
  await waitUntilReady();

  const response = await send(
    request("transport.file.report", { sessionId: completeSession.id }, "file-report-profile")
  );

  expect(response.result.report.loudnessProfile).toEqual({
    mode: "saved",
    id: "p1",
    name: "Broadcast",
    rules: broadcast.rules,
    byMetric: { integrated: "ok" },
  });
});

it("judges an open editor's draft as preview", async () => {
  mount({
    agentTransport: reportTransport([completeSession]),
    loudnessProfile: profileContext({ editingId: "p1", document: broadcast, dirty: true }),
  });
  await waitUntilReady();

  const response = await send(
    request("transport.file.report", { sessionId: completeSession.id }, "file-report-preview")
  );

  expect(response.result.report.loudnessProfile).toMatchObject({ mode: "preview", id: "p1" });
});

it("returns the report as Markdown on request", async () => {
  mount({ agentTransport: reportTransport([completeSession]) });
  await waitUntilReady();

  const response = await send(
    request(
      "transport.file.report",
      { sessionId: completeSession.id, reportFormat: "markdown" },
      "file-report-markdown"
    )
  );

  expect(response.result.sessionId).toBe(completeSession.id);
  expect(response.result.report).toBeUndefined();
  expect(response.result.markdown.startsWith("# PLVS Loudness Report\n")).toBe(true);
  expect(response.result.markdown).toContain("\n**mix.wav**\n");
  expect(response.result.markdown).toContain("\n- Integrated: -23.1 LUFS\n");
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/agentControl/useAgentControlBridge.test.jsx -t "File analysis report"`
Expected: FAIL — `loudnessProfile.mode` is `off`, and there is no `markdown` field.

- [ ] **Step 3: Implement**

Add the renderer import next to the `buildFileAnalysisReport` import in
`src/agentControl/useAgentControlBridge.js`:

```js
import { renderFileAnalysisReportMarkdown } from "../lib/fileAnalysisReportMarkdown.js";
```

(`describeActiveLoudnessProfile` was imported in Task 1.) Replace the `return` at the end of the
`transport.file.report` branch:

```js
return {
  requestId,
  result: {
    revision: controlRevisionRef.current,
    sessionId: session.id,
    // The public snapshot names the probe `probe`; the GUI builder reads `metadata`.
    report: buildFileAnalysisReport(
      { ...session, metadata: session.probe },
      { appVersion: String(runtime.appVersion) }
    ),
  },
};
```

with:

```js
const currentProfile = latestMeasurementProfileRef.current;
// The public snapshot names the probe `probe`; the GUI builder reads `metadata`.
const report = buildFileAnalysisReport(
  { ...session, metadata: session.probe },
  {
    appVersion: String(runtime.appVersion),
    loudnessProfile: describeActiveLoudnessProfile({
      active: currentProfile.active,
      document: currentProfile.profile?.document,
      draft: currentProfile.profile?.draft,
    }),
  }
);
return {
  requestId,
  result: {
    revision: controlRevisionRef.current,
    sessionId: session.id,
    ...(request.params.reportFormat === "markdown"
      ? { markdown: renderFileAnalysisReportMarkdown(report) }
      : { report }),
  },
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/agentControl/useAgentControlBridge.test.jsx`
Expected: PASS, including the existing report tests.

- [ ] **Step 5: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/agentControl/useAgentControlBridge.js src/agentControl/useAgentControlBridge.test.jsx
git commit -m "feat(agent-control): report profile verdicts and Markdown" -m "transport.file.report judges against the Loudness Profile in force and, for reportFormat markdown, returns the GUI renderer's text as result.markdown." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: `--report-format` in the Rust CLI

**Files:**

- Modify: `src-tauri/src/cli_control.rs`
  - `ControlCommand::TransportReport` (line 196)
  - `parse_transport_report_args` (lines 1266-1305)
  - params in `request_for_command` (line 2592)
  - `write_export_file` (lines 3270-3294) and `finish_export` (lines 3302-3323)
  - tests near lines 6163-6294

- [ ] **Step 1: Write the failing tests**

Every existing `ControlCommand::TransportReport { .. }` literal in the tests (lines 6167, 6182,
6188, 6251) gains `report_format: None,` after `out`. Then add, after
`writing_a_file_report_replaces_it_with_the_path_it_was_written_to`:

```rust
  #[test]
  fn parses_transport_file_report_format() {
    assert_eq!(
      parse_control_args(&args(&[
        "transport",
        "file",
        "report",
        "file-1",
        "--json",
        "--report-format",
        "markdown"
      ])),
      Ok(ControlCommand::TransportReport {
        session_id: "file-1".to_string(),
        out: None,
        report_format: Some("markdown".to_string()),
      })
    );
    let request = request_for_command(
      &ControlCommand::TransportReport {
        session_id: "file-1".to_string(),
        out: None,
        report_format: Some("markdown".to_string()),
      },
      &mut Cursor::new([]),
    )
    .unwrap();
    assert_eq!(
      request.params,
      serde_json::json!({ "sessionId": "file-1", "reportFormat": "markdown" })
    );

    for invalid in [
      args(&["transport", "file", "report", "file-1", "--json", "--report-format"]),
      args(&[
        "transport",
        "file",
        "report",
        "file-1",
        "--json",
        "--report-format",
        "pdf",
      ]),
    ] {
      assert!(parse_control_args(&invalid).is_err(), "parsed {invalid:?}");
    }
  }

  #[test]
  fn writing_a_markdown_file_report_writes_the_text_verbatim() {
    let markdown_result = || {
      serde_json::json!({
        "revision": 4,
        "sessionId": "file-1",
        "markdown": "# PLVS Loudness Report\n"
      })
    };
    let command = |out: String| ControlCommand::TransportReport {
      session_id: "file-1".to_string(),
      out: Some(out),
      report_format: Some("markdown".to_string()),
    };

    let path = std::env::temp_dir().join(format!("plvs-file-report-{}.md", std::process::id()));
    let mut written = ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(markdown_result()),
      error: None,
    };
    assert_eq!(
      finish_export(
        &command(path.to_string_lossy().into_owned()),
        &mut written,
        0
      ),
      0
    );
    assert_eq!(fs::read_to_string(&path).unwrap(), "# PLVS Loudness Report\n");
    let result = written.result.unwrap();
    assert_eq!(result["out"], path.to_string_lossy().as_ref());
    assert!(result.get("markdown").is_none());
    fs::remove_file(path).unwrap();

    // A write failure exits 1 and leaves the Markdown recoverable from stdout.
    let mut failed = ControlReport {
      schema_version: CLI_SCHEMA_VERSION,
      ok: true,
      result: Some(markdown_result()),
      error: None,
    };
    assert_eq!(
      finish_export(&command(unwritable_path()), &mut failed, 0),
      1
    );
    assert_eq!(failed.result.unwrap()["markdown"], "# PLVS Loudness Report\n");
  }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib file_report`
Expected: compile error — `TransportReport` has no field `report_format`.

- [ ] **Step 3: Implement**

`ControlCommand` variant (line 196):

```rust
  TransportReport {
    session_id: String,
    out: Option<String>,
    report_format: Option<String>,
  },
```

`parse_transport_report_args`: change the usage string to
`"Usage: plvs-cli transport file report <session-id> --json [--report-format <json|markdown>] [--out <file>]"`,
declare `let mut report_format = None;` next to `let mut out = None;`, add this arm before the
`value =>` fallback:

```rust
      "--report-format" => {
        let value = args
          .get(index + 1)
          .ok_or_else(|| "Missing value for --report-format.".to_string())?;
        if !matches!(value.as_str(), "json" | "markdown") {
          return Err("The --report-format value must be json or markdown.".to_string());
        }
        report_format = Some(value.clone());
        index += 2;
      }
```

and return `Ok(ControlCommand::TransportReport { session_id, out, report_format })`.

Params in `request_for_command` (line 2592):

```rust
    ControlCommand::TransportReport {
      session_id,
      report_format,
      ..
    } => match report_format {
      Some(format) => serde_json::json!({ "sessionId": session_id, "reportFormat": format }),
      None => serde_json::json!({ "sessionId": session_id }),
    },
```

`finish_export` arm:

```rust
    ControlCommand::TransportReport {
      out: Some(path),
      report_format,
      ..
    } => (
      path,
      if report_format.as_deref() == Some("markdown") {
        "markdown"
      } else {
        "report"
      },
      "report",
    ),
```

`write_export_file`: replace the `let contents = format!(...)` statement with:

```rust
  let contents = match document {
    // A rendered document (the Markdown report) is already text; the renderer ends it with a
    // newline, so it is written as-is rather than as a JSON string.
    Value::String(text) => text.clone(),
    document => format!(
      "{}\n",
      serde_json::to_string_pretty(document)
        .map_err(|error| format!("Unable to serialize {subject}: {error}"))?
    ),
  };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib file_report`
Expected: PASS (the existing report tests plus the two new ones).
Then: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_control`
Expected: PASS — `every_running_manifest_leaf_parses_and_builds_its_declared_wire_method` still
passes because the canonical argv skips the optional flag.

- [ ] **Step 5: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src-tauri/src/cli_control.rs
git commit -m "feat(cli): add --report-format to transport file report" -m "The flag forwards reportFormat, and --out writes a Markdown report's text verbatim instead of serializing it as JSON." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Manifest and documentation

**Files:**

- Modify: `src/agentControl/commandManifest.json` (the `transport.file.report` entry, lines 4516-4565)
- Regenerate: `docs/agent-control/generated/commands.md`
- Modify: `docs/agent-control/transport.md`, `docs/cli.md`,
  `docs/superpowers/specs/2026-09-11-agent-control-file-report-design.md`,
  `scripts/cliDocumentationContract.test.js`

- [ ] **Step 1: Write the failing contract assertions**

In `scripts/cliDocumentationContract.test.js`, inside "publishes the File analysis report command",
before `expect(roadmap)...`, add:

```js
expect(transport).toContain("--report-format markdown");
expect(transport).toContain("notEvaluated");
expect(cli).toContain("`result.markdown`");
expect(commands).toContain("--report-format");
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run scripts/cliDocumentationContract.test.js`
Expected: FAIL on `--report-format markdown`.

- [ ] **Step 3: Update the manifest**

In the `transport.file.report` entry:

- `"usage"` becomes
  `"plvs-cli transport file report <session-id> --json [--report-format <json|markdown>] [--out <file>]"`.
- Insert between the `--json` and `--out` options:

```json
        {
          "name": "--report-format",
          "required": false,
          "value": {
            "type": "string",
            "enum": ["json", "markdown"]
          },
          "mapsTo": "reportFormat"
        },
```

- Add to `wireParams.properties`, after `sessionId`:

```json
          "reportFormat": {
            "type": "string",
            "enum": ["json", "markdown"]
          }
```

- [ ] **Step 4: Regenerate the command catalog**

Run: `npm run docs:agent-control`
Expected: `docs/agent-control/generated/commands.md` changes in the `transport.file.report` section.

- [ ] **Step 5: Update `docs/agent-control/transport.md`**

After the line
`npm run desktop:control -- transport file report <session-id> --json --out mix-report.json`
add:

```text
npm run desktop:control -- transport file report <session-id> --json --report-format markdown --out mix-report.md
```

Change `` `transport file report <session-id> --json [--out <file>]` returns `` to
`` `transport file report <session-id> --json [--report-format <json|markdown>] [--out <file>]` returns ``.

After the paragraph ending "the internal capture harness output is not a public contract.", add:

```markdown
`--report-format markdown` returns `{ revision, sessionId, markdown }` instead: the same report
rendered by the function behind the GUI's Export Markdown and Copy as Markdown, so all three are
identical. `--out` then writes that text verbatim. `json`, the default, is unchanged.

The report's `loudnessProfile` block records the Loudness Profile in force at export: `mode` is
`off`, `saved`, or `preview` (an open editor's draft), `rules` holds its filled rules, and
`byMetric` gives each judged metric `ok`, `warn`, `fail`, or `notEvaluated`. Only whole-file
readings are judged; a rule on a momentary or derived metric, or on a reading the file does not
have, is `notEvaluated`. Adding optional fields such as this block does not change
`schemaVersion`; consumers ignore fields they do not know.
```

- [ ] **Step 6: Update `docs/cli.md`**

In Output Files, replace `` `out` fields never appear together. `` with:

```markdown
`out` fields never appear together. With `--report-format markdown`, `transport file report`
moves `result.markdown` instead, and the file receives the Markdown text verbatim rather than
pretty-printed JSON.
```

After the example `plvs-cli transport file report <session-id> --json --out mix-report.json` add:

```text
plvs-cli transport file report <session-id> --json --report-format markdown --out mix-report.md
```

- [ ] **Step 7: Mark the earlier design as extended**

In `docs/superpowers/specs/2026-09-11-agent-control-file-report-design.md`, replace
`Status: Approved design` with:

```markdown
Status: Approved design; extended by
[File Analysis Report: Markdown and Loudness Profile Verdicts](2026-09-11-file-report-markdown-design.md),
which adds the `loudnessProfile` block and `--report-format`. Where the two disagree, that design
wins.
```

- [ ] **Step 8: Format and verify**

Run: `npx prettier --write docs/agent-control/transport.md docs/cli.md docs/superpowers/specs/2026-09-11-agent-control-file-report-design.md src/agentControl/commandManifest.json`
Run: `npx vitest run scripts/cliDocumentationContract.test.js src/agentControl/commandManifest.test.js src/agentControl/publicSurfaceDocs.test.js`
Expected: PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib manifest`
Expected: PASS (the embedded manifest is re-read at compile time; help still lists the entry once).

- [ ] **Step 9: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src/agentControl/commandManifest.json docs/agent-control/generated/commands.md docs/agent-control/transport.md docs/cli.md docs/superpowers/specs/2026-09-11-agent-control-file-report-design.md scripts/cliDocumentationContract.test.js
git commit -m "docs(agent-control): publish Markdown file reports" -m "Declare --report-format in the command manifest and document result.markdown, verbatim Markdown output files, and the report's loudnessProfile block." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Remove the dead Rust Markdown renderer

**Files:**

- Modify: `src-tauri/src/cli_report.rs`

- [ ] **Step 1: Confirm nothing outside the file uses it**

Run: `git grep -n -E "render_markdown_report|normalize_report_items|ReportItem" -- src-tauri scripts`
Expected: matches only inside `src-tauri/src/cli_report.rs`.

- [ ] **Step 2: Delete the Markdown half**

From `src-tauri/src/cli_report.rs` delete:

- `use serde_json::Value;`
- `struct ReportItem` (with its `#[derive]`)
- `render_markdown_report`, `normalize_report_items`, `item_from_analyze_report`,
  `item_from_capture_report`, `display_file_name`, `file_name_from_path`, `render_items_markdown`
- `format_status`, `format_duration`, `format_lufs`, `format_lu`, `format_sample_rate`,
  `format_count`, `escape_markdown_cell`
- the whole `#[cfg(test)] mod tests` block (all three tests exercise the removed renderer)

Keep `render_doctor_text`, `render_analyze_text`, `doctor_status_label`, `qc_check_status_label`,
`format_dbtp`, `format_dbfs`, `format_optional_integer`, and `format_number`, and both remaining
`use crate::...` imports.

- [ ] **Step 3: Verify the build has no dead code**

Run: `npm run rust:clippy`
Expected: exit 0. Clippy runs with `-D warnings`, so any leftover helper that only the removed code
used fails here as `dead_code`; delete it and rerun.
Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib cli_`
Expected: PASS.

- [ ] **Step 4: Commit**

Run `npm run check` (expect exit 0), then:

```bash
git add src-tauri/src/cli_report.rs
git commit -m "refactor(cli): remove the unreachable Markdown report renderer" -m "The public report command was removed in the CLI v1 cleanup, leaving render_markdown_report reachable only from its own tests. The GUI renderer now owns Markdown reports." -m "Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Final verification and hand-off

- [ ] **Step 1: Full gate**

Run: `npm run check`
Expected: exit 0.

- [ ] **Step 2: Hand desktop acceptance to the user**

Do not launch the app yourself. Ask the user to run, with `npm run desktop` open and a short file
analyzed:

1. Export Markdown, Export JSON, and Copy as Markdown from the summary bar, with the Loudness
   Profile off, a saved profile selected, and the profile editor open with a change.
2. `npm run desktop:control -- transport inspect --json` to find the session ID, then
   `npm run desktop:control -- transport file report <session-id> --json --report-format markdown --out mix-report.md`
   and the same without `--report-format`.
3. The macOS run is performed on a Mac.

- [ ] **Step 3: Release reminder**

Tell the user that `src-tauri/src/cli_report.rs` is a capture-smoke dependency
(`scripts/audio-code-changed.mjs`), so the next release requires `npm run smoke:capture` on the
VB-Cable + VLC rig.
