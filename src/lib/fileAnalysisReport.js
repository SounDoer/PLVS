const REPORT_SCHEMA_VERSION = 1;
const REPORT_TYPE = "fileAnalysis";

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

export function defaultFileAnalysisReportName(fileSession) {
  const stem = safeFileStem(fileSession?.fileName || fileSession?.path || "plvs-report");
  return `${stem || "plvs-report"}-plvs-report.json`;
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
    summary: {
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
    },
    history: {
      retained: true,
      truncated: fileSession.historyTruncated === true,
      coveredMs: optionalNumber(fileSession.historyCoveredMs),
    },
  };
}

export function stringifyFileAnalysisReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}
