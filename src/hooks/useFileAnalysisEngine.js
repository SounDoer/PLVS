import { useCallback, useEffect, useRef } from "react";
import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";
import {
  onFileAnalysisCompleted,
  onFileAnalysisError,
  onFileAnalysisProgress,
} from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";
import { INITIAL_METER_AUDIO } from "./useMeterDisplay.js";

// File display history is independent of the Live History Length preference. The native worker
// adapts checkpoint cadence to keep the whole known duration inside these fixed four-hour-at-base-
// cadence budgets; longer files retain complete coverage at a coarser display resolution.
export const FILE_LOUDNESS_HISTORY_MAX_SAMPLES = 4 * 60 * 60 * 10;
export const FILE_VISUAL_HISTORY_MAX_SAMPLES = 4 * 60 * 60 * 25;

/** @param {number | null | undefined} durationMs */
export function fileHistoryCapacities(durationMs) {
  // A missing container duration must not turn into silent front truncation. In that uncommon
  // case the native worker keeps base-cadence checkpoints and the chunked frontend stores grow
  // with the decoded programme; an actual resource failure remains explicit.
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return {
      loudness: Number.MAX_SAFE_INTEGER,
      visual: Number.MAX_SAFE_INTEGER,
    };
  }
  return {
    loudness: FILE_LOUDNESS_HISTORY_MAX_SAMPLES,
    visual: FILE_VISUAL_HISTORY_MAX_SAMPLES,
  };
}

export function useFileAnalysisEngine({
  enabled,
  filePath,
  runId,
  settings,
  probe = null,
  audioRef,
  defaultSampleRateRef,
  intake,
  sessionId,
  updateFileSession,
  setAnalyzingFileId,
  display,
  shouldDriveDisplay,
  fileAnalysisAcceptanceRef,
}) {
  const { frameRef, selectedOffsetRef, latestAudioRef, setAudio, raiseNotice } = display;
  const activeRunRef = useRef(null);

  const stop = useCallback(async () => {
    const run = activeRunRef.current;
    if (!run) return;
    run.cancelled = true;
    if (run.startPromise) {
      await run.startPromise.catch(() => {});
      await stopFileAnalysis();
    }
    const acceptance = fileAnalysisAcceptanceRef?.current.get(run.sessionId);
    fileAnalysisAcceptanceRef?.current.delete(run.sessionId);
    acceptance?.reject(new Error("File analysis was cancelled before acceptance"));
  }, [fileAnalysisAcceptanceRef]);

  useEffect(() => {
    if (!enabled || !sessionId || !filePath || runId <= 0) return;
    if (!isTauri()) {
      raiseNotice("error", "Error: File analysis runs in the desktop app");
      updateFileSession(sessionId, (current) => ({ ...current, state: "empty" }));
      const acceptance = fileAnalysisAcceptanceRef?.current.get(sessionId);
      fileAnalysisAcceptanceRef?.current.delete(sessionId);
      if (acceptance) {
        const error = /** @type {Error & { sessionId?: any, stage?: string }} */ (
          new Error("File analysis runs in the desktop app")
        );
        error.sessionId = sessionId;
        error.stage = "availability";
        acceptance.reject(error);
      }
      return;
    }

    let mounted = true;
    const token = `${sessionId}:${runId}`;
    const task = { cancelled: false, startPromise: null, sessionId };
    activeRunRef.current = task;
    const active = () => mounted && !task.cancelled && activeRunRef.current === task;
    const unsubs = [];
    const attemptAudioRef = { current: { ...INITIAL_METER_AUDIO } };
    let completed = null;
    let receivedSequence = 0;
    let terminal = false;
    const publishCompletion = () => {
      if (!active() || terminal || !completed) return;
      if (Number.isFinite(completed.finalSequence) && receivedSequence < completed.finalSequence)
        return;
      terminal = true;
      const payload = completed;
      updateFileSession(sessionId, (current) => ({
        ...current,
        state: "complete",
        progress: 1,
        decodedFrames: payload.decodedFrames,
        summary: payload.summary,
        audio: attemptAudioRef.current,
        dialogueDetectionError: payload.summary?.dialogueDetectionError,
        analyzedAt: Date.now(),
      }));
      setAnalyzingFileId((current) => (current === sessionId ? null : current));
      const acceptance = fileAnalysisAcceptanceRef?.current.get(sessionId);
      fileAnalysisAcceptanceRef?.current.delete(sessionId);
      acceptance?.resolve();
    };
    const accepts = (payload) =>
      active() && !terminal && payload?.runId === token && payload.path === filePath;
    const listen = async (registration) => {
      const unsubscribe = await registration;
      if (active()) unsubs.push(unsubscribe);
      else unsubscribe?.();
    };

    const run = async () => {
      let stage = "probe";
      try {
        intake.reset();
        frameRef.current = 0;
        setAnalyzingFileId(sessionId);
        const metadata = probe ?? (await probeFileAnalysis(filePath));
        if (!active()) return;
        defaultSampleRateRef.current = metadata.selectedTrack?.sampleRateHz || 48000;
        updateFileSession(sessionId, (current) => ({
          ...current,
          state: "analyzing",
          path: filePath,
          fileName: metadata.fileName,
          metadata: current.successfulResult ? current.metadata : metadata,
          attempt: current.attempt ? { ...current.attempt, metadata } : current.attempt,
          progress: 0,
          error: undefined,
          dialogueDetectionError: undefined,
          summary: current.successfulResult?.summary,
        }));

        await listen(
          onFileAnalysisProgress((payload) => {
            if (!accepts(payload)) return;
            updateFileSession(sessionId, (current) => ({
              ...current,
              state: "analyzing",
              progress: Number.isFinite(payload.progress) ? payload.progress : current.progress,
            }));
          })
        );
        await listen(
          onFileAnalysisCompleted((payload) => {
            if (!accepts(payload)) return;
            completed = payload;
            publishCompletion();
          })
        );
        await listen(
          onFileAnalysisError((payload) => {
            if (!accepts(payload)) return;
            terminal = true;
            const acceptance = fileAnalysisAcceptanceRef?.current.get(sessionId);
            fileAnalysisAcceptanceRef?.current.delete(sessionId);
            acceptance?.reject(new Error(payload.message));
            updateFileSession(sessionId, (current) => ({
              ...current,
              state: "error",
              error: payload.message,
              analyzedAt: Date.now(),
            }));
            setAnalyzingFileId((current) => (current === sessionId ? null : current));
            raiseNotice("error", `Error: ${payload.message}`, undefined, {
              requiresAttention: true,
            });
          })
        );
        if (!active()) return;

        const historyCapacities = fileHistoryCapacities(metadata.durationMs);
        const { applyFrame } = buildTauriFrameApply({
          histMaxSamples: historyCapacities.loudness,
          visualMaxSamples: historyCapacities.visual,
          intake,
          frameRef,
          defaultSampleRateRef,
          setAudio: (next) => {
            if (!shouldDriveDisplay()) return;
            latestAudioRef.current = next;
            if (selectedOffsetRef.current < 0) setAudio(next);
          },
          latestAudioRef: attemptAudioRef,
          ackFrames: () => {},
          shouldDriveDisplay: () => true,
          onDialogueDetectionError: (code, message) => {
            updateFileSession(sessionId, (current) => ({
              ...current,
              dialogueDetectionError: code,
            }));
            raiseNotice("error", `Error: ${message}`, code, { requiresAttention: true });
          },
        });
        stage = "start";
        task.startPromise = startFileAnalysis({
          path: filePath,
          probe: metadata,
          runId: token,
          settings,
          onFrame: (frame) => {
            if (!active() || terminal) return;
            applyFrame(frame);
            if (Number.isFinite(frame.seq))
              receivedSequence = Math.max(receivedSequence, frame.seq);
            publishCompletion();
          },
        });
        const channel = await task.startPromise;
        if (!active()) return;
        audioRef.current = { mode: "file", channel, unsubs };
        const acceptance = fileAnalysisAcceptanceRef?.current.get(sessionId);
        fileAnalysisAcceptanceRef?.current.delete(sessionId);
        acceptance?.resolve();
      } catch (err) {
        if (!active() || terminal) return;
        terminal = true;
        const message = err?.message || "File analysis unavailable";
        updateFileSession(sessionId, (current) => ({
          ...current,
          state: "error",
          path: filePath,
          error: message,
          analyzedAt: Date.now(),
        }));
        setAnalyzingFileId((current) => (current === sessionId ? null : current));
        raiseNotice("error", `Error: ${message}`, undefined, { requiresAttention: true });
        const acceptance = fileAnalysisAcceptanceRef?.current.get(sessionId);
        fileAnalysisAcceptanceRef?.current.delete(sessionId);
        if (acceptance) {
          const failure = /** @type {Error & { sessionId?: any, stage?: any }} */ (
            err instanceof Error ? err : new Error(message)
          );
          failure.sessionId = sessionId;
          failure.stage = stage;
          acceptance.reject(failure);
        }
      }
    };

    run();
    return () => {
      mounted = false;
      task.cancelled = true;
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
