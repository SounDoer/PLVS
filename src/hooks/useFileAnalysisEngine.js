import { useCallback, useEffect, useRef } from "react";
import { probeFileAnalysis, startFileAnalysis, stopFileAnalysis } from "../ipc/commands.js";
import {
  onFileAnalysisCompleted,
  onFileAnalysisError,
  onFileAnalysisProgress,
} from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";

export function useFileAnalysisEngine({
  enabled,
  filePath,
  runId,
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  intake,
  setFileSession,
  setAudio,
  setHistoryPathM,
  setHistoryPathST,
  setSelectedOffset,
  setStatus,
}) {
  const activePathRef = useRef(null);

  const stop = useCallback(async () => {
    await stopFileAnalysis();
    setFileSession((current) => ({
      state: current.fileName ? "ready" : "empty",
      fileName: current.fileName,
      path: current.path,
      metadata: current.metadata,
    }));
  }, [setFileSession]);

  useEffect(() => {
    if (!enabled || !filePath) return;
    if (!isTauri()) {
      setStatus("File analysis runs in the desktop app");
      setFileSession({ state: "empty" });
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
        setHistoryPathM("");
        setHistoryPathST("");
        setStatus("Probing file...");
        const metadata = await probeFileAnalysis(filePath);
        if (!mounted) return;
        defaultSampleRateRef.current = metadata.selectedTrack?.sampleRateHz || 48000;
        setFileSession({
          state: "analyzing",
          path: filePath,
          fileName: metadata.fileName,
          metadata,
          progress: 0,
        });
        setStatus(`Analyzing ${metadata.fileName}`);

        unsubs.push(
          await onFileAnalysisProgress((payload) => {
            if (payload?.path !== activePathRef.current) return;
            setFileSession((current) => ({
              ...current,
              state: "analyzing",
              progress: Number.isFinite(payload.progress) ? payload.progress : current.progress,
            }));
          })
        );
        unsubs.push(
          await onFileAnalysisCompleted((payload) => {
            if (payload?.path !== activePathRef.current) return;
            setFileSession((current) => ({
              ...current,
              state: "complete",
              decodedFrames: payload.decodedFrames,
              summary: payload.summary,
            }));
            setStatus("File analysis complete");
          })
        );
        unsubs.push(
          await onFileAnalysisError((payload) => {
            if (payload?.path !== activePathRef.current) return;
            setFileSession((current) => ({
              ...current,
              state: "error",
              error: payload.message,
            }));
            setStatus(`Error: ${payload.message}`);
          })
        );

        const { applyFrame } = buildTauriFrameApply({
          histMaxSamples,
          visualMaxSamples,
          intake,
          frameRef,
          selectedOffsetRef,
          defaultSampleRateRef,
          setAudio,
          setHistoryPathM,
          setHistoryPathST,
          ackFrames: () => {},
        });
        const channel = await startFileAnalysis({
          path: filePath,
          onFrame: (frame) => {
            if (mounted) applyFrame(frame);
          },
        });
        audioRef.current = { mode: "file", channel, unsubs };
      } catch (err) {
        if (!mounted) return;
        const message = err?.message || "File analysis unavailable";
        setFileSession({ state: "error", path: filePath, error: message });
        setStatus(`Error: ${message}`);
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
    // `runId` is in the dependency list so REANALYZE (same path, incremented runId) re-runs the
    // effect and re-decodes the file from disk.
  }, [enabled, filePath, runId]);

  return { stop };
}
