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
