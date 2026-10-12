import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";

const REPORT_SCHEMA_VERSION = 2;
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
  dialogueIntegrated: "dialogueLoudnessLufs",
  loudnessToDialogueRatio: "loudnessToDialogueRatioLu",
  dialogueCoverage: "dialogueCoveragePercent",
  dialogueRange: "dialogueRangeLu",
});

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

/**
 * @param {string} value
 */
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
  const dialogueMeasured = dialogueEnabled && Number.isFinite(summary.dialogueIntegrated);
  const ldr =
    dialogueMeasured && Number.isFinite(summary.integratedLufs)
      ? summary.integratedLufs - summary.dialogueIntegrated
      : null;
  const samplePeakMaxDb = Math.max(
    Number.isFinite(summary.samplePeakMaxLDb) ? summary.samplePeakMaxLDb : -Infinity,
    Number.isFinite(summary.samplePeakMaxRDb) ? summary.samplePeakMaxRDb : -Infinity
  );
  const reportSummary = {
    durationMs: finiteOrNull(summary.durationMs),
    sampleRateHz: finiteOrNull(summary.sampleRateHz),
    channelCount: finiteOrNull(summary.channelCount ?? summary.channels),
    loudnessLayout: stringOrNull(summary.loudnessLayout),
    loudnessLayoutKnown:
      typeof summary.loudnessLayoutKnown === "boolean" ? summary.loudnessLayoutKnown : null,
    integratedLufs: finiteOrNull(summary.integratedLufs),
    lra: finiteOrNull(summary.lra),
    mMaxLufs: finiteOrNull(summary.mMaxLufs),
    stMaxLufs: finiteOrNull(summary.stMaxLufs),
    truePeakMaxDbtp: finiteOrNull(summary.truePeakMaxDbtp),
    samplePeakMaxLDb: finiteOrNull(summary.samplePeakMaxLDb),
    samplePeakMaxRDb: finiteOrNull(summary.samplePeakMaxRDb),
    samplePeakMaxDb: finiteOrNull(samplePeakMaxDb),
    dialogueLoudnessLufs: dialogueMeasured ? summary.dialogueIntegrated : null,
    loudnessToDialogueRatioLu: ldr,
    dialogueCoveragePercent: dialogueEnabled ? finiteOrNull(summary.dialoguePercent) : null,
    dialogueRangeLu: dialogueMeasured ? finiteOrNull(summary.dialogueLra) : null,
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
      durationMs: finiteOrNull(metadata.durationMs ?? summary.durationMs),
      selectedTrack: {
        index: Number.isInteger(selectedTrack.index) ? selectedTrack.index : null,
        codec: stringOrNull(selectedTrack.codec),
        sampleRateHz: finiteOrNull(selectedTrack.sampleRateHz),
        channels: finiteOrNull(selectedTrack.channels),
        language: stringOrNull(selectedTrack.language),
      },
    },
    analysis: {
      analyzedAt: fileSession.analyzedAt
        ? new Date(fileSession.analyzedAt).toISOString()
        : (options.analyzedAt ?? null),
      decodedFrames: finiteOrNull(fileSession.decodedFrames),
      dialogue: {
        enabled: dialogueEnabled,
        engine: dialogueEnabled ? stringOrNull(dialogue.engine) : null,
        metricAlgorithmVersion: dialogueEnabled ? 1 : null,
        engineConfiguration: dialogueEnabled ? stringOrNull(dialogue.engineConfiguration) : null,
        multichannelFusion: dialogueEnabled ? stringOrNull(dialogue.multichannelFusion) : null,
      },
    },
    summary: reportSummary,
    history: {
      completeTimeline: true,
    },
    loudnessProfile: buildLoudnessProfileBlock(options.loudnessProfile, reportSummary),
  };
}

export function stringifyFileAnalysisReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
