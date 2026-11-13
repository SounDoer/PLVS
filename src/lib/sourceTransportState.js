import { formatClock } from "../hooks/useSessionTimer.js";

function clampProgress(progress) {
  if (!Number.isFinite(progress)) return 0;
  return Math.max(0, Math.min(1, progress));
}

function formatProgress(progress) {
  return `${Math.round(clampProgress(progress) * 100)}%`;
}

function liveSnapshotTimeMs({ elapsedMs = 0, selectedOffset, selectedSnapshotTimeMs }) {
  if (Number.isFinite(selectedSnapshotTimeMs)) return selectedSnapshotTimeMs;
  return Math.max(0, elapsedMs - selectedOffset * 1000);
}

function deriveLiveState({ running, selectedOffset = -1, elapsedMs = 0, selectedSnapshotTimeMs }) {
  if (selectedOffset >= 0) {
    return {
      sourceLabel: "Live",
      statusLabel: formatClock(
        liveSnapshotTimeMs({ elapsedMs, selectedOffset, selectedSnapshotTimeMs })
      ),
      actionLabel: "LIVE",
      chromeState: "snapshot",
      actionKind: "returnToLive",
      primaryActionDisabled: false,
    };
  }

  if (running) {
    return {
      sourceLabel: "Live",
      statusLabel: formatClock(elapsedMs),
      actionLabel: "STOP",
      chromeState: "live",
      actionKind: "stopLive",
      primaryActionDisabled: false,
    };
  }

  return {
    sourceLabel: "Live",
    statusLabel: "Ready",
    actionLabel: "START",
    chromeState: "ready",
    actionKind: "startLive",
    primaryActionDisabled: false,
  };
}

/**
 * @param {{
 *   selectedOffset?: number,
 *   selectedMediaTimeMs: number,
 *   fileSession?: import("./fileAnalysisSessionRegistry.js").FileSessionView | null,
 *   analyzingFileSession?: import("./fileAnalysisSessionRegistry.js").FileSessionView | null,
 *   preparingFileId?: string | null,
 *   fileImportBusy?: boolean,
 *   fileTaskBusy?: boolean,
 *   showBackgroundFileProgress?: boolean,
 * }} options
 */
function deriveFileState({
  selectedOffset = -1,
  selectedMediaTimeMs,
  fileSession = {},
  analyzingFileSession = null,
  preparingFileId = null,
  fileImportBusy = false,
  fileTaskBusy = false,
  showBackgroundFileProgress = false,
}) {
  const state = fileSession?.state ?? "empty";
  const busy = fileTaskBusy || Boolean(analyzingFileSession || preparingFileId || fileImportBusy);
  const base = { sourceLabel: "File" };
  if (selectedOffset >= 0 && Number.isFinite(selectedMediaTimeMs)) {
    return {
      ...base,
      statusLabel: formatClock(selectedMediaTimeMs),
      actionLabel: "RESULT",
      chromeState: "snapshot",
      actionKind: "returnToFileResult",
      primaryActionDisabled: false,
    };
  }
  const preparing = preparingFileId !== null && preparingFileId === fileSession?.id;
  if (
    fileImportBusy ||
    preparing ||
    state === "analyzing" ||
    (showBackgroundFileProgress && analyzingFileSession)
  ) {
    const current = showBackgroundFileProgress
      ? (analyzingFileSession ?? fileSession)
      : fileSession;
    const metadata = current?.attempt?.metadata ?? current?.metadata;
    const progressKnown = Number.isFinite(metadata?.durationMs) && !preparing && !fileImportBusy;
    return {
      ...base,
      statusLabel: progressKnown ? formatProgress(current.progress) : "Working…",
      actionLabel: "CANCEL",
      chromeState: "live",
      actionKind: "stopFileAnalysis",
      primaryActionDisabled: false,
    };
  }
  if (state === "error") {
    return {
      ...base,
      statusLabel: "Failed",
      actionLabel: "RETRY",
      chromeState: "ready",
      actionKind: "retryFile",
      primaryActionDisabled: busy,
    };
  }
  const durationMs = fileSession?.summary?.durationMs;
  return {
    ...base,
    statusLabel:
      state === "complete"
        ? Number.isFinite(durationMs)
          ? formatClock(durationMs)
          : "Done"
        : state === "canceled"
          ? "Canceled"
          : state === "ready"
            ? "Ready"
            : "No File",
    actionLabel: "OPEN",
    chromeState: "ready",
    actionKind: "chooseFile",
    primaryActionDisabled: busy,
  };
}

export function deriveSourceTransportState(input) {
  return input.sourceMode === "file" ? deriveFileState(input) : deriveLiveState(input);
}
