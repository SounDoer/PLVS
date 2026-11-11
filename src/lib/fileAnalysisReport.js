import { isRuleEmpty } from "./loudnessProfileCatalog.js";
import { loudnessProfileEvaluate } from "./loudnessProfileEvaluate.js";
import { getSuccessfulFileSession } from "./fileAnalysisSessionRegistry.js";
import { fileChannelLabels, fileUnavailableReasons } from "./fileAnalysisMeasurements.js";

const REPORT_SCHEMA_VERSION = 3;
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

function locationOrNull(value) {
  if (!Number.isFinite(value?.framePosition) || !Number.isFinite(value?.timeSeconds)) return null;
  return { framePosition: value.framePosition, timeSeconds: value.timeSeconds };
}

function channelLocationOrNull(value) {
  const location = locationOrNull(value);
  return location && Number.isInteger(value.channelIndex) && value.channelIndex >= 0
    ? { channelIndex: value.channelIndex, ...location }
    : null;
}

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
  const raw = String(fileName ?? "").replace(/\\/g, "/");
  const base = raw.split("/").pop() ?? "";
  return base.replace(/\.[^.]+$/, "");
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
  const stem = safeFileStem(fileSession?.fileName || fileSession?.path);
  return stem ? `plvs-report-${stem}.${extension}` : `plvs-report.${extension}`;
}

/// `profile` is `describeActiveLoudnessProfile`'s result, or null when no profile is in force.
function buildLoudnessProfileBlock(profile, summary) {
  if (!profile?.document) {
    return {
      mode: "off",
      id: null,
      name: null,
      referenceLufs: null,
      rules: [],
      byMetric: {},
      overall: "notEvaluated",
      counts: { ok: 0, warn: 0, fail: 0, notEvaluated: 0 },
    };
  }
  const rules = (profile.document.rules ?? [])
    .filter((rule) => !isRuleEmpty(rule))
    .map(({ metricId, op, value, severity }) => ({ metricId, op, value, severity }));
  const values = {};
  for (const [metricId, field] of Object.entries(REPORT_PROFILE_METRIC_FIELDS)) {
    if (Number.isFinite(summary[field])) values[metricId] = summary[field];
  }
  const statuses = loudnessProfileEvaluate({ rules }, { values, integratedReady: true });
  const byMetric = {};
  const counts = { ok: 0, warn: 0, fail: 0, notEvaluated: 0 };
  for (const [metricId, status] of Object.entries(statuses)) {
    // `pending` means "no reading yet"; a completed analysis will never produce one.
    byMetric[metricId] = status === "pending" ? "notEvaluated" : status;
    counts[byMetric[metricId]] += 1;
  }
  const overall = !rules.length
    ? "notEvaluated"
    : counts.fail
      ? "fail"
      : counts.warn
        ? "warn"
        : counts.notEvaluated
          ? "notFullyEvaluated"
          : "ok";
  return {
    mode: profile.mode === "preview" ? "preview" : "saved",
    id: profile.id ?? null,
    name: profile.name ?? null,
    referenceLufs: finiteOrNull(profile.document.referenceLufs),
    rules,
    byMetric,
    counts,
    overall,
  };
}

export function buildFileAnalysisReport(fileSession, options = {}) {
  fileSession = getSuccessfulFileSession(fileSession);
  if (fileSession?.state !== "complete" || !fileSession.summary) {
    throw new Error("A completed file analysis is required to export a report.");
  }

  const summary = fileSession.summary;
  const metadata = fileSession.metadata ?? {};
  const selectedTrack = metadata.selectedTrack ?? {};
  const dialogue = fileSession.analysisSettings?.dialogue ?? {};
  const dialogueEnabled = dialogue.enabled === true;
  const dialogueError = dialogueEnabled ? stringOrNull(summary.dialogueDetectionError) : null;
  const dialogueMeasured =
    dialogueEnabled && !dialogueError && Number.isFinite(summary.dialogueIntegrated);
  const channelCount = finiteOrNull(summary.channelCount ?? summary.channels);
  const roles = fileSession.analysisSettings?.channelRolesByCount?.[channelCount] ?? null;
  const channelLabels = fileChannelLabels(summary, roles);
  const ldr =
    dialogueMeasured && Number.isFinite(summary.integratedLufs)
      ? summary.integratedLufs - summary.dialogueIntegrated
      : null;
  const legacySamplePeakMaxDb = Math.max(
    Number.isFinite(summary.samplePeakMaxLDb) ? summary.samplePeakMaxLDb : -Infinity,
    Number.isFinite(summary.samplePeakMaxRDb) ? summary.samplePeakMaxRDb : -Infinity
  );
  const reportSummary = {
    durationMs: finiteOrNull(summary.durationMs),
    sampleRateHz: finiteOrNull(summary.sampleRateHz),
    channelCount,
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
    samplePeakMaxDb: finiteOrNull(
      Object.hasOwn(summary, "samplePeakMaxDb")
        ? summary.samplePeakMaxDb
        : (summary.channelCount ?? summary.channels) <= 2
          ? legacySamplePeakMaxDb
          : null
    ),
    channelPeaks: (summary.channelPeaks ?? []).map((peak) => ({
      channelIndex: peak.channelIndex,
      label: channelLabels[peak.channelIndex] ?? `Ch ${peak.channelIndex + 1}`,
      samplePeakMaxDb: finiteOrNull(peak.samplePeakMaxDb),
      truePeakMaxDbtp: finiteOrNull(peak.truePeakMaxDbtp),
      samplePeakMaxUnavailableReason: Number.isFinite(peak.samplePeakMaxDb)
        ? null
        : fileSession.decodedFrames > 0
          ? "belowMeasurementFloor"
          : "insufficientData",
      truePeakMaxUnavailableReason: Number.isFinite(peak.truePeakMaxDbtp)
        ? null
        : fileSession.decodedFrames > 0
          ? "belowMeasurementFloor"
          : "insufficientData",
      samplePeakMaxLocation: locationOrNull(peak.samplePeakMaxLocation),
      truePeakMaxLocation: locationOrNull(peak.truePeakMaxLocation),
    })),
    maximaLocations:
      summary.maximaLocations == null
        ? null
        : {
            samplePeakMax: channelLocationOrNull(summary.maximaLocations.samplePeakMax),
            truePeakMax: channelLocationOrNull(summary.maximaLocations.truePeakMax),
            mMaxWindowEnd: locationOrNull(summary.maximaLocations.mMaxWindowEnd),
            stMaxWindowEnd: locationOrNull(summary.maximaLocations.stMaxWindowEnd),
          },
    dialogueLoudnessLufs: dialogueMeasured ? summary.dialogueIntegrated : null,
    loudnessToDialogueRatioLu: ldr,
    dialogueCoveragePercent:
      dialogueEnabled && !dialogueError ? finiteOrNull(summary.dialoguePercent) : null,
    dialogueRangeLu: dialogueMeasured ? finiteOrNull(summary.dialogueLra) : null,
  };
  const sourceVersion = metadata.sourceVersion;

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    reportType: REPORT_TYPE,
    exportedAt: options.exportedAt ?? new Date().toISOString(),
    app: {
      name: "PLVS",
      version: options.appVersion ?? null,
    },
    source: {
      fileName: stringOrNull(fileSession.fileName ?? metadata.fileName),
      container: stringOrNull(metadata.container),
      durationMs: finiteOrNull(summary.durationMs),
      declaredDurationMs: finiteOrNull(metadata.durationMs),
      version: sourceVersion
        ? {
            sha256: stringOrNull(sourceVersion.sha256),
            byteLength: finiteOrNull(sourceVersion.byteLength),
          }
        : null,
      selectedTrack: {
        index: Number.isInteger(selectedTrack.index) ? selectedTrack.index : null,
        codec: stringOrNull(selectedTrack.codec),
        sampleRateHz: finiteOrNull(selectedTrack.sampleRateHz),
        channels: finiteOrNull(selectedTrack.channels),
        language: stringOrNull(selectedTrack.language),
        title: stringOrNull(selectedTrack.title),
        channelLayout: stringOrNull(selectedTrack.channelLayout),
        bitsPerSample: finiteOrNull(selectedTrack.bitsPerSample),
        sampleFormat: stringOrNull(selectedTrack.sampleFormat),
      },
    },
    analysis: {
      analyzedAt: fileSession.analyzedAt
        ? new Date(fileSession.analyzedAt).toISOString()
        : (options.analyzedAt ?? null),
      decodedFrames: finiteOrNull(fileSession.decodedFrames),
      channelRoles: roles ?? (summary.loudnessLayoutKnown ? channelLabels : null),
      requests: fileSession.analysisSettings?.requests ?? null,
      dialogue: {
        enabled: dialogueEnabled,
        engine: dialogueEnabled ? stringOrNull(dialogue.engine) : null,
        metricAlgorithmVersion: dialogueEnabled ? 1 : null,
        engineConfiguration: dialogueEnabled ? stringOrNull(dialogue.engineConfiguration) : null,
        multichannelFusion: dialogueEnabled ? stringOrNull(dialogue.multichannelFusion) : null,
        error: dialogueError,
      },
    },
    summary: reportSummary,
    unavailableReasons: fileUnavailableReasons(
      reportSummary,
      { enabled: dialogueEnabled, error: dialogueError },
      fileSession.decodedFrames
    ),
    history: {
      completeTimeline: true,
    },
    loudnessProfile: buildLoudnessProfileBlock(options.loudnessProfile, reportSummary),
  };
}

export function stringifyFileAnalysisReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
