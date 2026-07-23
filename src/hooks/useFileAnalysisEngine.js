import { useCallback, useEffect, useRef } from "react";
import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";
import {
  onFileAnalysisCompleted,
  onFileAnalysisError,
  onFileAnalysisProgress,
} from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";

// File history rings are bounded (see HIST_MAX_SAMPLES in App.jsx). When a file is long enough to
// fill them, scrub only reaches the most recent window. Compare the retained loudness window
// against the authoritative file duration so the summary can warn instead of silently truncating.
export function detectHistoryTruncation(intake, histMaxSamples, durationMs) {
  const loudness = intake?.getLoudnessHistory?.() ?? [];
  if (loudness.length < histMaxSamples || !Number.isFinite(durationMs) || durationMs <= 0) {
    return { historyTruncated: false, historyCoveredMs: undefined };
  }
  const first = typeof loudness.rowAt === "function" ? loudness.rowAt(0) : loudness[0];
  const last =
    typeof loudness.rowAt === "function"
      ? loudness.rowAt(loudness.length - 1)
      : loudness[loudness.length - 1];
  const firstTs = first?.timestampMs ?? 0;
  const lastTs = last?.timestampMs ?? 0;
  const coveredMs = Math.max(0, lastTs - firstTs);
  if (coveredMs >= durationMs * 0.98) {
    return { historyTruncated: false, historyCoveredMs: undefined };
  }
  return { historyTruncated: true, historyCoveredMs: coveredMs };
}

export function useFileAnalysisEngine({
  enabled,
  filePath,
  runId,
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  defaultSampleRateRef,
  intake,
  sessionId,
  updateFileSession,
  setAnalyzingFileId,
  display,
  shouldDriveDisplay,
}) {
  const { frameRef, selectedOffsetRef, setAudio, setSelectedOffset, raiseNotice } = display;
  const activePathRef = useRef(null);

  const stop = useCallback(async () => {
    await stopFileAnalysis();
  }, []);

  useEffect(() => {
    if (!enabled || !sessionId || !filePath || runId <= 0) return;
    if (!isTauri()) {
      raiseNotice("error", "Error: File analysis runs in the desktop app");
      updateFileSession(sessionId, (current) => ({ ...current, state: "empty" }));
      return;
    }

    let mounted = true;
    const unsubs = [];

    const run = async () => {
      try {
        activePathRef.current = filePath;
        intake.reset();
        frameRef.current = 0;
        selectedOffsetRef.current = -1;
        setSelectedOffset(-1);
        setAnalyzingFileId(sessionId);
        const metadata = await probeFileAnalysis(filePath);
        if (!mounted) return;
        defaultSampleRateRef.current = metadata.selectedTrack?.sampleRateHz || 48000;
        updateFileSession(sessionId, (current) => ({
          ...current,
          state: "analyzing",
          path: filePath,
          fileName: metadata.fileName,
          metadata,
          progress: 0,
          error: undefined,
          summary: undefined,
        }));

        unsubs.push(
          await onFileAnalysisProgress((payload) => {
            if (payload?.path !== activePathRef.current) return;
            updateFileSession(sessionId, (current) => ({
              ...current,
              state: "analyzing",
              progress: Number.isFinite(payload.progress) ? payload.progress : current.progress,
            }));
          })
        );
        unsubs.push(
          await onFileAnalysisCompleted((payload) => {
            if (payload?.path !== activePathRef.current) return;
            const { historyTruncated, historyCoveredMs } = detectHistoryTruncation(
              intake,
              histMaxSamples,
              payload.summary?.durationMs
            );
            updateFileSession(sessionId, (current) => ({
              ...current,
              state: "complete",
              progress: 1,
              decodedFrames: payload.decodedFrames,
              summary: payload.summary,
              historyTruncated,
              historyCoveredMs,
              analyzedAt: Date.now(),
            }));
            setAnalyzingFileId((current) => (current === sessionId ? null : current));
          })
        );
        unsubs.push(
          await onFileAnalysisError((payload) => {
            if (payload?.path !== activePathRef.current) return;
            updateFileSession(sessionId, (current) => ({
              ...current,
              state: "error",
              error: payload.message,
              analyzedAt: Date.now(),
            }));
            setAnalyzingFileId((current) => (current === sessionId ? null : current));
            raiseNotice("error", `Error: ${payload.message}`);
          })
        );

        const { applyFrame } = buildTauriFrameApply({
          histMaxSamples,
          visualMaxSamples,
          intake,
          frameRef,
          defaultSampleRateRef,
          setAudio,
          ackFrames: () => {},
          shouldDriveDisplay,
        });
        const channel = await startFileAnalysis({
          path: filePath,
          probe: metadata,
          onFrame: (frame) => {
            if (mounted) applyFrame(frame);
          },
        });
        audioRef.current = { mode: "file", channel, unsubs };
      } catch (err) {
        if (!mounted) return;
        const message = err?.message || "File analysis unavailable";
        updateFileSession(sessionId, (current) => ({
          ...current,
          state: "error",
          path: filePath,
          error: message,
          analyzedAt: Date.now(),
        }));
        setAnalyzingFileId((current) => (current === sessionId ? null : current));
        raiseNotice("error", `Error: ${message}`);
      }
    };

    run();
    return () => {
      mounted = false;
      for (const unsub of unsubs) {
        try {
          unsub?.();
        } catch (_) {}
      }
    };
    // Trigger ONLY on `runId`, which is bumped on an explicit analyze/reanalyze/drop. Keying off
    // `enabled`/`filePath` too would re-run analysis merely because the File source became enabled
    // again after a Live<->File switch. `beginFileAnalysis` sets `filePath` and bumps `runId`
    // together, so the latest path is read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return { stop };
}
