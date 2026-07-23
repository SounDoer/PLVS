import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionTimer } from "./useSessionTimer.js";

/**
 * Owner of the shared metering display layer: the meter frame snapshot, history
 * scrub offset, transport notice, session clock, and frame counter. Both engines
 * (live capture, file analysis) write into this layer; panels read it. See
 * docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md.
 *
 * All setters/refs returned here are identity-stable; the wrapper object is not.
 * Engine effects must keep reading fields inside the effect body and must not
 * list the wrapper in dependency arrays.
 */

export const INITIAL_METER_AUDIO = {
  peakDb: [],
  rmsDb: [],
  peakHoldDb: [],
  momentary: -Infinity,
  shortTerm: -Infinity,
  integrated: -Infinity,
  mMax: -Infinity,
  stMax: -Infinity,
  lra: -Infinity,
  tpL: -Infinity,
  tpR: -Infinity,
  truePeakL: -Infinity,
  truePeakR: -Infinity,
  tpMax: -Infinity,
  samplePeakMaxL: -Infinity,
  samplePeakMaxR: -Infinity,
  sampleL: -Infinity,
  sampleR: -Infinity,
  samplePeak: -Infinity,
  correlation: -Infinity,
  sideToMidDb: -Infinity,
  vectorscopePairX: 0,
  vectorscopePairY: 1,
  spectrumResultsByKey: {},
  vectorscopeResultsByKey: {},
};

// Clear-time snapshot, kept verbatim from App's clearMeterDisplayState: it is a
// deliberate full replacement with FEWER keys than INITIAL_METER_AUDIO (e.g. no
// spectrumResultsByKey), preserving the pre-refactor behavior exactly.
export const CLEARED_METER_AUDIO = {
  peakDb: [],
  rmsDb: [],
  peakHoldDb: [],
  momentary: -Infinity,
  shortTerm: -Infinity,
  integrated: -Infinity,
  mMax: -Infinity,
  stMax: -Infinity,
  lra: -Infinity,
  tpL: -Infinity,
  tpR: -Infinity,
  truePeakL: -Infinity,
  truePeakR: -Infinity,
  tpMax: -Infinity,
  samplePeakMaxL: -Infinity,
  samplePeakMaxR: -Infinity,
  sampleL: -Infinity,
  sampleR: -Infinity,
  samplePeak: -Infinity,
  correlation: -Infinity,
};

export function useMeterDisplay() {
  const [audio, setAudioState] = useState({ ...INITIAL_METER_AUDIO });
  const [selectedOffset, setSelectedOffsetState] = useState(-1);
  const [selectedSnapshotTimeMs, setSelectedSnapshotTimeMs] = useState(null);
  const [notice, setNotice] = useState(null);
  const [showClock, setShowClock] = useState(false);
  const selectedOffsetRef = useRef(-1);
  const latestAudioRef = useRef(audio);
  const snapshotBaseElapsedMsRef = useRef(null);
  const frameRef = useRef(0);
  const guardTimerRef = useRef(null);
  const clock = useSessionTimer();

  const setAudio = useCallback((nextAudio) => {
    const next = typeof nextAudio === "function" ? nextAudio(latestAudioRef.current) : nextAudio;
    latestAudioRef.current = next;
    setAudioState(next);
  }, []);

  const setSelectedOffset = useCallback(
    (nextOffset) => {
      const previous = selectedOffsetRef.current;
      const value = typeof nextOffset === "function" ? nextOffset(previous) : nextOffset;
      selectedOffsetRef.current = value;
      if (value >= 0) {
        if (!Number.isFinite(snapshotBaseElapsedMsRef.current)) {
          snapshotBaseElapsedMsRef.current = clock.elapsedMsRef.current;
        }
        setSelectedSnapshotTimeMs(Math.max(0, snapshotBaseElapsedMsRef.current - value * 1000));
      } else {
        snapshotBaseElapsedMsRef.current = null;
        setSelectedSnapshotTimeMs(null);
      }
      setSelectedOffsetState(value);
      if (previous >= 0 && value < 0) {
        setAudio(latestAudioRef.current);
      }
    },
    [clock.elapsedMsRef, setAudio]
  );

  useEffect(() => {
    selectedOffsetRef.current = selectedOffset;
  }, [selectedOffset]);

  useEffect(
    () => () => {
      if (guardTimerRef.current) clearTimeout(guardTimerRef.current);
    },
    []
  );

  const clearGuardTimer = () => {
    if (guardTimerRef.current) {
      clearTimeout(guardTimerRef.current);
      guardTimerRef.current = null;
    }
  };

  const clearNotice = () => {
    clearGuardTimer();
    setNotice(null);
  };

  const raiseNotice = (kind, text, details) => {
    clearGuardTimer();
    setNotice({
      kind,
      text,
      ...(typeof details === "string" && details ? { details } : null),
    });
    if (kind === "guard") {
      guardTimerRef.current = setTimeout(() => {
        guardTimerRef.current = null;
        setNotice(null);
      }, 5000);
    }
  };

  const clearAudio = useCallback(() => setAudio({ ...CLEARED_METER_AUDIO }), [setAudio]);

  return {
    audio,
    setAudio,
    latestAudioRef,
    selectedOffset,
    setSelectedOffset,
    selectedSnapshotTimeMs,
    selectedOffsetRef,
    frameRef,
    notice,
    raiseNotice,
    clearNotice,
    showClock,
    setShowClock,
    clock,
    clearAudio,
  };
}
