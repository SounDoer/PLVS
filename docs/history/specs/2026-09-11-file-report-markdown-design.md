# File Analysis Report: Markdown and Loudness Profile Verdicts

Date: 2026-09-11

Status: Approved design

## Purpose

The File mode **Export** button saves a completed analysis as a versioned `fileAnalysis` JSON
report. JSON serves scripts, fixtures, and bug reports, but it is not something a user can hand to
a client or file next to a delivery. This design adds a human-readable Markdown rendering of the
same report, a copy-to-clipboard path for it, and per-metric Loudness Profile verdicts so the report
can state whether the file met the standard the user was measuring against.

Readers are both delivery recipients (clients, directors, platforms) and the user's own archive.

## Decisions

- **Markdown is a rendering of the JSON report, never a second source.** One pure function turns a
  `fileAnalysis` report object into Markdown. The GUI file export, the clipboard copy, and the CLI
  all call it, so the three outputs cannot disagree.
- **The verdict lives in the JSON too.** `fileAnalysis` gains an optional `loudnessProfile` block;
  the Markdown renders it. JSON and Markdown from the same export always say the same thing.
- **Markdown that reads well unrendered.** Measurements are headed lists, not wide tables, so the
  raw text is tidy in Notepad, an email body, or Slack. Only the profile section is a table.
- **No overall verdict.** Each judged metric carries its own result; the report does not roll them
  into one pass/fail line.
- The public report stays at `schemaVersion: 1` (see Compatibility).

## JSON: the `loudnessProfile` block

`buildFileAnalysisReport(session, { appVersion, loudnessProfile })` adds:

```json
"loudnessProfile": {
  "mode": "saved",
  "id": "4b0e…",
  "name": "I −23 ±0.5 · TP ≤ −1",
  "rules": [
    { "metricId": "integrated", "op": ">", "value": -22.5, "severity": "fail" },
    { "metricId": "integrated", "op": "<", "value": -23.5, "severity": "fail" },
    { "metricId": "truePeak", "op": ">", "value": -1, "severity": "fail" }
  ],
  "byMetric": { "integrated": "fail", "truePeak": "ok" }
}
```

- `mode`: `"off"`, `"saved"`, or `"preview"`. Off has `id`, `name` null, `rules` `[]`, and
  `byMetric` `{}`.
- `preview` means a Loudness Profile editor is open with a draft. The report judges against the
  draft, because that is what the user sees on screen, and says so. Export is a read, so an open
  editor does not refuse it.
- `rules` records the thresholds in force at export time, excluding unfilled rules
  (`isRuleEmpty`). The block has this field and the LIVE `measurement inspect` profile block does
  not: a report is read away from PLVS, by people who cannot look the profile up, and profiles can
  be renamed, edited, or deleted after the fact. A verdict without its thresholds is unreadable.
- `byMetric` values are `"ok"`, `"warn"`, `"fail"`, or `"notEvaluated"`, keyed by every metric
  that carries a filled rule.

### Evaluation

Judging goes through the existing `loudnessProfileEvaluate`, with values taken from the report's
whole-file `summary`. Only metrics that have a whole-file value are supplied:

| Profile metric       | Report field                     |
| -------------------- | -------------------------------- |
| `integrated`         | `summary.integratedLufs`         |
| `lra`                | `summary.lra`                    |
| `momentaryMax`       | `summary.mMaxLufs`               |
| `shortTermMax`       | `summary.stMaxLufs`              |
| `truePeak`           | `summary.truePeakMaxDbtp`        |
| `dialogueIntegrated` | `summary.dialogueIntegratedLufs` |
| `dialogueRange`      | `summary.dialogueLra`            |

Rules on any other metric (`momentary`, `shortTerm`, `psr`, `plr`, `dialogueCoverage`,
`dialogueOffset`, `correlation`, `sideToMid`) describe a moment or a derived reading, not the whole
file, and are reported `notEvaluated`. A supplied metric whose value is null (a silent file's
Integrated, say) is also `notEvaluated`: the evaluator's `pending` maps to `notEvaluated`, since a
completed analysis will never produce the value.

This is why the report does not always match the Stats panel's colours in FILE mode: Stats reads the
value at the playback cursor, while the report judges the whole file. For the seven metrics above
the two agree once the cursor is at the end of the file.

### Profile resolution

The bridge already turns `{ active, document, draft }` into `{ mode, id, name, document }` for
`measurement inspect` (`useAgentControlBridge.js`, the block ahead of `buildMeasurementInspection`).
That logic moves into a shared pure helper, used by `measurement inspect`, by the file report
branch, and by the GUI export hook (which reads the same fields from `useLoudnessProfile()`), so
the three cannot drift on how saved and preview are told apart.

## Markdown

`renderFileAnalysisReportMarkdown(report)` returns the text below. The report language is English
and labels are Title Case, like the rest of the PLVS UI.

```markdown
# PLVS Loudness Report

**mix_final.wav**

Exported 2026-09-11 14:32 (UTC+08:00) · PLVS 0.42.0

## File

- Path: `D:\Projects\mix_final.wav`
- Container: WAV
- Duration: 00:03:12
- Track: Audio track 0 - English - PCM s16le - 48 kHz - Stereo

## Loudness

- Integrated: -16.1 LUFS
- Loudness Range: 4.2 LU
- Momentary Max: -9.8 LUFS
- Short-term Max: -12.3 LUFS
- True Peak Max: -1.2 dBTP
- Sample Peak Max: -1.4 dBFS (L -1.4 · R -1.6)

## Dialogue

- Engine: firered
- Dialogue Integrated: -24.0 LUFS
- Dialogue Range: 3.1 LU

## Loudness Profile: Mine

| Metric              | Rule                            | Measured   | Result        |
| ------------------- | ------------------------------- | ---------- | ------------- |
| Integrated          | fail if > -22.5 or < -23.5 LUFS | -16.1 LUFS | Fail          |
| True Peak Max       | fail if > -1.0 dBTP             | -1.2 dBTP  | OK            |
| Short-term Dynamics | warn if < 8.0 dB                | —          | Not evaluated |
```

- Metric labels come from `STATS_META`; values and thresholds use `statDecimals`, so a threshold is
  never shown finer than the reading it is judged against.
- File details reuse the summary bar's formatters (`formatContainer`, `formatTrackLabel`,
  `formatClock`), and numbers use the ASCII hyphen-minus the app renders.
- Several rules on one metric merge into one row. Same severity joins with `or`
  (`fail if > -22.5 or < -23.5 LUFS`); different severities join with `;`
  (`warn if > -22.0; fail if > -21.0 LUFS`).
- Table columns are padded to equal width so the raw text lines up.
- **Dialogue** appears only when dialogue analysis was enabled.
- **Loudness Profile** is omitted when the profile is off. In preview mode, the line
  `Unsaved draft — rules may change before they are saved.` follows the heading.
- Missing values render as `—`. The file path is included, as inline code so Windows backslashes
  and underscores are not read as Markdown.
- `history` is not rendered: it describes in-app scrub retention, which means nothing to a reader.
- `exportedAt` renders in the exporting machine's local time with its UTC offset.
- The default file name is `<stem>-plvs-report.md`, matching the JSON's `<stem>-plvs-report.json`.

## GUI

The summary bar's **Export** button keeps its look, gains a chevron, and opens a `Popover` (the same
primitive `FileAnalysisHistoryMenu` uses) with three items:

- `Export Markdown…`: save dialog filtered to `.md` ("PLVS Report (Markdown)").
- `Export JSON…`: today's behaviour.
- `Copy as Markdown`: `navigator.clipboard.writeText`, as `CopyableTextBlock` does.

The popover closes after an item is chosen. A successful copy swaps the Export button's icon for a
check and its label for `Copied` for 1.5 s, the duration `CopyableTextBlock` uses. A failed copy
raises the existing error notice (`Copy failed`); a failed export keeps `Report export failed`. A
cancelled save dialog writes nothing. In the browser-only dev build, both exports download a blob
(`text/markdown` or `application/json`), as JSON does today.

`useFileAnalysisReportExport` grows the three actions and reads the profile through
`useLoudnessProfile()`; `AppContent` already sits inside `LoudnessProfileProvider`.

## CLI

```text
plvs-cli transport file report <session-id> --json [--report-format json|markdown] [--out <file>]
```

- `--report-format` defaults to `json`; existing invocations are unchanged. It is a new flag rather
  than a value of `--format`, because `--format` already selects the stdout mode and file-writing
  commands require `--json` stdout.
- Wire param: optional `reportFormat: "json" | "markdown"`, validated in `protocol.js`.
- `json`: `result.report` is the report object, now including `loudnessProfile`.
- `markdown`: `result.markdown` is the Markdown string, produced in the bridge by the same renderer
  the GUI uses; `result.report` is absent.
- `--out` moves whichever document field is present into the file. `write_export_file` writes a
  string document verbatim (the renderer ends it with a newline) and serializes anything else as pretty
  JSON as today. The swap still happens only after the bytes are on disk.

## Compatibility

`fileAnalysis` gains a written compatibility rule: adding optional fields does not change
`schemaVersion`; removing a field or changing a field's meaning does. Consumers must ignore unknown
fields. `loudnessProfile` is the first field added under this rule, so the report stays at version 1.

## Dead Rust Markdown path

The public `report` command was removed in the CLI v1 cleanup, leaving the Rust Markdown renderer
in `src-tauri/src/cli_report.rs` reachable only from its own tests. It is removed in its own commit:
`render_markdown_report`, `normalize_report_items`, `item_from_analyze_report`,
`item_from_capture_report`, `display_file_name`, `file_name_from_path`, `ReportItem`,
`render_items_markdown`, and the helpers only they use (`format_status`, `format_duration`,
`format_lufs`, `format_lu`, `format_sample_rate`, `format_count`, `escape_markdown_cell`), with
their tests. `render_doctor_text`, `render_analyze_text`, and the helpers they share
(`format_number`, `format_dbtp`, `format_dbfs`, `format_optional_integer`) stay.

`cli_report.rs` is a capture-smoke dependency (`scripts/audio-code-changed.mjs`), so the next
release must run `npm run smoke:capture`. The `cli_analyze_batch` removal already requires this.

## Documentation

- [Agent Control File Analysis Report](2026-09-11-agent-control-file-report-design.md): its
  "no changes to the v1 schema" and "report formatting commands" out-of-scope lines are superseded
  by this design. Add a note pointing here.
- `docs/agent-control/transport.md`: the `loudnessProfile` block, `--report-format`, and
  `result.markdown`.
- `docs/cli.md` Output Files: a Markdown document is written verbatim.
- `src/agentControl/commandManifest.json`: usage and the new option. `generated/commands.md` is
  regenerated, never hand-edited.
- Follow the synchronization checklist in `docs/agent-control/README.md`.

## Testing

- Report builder: off, saved, and preview modes; `id` resolution in each; unfilled rules excluded;
  moment and derived metrics `notEvaluated`; a null summary value `notEvaluated`; `byMetric` equals
  `loudnessProfileEvaluate` on the mapped values.
- Profile helper: saved vs preview vs off, shared by `measurement inspect`, whose existing tests
  keep passing unchanged.
- Markdown renderer: section presence (Dialogue, Profile, draft line), decimals, rule merging for
  same and mixed severities, path, `—` for missing values, timestamp with offset under a fixed
  `TZ`, trailing newline.
- Export hook and menu: the three actions; copy success feedback and failure notice; a cancelled
  save writes nothing.
- Bridge: the CLI's JSON report equals the GUI builder's output for the same session and profile;
  `reportFormat: "markdown"` returns the renderer's exact string; protocol rejects unknown
  `reportFormat` values.
- Rust: `--report-format` parsing; `--out` writes a Markdown string verbatim and moves `markdown`
  to `out`; a write failure keeps `markdown` and exits 1; JSON behaviour unchanged.
- Desktop acceptance: export Markdown and JSON, copy, and run the CLI with each format, with a
  profile off, saved, and in preview.

## Out of scope

- PDF or any other format.
- Importing a report back into PLVS.
- An overall pass/fail verdict.
- Headless (app-closed) analysis or report commands.
