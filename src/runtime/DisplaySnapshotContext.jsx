import { createContext, useContext, useMemo } from "react";
import { HIST_SAMPLE_SEC } from "../hooks/useLoudnessHistory.js";
import { useSnapshot } from "../hooks/useSnapshot";
import { latestHistoryTimestampMs } from "../lib/historyTimestamps.js";
import { deriveSourceTransportState } from "../lib/sourceTransportState.js";
import {
  useMeterDisplayState,
  useMeterRuntime,
  useMeterRuntimeAssembly,
} from "./MeterRuntimeContext.jsx";
import { useSourceActions } from "./SourceActionsContext.jsx";

/**
 * @typedef {ReturnType<typeof useSnapshot> & {
 *   channelCount: number,
 *   sourceTransportState: ReturnType<typeof deriveSourceTransportState>,
 * }} DisplaySnapshot
 */
const DisplaySnapshotContext = createContext(/** @type {DisplaySnapshot | null} */ (null));

/**
 * The one mount of `useSnapshot`: what the panels and the transport pill show right now, live or at
 * the scrub position. Reads the metering runtime and the source actions (the active file session).
 *
 * Its value changes on every meter frame. Read it only where per-frame updates are intended; an
 * owner that needs one slow-changing fact from it (the channel count) memoizes what it publishes.
 */
export function DisplaySnapshotProvider({ children }) {
  const { display, routing } = useMeterRuntimeAssembly();
  const { sourceMode, running, analyzingFileSession } = useMeterRuntime();
  const { selectedOffset, selectedSnapshotTimeMs } = useMeterDisplayState();
  const { fileSession } = useSourceActions();
  const { audio } = display;
  const { elapsedMsRef } = display.clock;
  const snapshot = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: routing.intakeRef.current,
    audio,
  });
  const { displayAudio, histSourceList, targetTimestampMs } = snapshot;
  const displayChannelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const liveChannelCount = Array.isArray(audio.peakDb) ? audio.peakDb.length : 0;
  const channelCount = displayChannelCount > 0 ? displayChannelCount : liveChannelCount;

  // In file mode the selected history sample's timestamp is absolute media time (>= 0); clamp it so
  // a scrub past the decoded tail never renders a negative time in the transport pill. Live mode
  // keeps the raw value (its timeline is wall-clock relative).
  const selectedMediaTimeMs =
    sourceMode === "file" && Number.isFinite(targetTimestampMs)
      ? Math.max(0, targetTimestampMs)
      : targetTimestampMs;

  const latestTimestampMs = useMemo(() => {
    return latestHistoryTimestampMs(histSourceList);
    // The history ring mutates in place; its version is an intentional cache invalidator.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [histSourceList, histSourceList.version]);

  const sourceTransportState = deriveSourceTransportState({
    sourceMode,
    running,
    selectedOffset,
    latestTimestampMs,
    elapsedMs: elapsedMsRef.current,
    selectedSnapshotTimeMs,
    selectedMediaTimeMs,
    fileSession,
    analyzingFileSession,
  });

  return (
    <DisplaySnapshotContext.Provider value={{ ...snapshot, channelCount, sourceTransportState }}>
      {children}
    </DisplaySnapshotContext.Provider>
  );
}

export function useDisplaySnapshot() {
  const snapshot = useContext(DisplaySnapshotContext);
  if (!snapshot) throw new Error("useDisplaySnapshot must be used inside DisplaySnapshotProvider");
  return snapshot;
}
