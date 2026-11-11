import { buildFileAnalysisReport, REPORT_PROFILE_METRIC_FIELDS } from "./fileAnalysisReport.js";
import { FILE_METRICS, fileChannelLabels } from "./fileAnalysisMeasurements.js";
import { getSuccessfulFileSession } from "./fileAnalysisSessionRegistry.js";
import { STATS_META } from "./statsCatalog.js";

const METRIC_HEADERS = [
  "integrated_lufs",
  "lra_lu",
  "momentary_max_lufs",
  "short_term_max_lufs",
  "sample_peak_max_dbfs",
  "true_peak_max_dbtp",
  "dialogue_loudness_lufs",
  "ldr_lu",
  "dialogue_coverage_pct",
  "dialogue_range_lu",
];
const FILE_HEADERS = [
  "schema_version",
  "result_id",
  "file_name",
  "track_index",
  "track_language",
  "track_name",
  "container",
  "codec",
  "source_sha256",
  "source_size_bytes",
  "sample_rate_hz",
  "source_bit_depth",
  "sample_format",
  "duration_s",
  "channel_count",
  "source_layout",
  "calculation_layout",
  "layout_known",
  "analyzed_at_utc",
  "exported_at_utc",
  "dialogue_engine",
  "dialogue_detection_error",
];
const LOCATION_HEADERS = [
  "momentary_max_window_end_s",
  "momentary_max_window_end_reason",
  "short_term_max_window_end_s",
  "short_term_max_window_end_reason",
  "sample_peak_max_channel",
  "sample_peak_max_time_s",
  "sample_peak_max_time_reason",
  "true_peak_max_channel",
  "true_peak_max_time_s",
  "true_peak_max_time_reason",
];
const PROFILE_HEADERS = [
  "profile_name",
  "profile_mode",
  "profile_reference_lufs",
  "profile_overall",
  "profile_ok_count",
  "profile_warn_count",
  "profile_fail_count",
  "profile_not_evaluated_count",
  "profile_rules_json",
  "profile_metric_verdicts_json",
  ...METRIC_HEADERS.map((header) => "profile_" + header + "_verdict"),
];
const CHANNEL_FIELDS = [
  "label",
  "sample_peak_max_dbfs",
  "sample_peak_max_time_s",
  "sample_peak_max_reason",
  "sample_peak_max_time_reason",
  "true_peak_max_dbtp",
  "true_peak_max_time_s",
  "true_peak_max_reason",
  "true_peak_max_time_reason",
];

function cell(value) {
  if (value == null) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  let text = String(value);
  // Quote untrusted metadata as text even if a spreadsheet interprets formula-like CSV cells.
  if (/^[\t\r\n]|^\s*[=+\-@]/u.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}

const channelNumber = (location) =>
  Number.isInteger(location?.channelIndex) ? location.channelIndex + 1 : null;
const locationReason = (location, reason) =>
  Number.isFinite(location?.timeSeconds) ? null : (reason ?? "locationUnavailable");

function buildRow(report, entryId, maxChannels) {
  const { source, summary, analysis, unavailableReasons, loudnessProfile: profile } = report;
  const track = source.selectedTrack;
  const locations = summary.maximaLocations;
  const labels = fileChannelLabels(summary, analysis.channelRoles);
  const channelPeaks = new Map(summary.channelPeaks.map((peak) => [peak.channelIndex, peak]));
  const rules = profile.rules.map((rule) => ({
    ...rule,
    unit: STATS_META[rule.metricId]?.unit ?? null,
  }));
  const verdicts = Object.fromEntries(
    Object.entries(profile.byMetric).map(([id, verdict]) => {
      const field = REPORT_PROFILE_METRIC_FIELDS[id];
      return [
        id,
        {
          verdict,
          reason:
            verdict !== "notEvaluated"
              ? null
              : field
                ? (unavailableReasons[field] ?? "unavailable")
                : "unsupportedWholeFileMetric",
        },
      ];
    })
  );
  return [
    1,
    entryId,
    source.fileName,
    track.index,
    track.language,
    track.title,
    source.container,
    track.codec,
    source.version?.sha256,
    source.version?.byteLength,
    summary.sampleRateHz ?? track.sampleRateHz,
    track.bitsPerSample,
    track.sampleFormat,
    Number.isFinite(summary.durationMs) ? summary.durationMs / 1000 : null,
    summary.channelCount,
    track.channelLayout,
    summary.loudnessLayout,
    summary.loudnessLayoutKnown,
    analysis.analyzedAt,
    report.exportedAt,
    analysis.dialogue.engine,
    analysis.dialogue.error,
    ...FILE_METRICS.flatMap(({ field }) => [summary[field], unavailableReasons[field]]),
    locations?.mMaxWindowEnd?.timeSeconds,
    locationReason(locations?.mMaxWindowEnd, unavailableReasons.mMaxLufs),
    locations?.stMaxWindowEnd?.timeSeconds,
    locationReason(locations?.stMaxWindowEnd, unavailableReasons.stMaxLufs),
    channelNumber(locations?.samplePeakMax),
    locations?.samplePeakMax?.timeSeconds,
    locationReason(locations?.samplePeakMax, unavailableReasons.samplePeakMaxDb),
    channelNumber(locations?.truePeakMax),
    locations?.truePeakMax?.timeSeconds,
    locationReason(locations?.truePeakMax, unavailableReasons.truePeakMaxDbtp),
    ...Array.from({ length: maxChannels }, (_, index) => {
      if (index >= summary.channelCount) return Array(CHANNEL_FIELDS.length).fill(null);
      const peak = channelPeaks.get(index);
      return [
        peak?.label ?? labels[index] ?? "Ch " + (index + 1),
        peak?.samplePeakMaxDb,
        peak?.samplePeakMaxLocation?.timeSeconds,
        peak ? peak.samplePeakMaxUnavailableReason : "unavailable",
        locationReason(
          peak?.samplePeakMaxLocation,
          peak ? peak.samplePeakMaxUnavailableReason : "unavailable"
        ),
        peak?.truePeakMaxDbtp,
        peak?.truePeakMaxLocation?.timeSeconds,
        peak ? peak.truePeakMaxUnavailableReason : "unavailable",
        locationReason(
          peak?.truePeakMaxLocation,
          peak ? peak.truePeakMaxUnavailableReason : "unavailable"
        ),
      ];
    }).flat(),
    profile.name,
    profile.mode,
    profile.referenceLufs,
    profile.overall,
    profile.counts.ok,
    profile.counts.warn,
    profile.counts.fail,
    profile.counts.notEvaluated,
    JSON.stringify(rules),
    JSON.stringify(verdicts),
    ...FILE_METRICS.map(({ id }) => profile.byMetric[id] ?? "notApplicable"),
  ];
}

export function buildFileAnalysisStatisticsCsv(entries, options = {}) {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const reports = entries.flatMap((entry) =>
    getSuccessfulFileSession(entry)
      ? [{ id: entry.id, report: buildFileAnalysisReport(entry, { ...options, exportedAt }) }]
      : []
  );
  if (!reports.length) throw new Error("At least one completed file analysis is required.");
  const maxChannels = reports.reduce(
    (maximum, { report }) => Math.max(maximum, report.summary.channelCount ?? 0),
    0
  );
  const headers = [
    ...FILE_HEADERS,
    ...METRIC_HEADERS.flatMap((header) => [header, header + "_reason"]),
    ...LOCATION_HEADERS,
    ...Array.from({ length: maxChannels }, (_, index) =>
      CHANNEL_FIELDS.map((field) => "ch" + (index + 1) + "_" + field)
    ).flat(),
    ...PROFILE_HEADERS,
  ];
  const rows = reports.map(({ id, report }) =>
    buildRow(report, id, maxChannels).map(cell).join(",")
  );
  return "\uFEFF" + [headers.join(","), ...rows].join("\r\n") + "\r\n";
}
