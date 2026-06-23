import { formatClock } from "../hooks/useSessionTimer.js";

function clampProgress(progress) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function formatProgress(progress) {
  return `${Math.round(clampProgress(progress) * 100)}%`;
}

function scrubTimeFromLatest({ latestTimestampMs, selectedOffset }) {
  if (Number.isFinite(latestTimestampMs)) {
    return Math.max(0, latestTimestampMs - selectedOffset * 1000);
  }
  return Math.max(0, selectedOffset * 1000);
}

function deriveLiveState({ running, selectedOffset = -1, latestTimestampMs, elapsedMs = 0 }) {
  if (selectedOffset >= 0) {
    return {
      sourceLabel: "Live",
      statusLabel: formatClock(scrubTimeFromLatest({ latestTimestampMs, selectedOffset })),
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
    };
  }

  if (running) {
    return {
      sourceLabel: "Live",
      statusLabel: formatClock(elapsedMs),
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopLive",
    };
  }

  return {
    sourceLabel: "Live",
    statusLabel: "Ready",
    actionLabel: "START",
    chromeState: "ready",
    actionKind: "startLive",
  };
}

function deriveFileState({
  selectedOffset = -1,
  selectedMediaTimeMs,
  fileSession = {},
  analyzingFileSession = null,
}) {
  const state = fileSession.state ?? "empty";
  const analyzingSession = analyzingFileSession ?? (state === "analyzing" ? fileSession : null);
  const analyzingState = analyzingSession?.state ?? "empty";

  if (selectedOffset >= 0 && Number.isFinite(selectedMediaTimeMs)) {
    return {
      sourceLabel: "File",
      statusLabel: formatClock(selectedMediaTimeMs),
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
    };
  }

  if (analyzingState === "analyzing") {
    return {
      sourceLabel: "File",
      statusLabel: formatProgress(analyzingSession.progress),
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
    };
  }

  if (state === "complete") {
    const durationMs = fileSession.summary?.durationMs ?? fileSession.metadata?.durationMs;
    return {
      sourceLabel: "File",
      statusLabel: Number.isFinite(durationMs) ? formatClock(durationMs) : "Done",
      actionLabel: "REANALYZE",
      chromeState: "ready",
      actionKind: "reanalyzeFile",
    };
  }

  if (state === "ready") {
    return {
      sourceLabel: "File",
      statusLabel: "Ready",
      actionLabel: "ANALYZE",
      chromeState: "ready",
      actionKind: "analyzeFile",
    };
  }

  return {
    sourceLabel: "File",
    statusLabel: "No file",
    actionLabel: "ANALYZE",
    chromeState: "ready",
    actionKind: "chooseFile",
  };
}

export function deriveSourceTransportState(input) {
  return input.sourceMode === "file" ? deriveFileState(input) : deriveLiveState(input);
}
