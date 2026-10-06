import { createContext, useContext } from "react";
import { HIST_SAMPLE_SEC } from "../hooks/useLoudnessHistory.js";
import { useSnapshot } from "../hooks/useSnapshot";
import { useMeterDisplayState, useMeterRuntimeAssembly } from "./MeterRuntimeContext.jsx";

/** @typedef {ReturnType<typeof useSnapshot> & { channelCount: number }} DisplaySnapshot */
const DisplaySnapshotContext = createContext(/** @type {DisplaySnapshot | null} */ (null));

/**
 * The one mount of `useSnapshot`: what the panels show right now, live or at the scrub position.
 *
 * Its value changes on every meter frame. Read it only where per-frame updates are intended; an
 * owner that needs one slow-changing fact from it (the channel count) memoizes what it publishes.
 */
export function DisplaySnapshotProvider({ children }) {
  const { display, routing } = useMeterRuntimeAssembly();
  const { selectedOffset } = useMeterDisplayState();
  const { audio } = display;
  const snapshot = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    intake: routing.intakeRef.current,
    audio,
  });
  const { displayAudio } = snapshot;
  const displayChannelCount = Array.isArray(displayAudio.peakDb) ? displayAudio.peakDb.length : 0;
  const liveChannelCount = Array.isArray(audio.peakDb) ? audio.peakDb.length : 0;
  const channelCount = displayChannelCount > 0 ? displayChannelCount : liveChannelCount;

  return (
    <DisplaySnapshotContext.Provider value={{ ...snapshot, channelCount }}>
      {children}
    </DisplaySnapshotContext.Provider>
  );
}

export function useDisplaySnapshot() {
  const snapshot = useContext(DisplaySnapshotContext);
  if (!snapshot) throw new Error("useDisplaySnapshot must be used inside DisplaySnapshotProvider");
  return snapshot;
}
