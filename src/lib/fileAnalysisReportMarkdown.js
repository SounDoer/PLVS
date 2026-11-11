import { formatClock } from "../hooks/useSessionTimer.js";
import { formatContainer, formatTrackLabel } from "./fileAnalysisDisplay.js";
import { REPORT_PROFILE_METRIC_FIELDS } from "./fileAnalysisReport.js";
import { dialogueDetectionErrorMessage } from "./dialogueDetectionError.js";
import { STATS_META, statDecimals } from "./statsCatalog.js";
import { FILE_METRICS, FILE_UNAVAILABLE_EXPLANATIONS } from "./fileAnalysisMeasurements.js";

/// Renders a `fileAnalysis` report as Markdown that also reads cleanly unrendered: headed lists for
/// measurements, one padded table for the profile. It reads only the report, so the file export,
/// the clipboard, and the CLI all produce the same text from the same JSON.

const MISSING = "—";
const RESULT_LABELS = {
  ok: "OK",
  warn: "Warn",
  fail: "Fail",
  notEvaluated: "Not Evaluated",
  notFullyEvaluated: "Not Fully Evaluated",
};

function plainText(value) {
  return String(value ?? MISSING)
    .replace(/\s+/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/([\\`*_#|]|\[|\])/g, "\\$&");
}

function fixed(value, decimals = 1) {
  return Number.isFinite(value) ? value.toFixed(decimals) : null;
}

/**
 * @param {string} text
 */
function withUnit(text, unit) {
  if (text == null) return MISSING;
  return unit ? `${text} ${unit}` : text;
}

/**
 * @param {string} label
 * @param {string} value
 */
function item(label, value) {
  return `- ${label}: ${value}`;
}

/**
 * @param {number} value
 */
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

/**
 * @param {string} metricId
 */
function metricValue(metricId, summary) {
  const field = REPORT_PROFILE_METRIC_FIELDS[metricId];
  const text = field ? fixed(summary[field], statDecimals(metricId)) : null;
  return withUnit(text, STATS_META[metricId]?.unit ?? "");
}

function loudnessLayout(summary) {
  if (summary.loudnessLayoutKnown === false)
    return "Unknown layout — loudness uses channels 1–2 only";
  if (summary.loudnessLayoutKnown === true) return stringOrDash(summary.loudnessLayout);
  return null;
}

function stringOrDash(value) {
  return typeof value === "string" && value ? value : MISSING;
}

function locationText(location) {
  if (!Number.isFinite(location?.timeSeconds) || !Number.isFinite(location?.framePosition))
    return MISSING;
  const channel = Number.isInteger(location.channelIndex)
    ? `Ch${location.channelIndex + 1} · `
    : "";
  const boundary = location.framePosition < 0 ? "; Before Start" : "";
  return `${channel}${location.timeSeconds.toFixed(9)} s (Frame ${location.framePosition}${boundary})`;
}

function samplePeak(summary) {
  const max = fixed(summary.samplePeakMaxDb);
  if (max == null) return MISSING;
  const left = fixed(summary.samplePeakMaxLDb);
  const right = fixed(summary.samplePeakMaxRDb);
  return !summary.channelPeaks?.length && left != null && right != null
    ? `${max} dBFS (Ch1 ${left} · Ch2 ${right})`
    : `${max} dBFS`;
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
    const formatted = rule.value.toFixed(decimals);
    group.conditions.push(
      `${rule.op} ${Number(formatted) === rule.value ? formatted : rule.value}`
    );
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
  const lines = ["## Loudness Profile", ""];
  if (!profile || profile.mode === "off") return [...lines, "Loudness Profile is off."];
  lines.push(
    item("Profile", plainText(profile.name ?? "Untitled")),
    item("Mode", profile.mode === "preview" ? "Preview" : "Saved"),
    ""
  );
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

function groupedUnavailable(report) {
  const groups = new Map();
  function add(reason, label) {
    if (!reason) return;
    if (!groups.has(reason)) groups.set(reason, []);
    groups.get(reason).push(label);
  }
  for (const metric of FILE_METRICS) add(report.unavailableReasons?.[metric.field], metric.label);
  for (const peak of report.summary?.channelPeaks ?? []) {
    add(peak.samplePeakMaxUnavailableReason, `Ch${peak.channelIndex + 1} Sample Peak Max`);
    add(peak.truePeakMaxUnavailableReason, `Ch${peak.channelIndex + 1} True Peak Max`);
  }
  return groups.size
    ? [
        "",
        "### Unavailable Measurements",
        "",
        ...Array.from(groups, ([reason, labels]) =>
          item(labels.join(", "), FILE_UNAVAILABLE_EXPLANATIONS[reason] ?? reason)
        ),
      ]
    : [];
}

export function renderFileAnalysisReportMarkdown(report) {
  const source = report.source ?? {};
  const summary = report.summary ?? {};
  const dialogue = report.analysis?.dialogue ?? {};
  const track = source.selectedTrack;
  const hasTrack = track != null && Object.values(track).some((value) => value != null);
  const profile = report.loudnessProfile;
  const counts = profile?.counts ?? {};

  const lines = [
    "# PLVS Loudness Report",
    "",
    `**${plainText(source.fileName ?? "Unknown file")}**`,
    "",
    `Exported ${formatExportedAt(report.exportedAt)} · PLVS ${plainText(report.app?.version)}`,
    "",
    "## Summary",
    "",
    item(
      "Loudness Profile",
      profile?.mode === "off" || !profile
        ? "Off"
        : `${plainText(profile.name ?? "Untitled")} (${profile.mode === "preview" ? "Preview" : "Saved"})`
    ),
    item("Overall", RESULT_LABELS[profile?.overall ?? "notEvaluated"]),
    item(
      "Metric Counts",
      `${counts.ok ?? 0} OK · ${counts.warn ?? 0} Warn · ${counts.fail ?? 0} Fail · ${counts.notEvaluated ?? 0} Not Evaluated`
    ),
    "",
    "## File",
    "",
    item("Container", plainText(formatContainer(source.container))),
    item("Duration", Number.isFinite(source.durationMs) ? formatClock(source.durationMs) : MISSING),
    item("Track", hasTrack ? plainText(formatTrackLabel(track)) : MISSING),
    ...(track?.title ? [item("Track Name", plainText(track.title))] : []),
    item(
      "Source Bit Depth",
      Number.isFinite(track?.bitsPerSample) ? `${track.bitsPerSample} bit` : MISSING
    ),
    ...(track?.sampleFormat ? [item("Sample Format", plainText(track.sampleFormat))] : []),
    ...(source.version?.sha256 ? [item("Source SHA-256", plainText(source.version.sha256))] : []),
    "",
    "## Measurements",
    "",
    "### Loudness",
    "",
    item(STATS_META.integrated.label, metricValue("integrated", summary)),
    item(STATS_META.lra.label, metricValue("lra", summary)),
    item(STATS_META.momentaryMax.label, metricValue("momentaryMax", summary)),
    item(STATS_META.shortTermMax.label, metricValue("shortTermMax", summary)),
    item("Momentary Max Window End", locationText(summary.maximaLocations?.mMaxWindowEnd)),
    item("Short-term Max Window End", locationText(summary.maximaLocations?.stMaxWindowEnd)),
    "",
    "### Peaks",
    "",
    item(STATS_META.truePeak.label, metricValue("truePeak", summary)),
    item("Sample Peak Max", samplePeak(summary)),
    item("Sample Peak Max Location", locationText(summary.maximaLocations?.samplePeakMax)),
    item("True Peak Max Location", locationText(summary.maximaLocations?.truePeakMax)),
  ];
  for (const peak of summary.channelPeaks ?? []) {
    lines.push(
      item(
        `Ch${peak.channelIndex + 1}${peak.label && peak.label !== `Ch ${peak.channelIndex + 1}` ? ` (${plainText(peak.label)})` : ""}`,
        `Sample Peak Max ${withUnit(fixed(peak.samplePeakMaxDb), "dBFS")} · True Peak Max ${withUnit(fixed(peak.truePeakMaxDbtp), "dBTP")}`
      )
    );
  }
  for (const peak of summary.channelPeaks ?? []) {
    lines.push(
      item(
        `Ch${peak.channelIndex + 1} Sample Peak Max Location`,
        locationText(peak.samplePeakMaxLocation)
      )
    );
    lines.push(
      item(
        `Ch${peak.channelIndex + 1} True Peak Max Location`,
        locationText(peak.truePeakMaxLocation)
      )
    );
  }
  lines.push(
    "",
    "### Dialogue",
    "",
    item(STATS_META.dialogueIntegrated.label, metricValue("dialogueIntegrated", summary)),
    item(STATS_META.loudnessToDialogueRatio.label, metricValue("loudnessToDialogueRatio", summary)),
    item(STATS_META.dialogueCoverage.label, metricValue("dialogueCoverage", summary)),
    item(STATS_META.dialogueRange.label, metricValue("dialogueRange", summary))
  );
  lines.push(
    ...groupedUnavailable(report),
    "",
    ...profileSection(profile, summary),
    "",
    "## Analysis Details",
    "",
    item(
      "Analyzed",
      report.analysis?.analyzedAt ? formatExportedAt(report.analysis.analyzedAt) : MISSING
    ),
    item(
      "Decoded Frames",
      Number.isFinite(report.analysis?.decodedFrames)
        ? String(report.analysis.decodedFrames)
        : MISSING
    ),
    item("Engine", plainText(dialogue.engine)),
    item("Dialogue Algorithm Version", plainText(dialogue.metricAlgorithmVersion)),
    item("Detector Configuration", plainText(dialogue.engineConfiguration)),
    item("Multichannel Fusion", plainText(dialogue.multichannelFusion))
  );
  const layout = loudnessLayout(summary);
  if (layout != null) lines.push(item("Loudness Layout", plainText(layout)));
  if (report.analysis?.channelRoles?.length)
    lines.push(item("Channel Roles", plainText(report.analysis.channelRoles.join(", "))));
  if (dialogue.error)
    lines.push(item("Detection Error", dialogueDetectionErrorMessage(dialogue.error)));
  const requests = report.analysis?.requests;
  if (requests) {
    const keys = [
      requests.spectralWaveform && "Spectral Waveform",
      ...(requests.spectrum ?? []).map(({ key }) => key),
      ...(requests.vectorscope ?? []).map(({ key }) => key),
      ...(requests.stereoMap ?? []).map(({ key }) => key),
    ].filter(Boolean);
    if (keys.length) lines.push(item("Computed Views", plainText(keys.join(", "))));
  }
  return `${lines.join("\n")}\n`;
}
