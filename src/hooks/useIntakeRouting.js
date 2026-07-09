import { useCallback, useMemo, useRef } from "react";
import { FrameIntake } from "../lib/FrameIntake.js";

/**
 * Owner of live-vs-file intake routing. Live and File keep separate history
 * rings so a source switch never bleeds one into the other, and returning to
 * File restores its previous analysis without re-decoding. Each engine writes
 * its own ring (live -> liveIntake, file -> fileAnalysisIntake); `intakeRef`
 * always points at the active source's ring and is what the display /
 * channel-metadata reads use. The file frame pump drives the shared display
 * only while the analyzing session is also the displayed one
 * (fileDisplayActiveRef) — switching to another file freezes that session's
 * panels instead of letting the in-progress analysis hijack the meters.
 * See docs/superpowers/specs/2026-07-08-c2-app-state-ownership-design.md.
 */
/* eslint-disable react-hooks/refs -- Render-phase ref mirroring is this hook's whole job:
   intakeRef / fileDisplayActiveRef must reflect the CURRENT render's routing decision
   synchronously, because the frame pump and channel-metadata writes read them outside the
   React lifecycle (same pattern this code used inline in App.jsx). */
export function useIntakeRouting({
  sourceMode,
  fileHistory,
  activeFileSession,
  analyzingFileSession,
  liveIntake,
}) {
  const emptyFileIntakeRef = useRef(null);
  if (emptyFileIntakeRef.current === null) emptyFileIntakeRef.current = new FrameIntake();
  const fileDisplayIntake = activeFileSession?.intake ?? emptyFileIntakeRef.current;
  const fileAnalysisIntake = analyzingFileSession?.intake ?? emptyFileIntakeRef.current;

  const fileDisplayActiveRef = useRef(false);
  fileDisplayActiveRef.current =
    sourceMode === "file" &&
    fileHistory.analyzingFileId != null &&
    fileHistory.analyzingFileId === fileHistory.activeFileId;

  const intakeRef = useRef(liveIntake);
  intakeRef.current = sourceMode === "file" ? fileDisplayIntake : liveIntake;

  const frequencyMarkerRef = useMemo(
    () => ({
      get current() {
        return intakeRef.current.getFrequencyChannelMarkers();
      },
    }),
    []
  );

  // Live per-request-key spectrogram source: each Spectrogram panel reads the rolling history for
  // its own request key so two spectrograms with different channel/view never share one history.
  const getSpectrogramSnapsForKey = useCallback(
    (key) => intakeRef.current.getSpectrogramSnapsForKey(key),
    []
  );

  return {
    intakeRef,
    fileDisplayIntake,
    fileAnalysisIntake,
    fileDisplayActiveRef,
    frequencyMarkerRef,
    getSpectrogramSnapsForKey,
  };
}
