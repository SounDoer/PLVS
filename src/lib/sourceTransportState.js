/**
 * Derives source/transport display state for the toolbar chrome.
 *
 * Pure: no React, no side effects. Accepts the current session mode, snapshot offset,
 * and resolved media timestamp, and returns display strings for the toolbar chrome.
 */

/**
 * Format milliseconds to HH:MM:SS display string.
 * @param {number} ms
 * @returns {string}
 */
function formatMediaTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Derive toolbar chrome state from source mode and session context.
 *
 * @param {object} input
 * @param {"live"|"file"} input.sourceMode
 * @param {number} [input.selectedOffset] seconds back from live; < 0 means live/no snapshot
 * @param {number} [input.selectedMediaTimeMs] resolved media timestamp for file scrub display
 * @param {object} [input.fileSession] current file analysis session state
 * @param {string} [input.fileSession.state] e.g. "complete", "analyzing", "error"
 * @param {string} [input.fileSession.fileName]
 * @returns {{ sourceLabel: string, statusLabel: string, actionLabel: string, chromeState: string, actionKind: string }}
 */
export function deriveSourceTransportState(input) {
  const { sourceMode, selectedOffset = -1, selectedMediaTimeMs, fileSession } = input;

  if (sourceMode === "file") {
    const isSnapshot = selectedOffset >= 0 && Number.isFinite(selectedMediaTimeMs);
    if (isSnapshot) {
      return {
        sourceLabel: "File",
        statusLabel: formatMediaTime(selectedMediaTimeMs),
        actionLabel: "RESULT",
        chromeState: "snapshot",
        actionKind: "returnToFileResult",
      };
    }
    const fileName = fileSession?.fileName ?? "";
    const sessionState = fileSession?.state ?? "idle";
    return {
      sourceLabel: "File",
      statusLabel: fileName,
      actionLabel: sessionState === "complete" ? "DONE" : "ANALYZING",
      chromeState: sessionState === "complete" ? "ready" : "live",
      actionKind: "stopFileAnalysis",
    };
  }

  // Live mode
  const isSnapshot = selectedOffset >= 0;
  if (isSnapshot) {
    return {
      sourceLabel: "Live",
      statusLabel: "",
      actionLabel: "SNAPSHOT",
      chromeState: "snapshot",
      actionKind: "exitSnapshot",
    };
  }
  return {
    sourceLabel: "Live",
    statusLabel: "",
    actionLabel: "START",
    chromeState: "ready",
    actionKind: "start",
  };
}
