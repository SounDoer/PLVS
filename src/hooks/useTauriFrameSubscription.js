import { useEffect, useId, useRef } from "react";
import { meterAddFrameSubscriber, meterRemoveFrameSubscriber } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { onLoudnessSlow, onSampleRateChanged } from "../ipc/events.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";

/**
 * Extra webview: attach to the same native frame stream as the main window (no second `audio_start`).
 * @param {boolean} engineRunning
 * @param {object} rest same wiring as {@link buildTauriFrameApply} + `histMaxSamples`
 */
export function useTauriFrameSubscription(
  engineRunning,
  {
    histMaxSamples,
    loudnessHistRef,
    spectrumDataRef,
    spectrumDataSnapRef,
    spectrumSnapRef,
    vectorSnapRef,
    corrSnapRef,
    audioSnapRef,
    frameRef,
    selectedOffsetRef,
    histRef,
    setAudio,
    setSpectrumPath,
    setSpectrumPeakPath,
    setVectorPath,
    setHistoryPathM,
    setHistoryPathST,
    /** @type {import("react").MutableRefObject<number> | undefined} */
    defaultSampleRateRef: passedSampleRateRef,
    /** When false, do not listen for 2Hz loudness-slow; peak/spectrum/vector floats do not need it. */
    loudnessSlow = true,
  }
) {
  const internalSampleRateRef = useRef(48000);
  const defaultSampleRateRef = passedSampleRateRef ?? internalSampleRateRef;
  const subscriptionId = `float-${useId().replace(/:/g, "")}`;

  useEffect(() => {
    if (!isTauri() || !engineRunning) return undefined;
    let cancelled = false;
    let unlistenSlow = () => {};
    let unlistenSr = () => {};

    const run = async () => {
      const { applyFrame } = buildTauriFrameApply({
        histMaxSamples,
        loudnessHistRef,
        spectrumDataRef,
        spectrumDataSnapRef,
        spectrumSnapRef,
        vectorSnapRef,
        corrSnapRef,
        audioSnapRef,
        frameRef,
        selectedOffsetRef,
        histRef,
        defaultSampleRateRef,
        setAudio,
        setSpectrumPath,
        setSpectrumPeakPath,
        setVectorPath,
        setHistoryPathM,
        setHistoryPathST,
      });
      if (loudnessSlow) {
        const uSlow = await onLoudnessSlow((p) => {
          if (cancelled) return;
          setAudio((prev) => ({
            ...prev,
            integrated:
              p.lufsIntegrated != null && Number.isFinite(p.lufsIntegrated)
                ? p.lufsIntegrated
                : -Infinity,
            mMax: Number.isFinite(p.lufsMMax) ? p.lufsMMax : -Infinity,
            stMax: Number.isFinite(p.lufsStMax) ? p.lufsStMax : -Infinity,
            lra: Number.isFinite(p.lra) ? p.lra : -Infinity,
          }));
        });
        unlistenSlow = uSlow;
      } else {
        unlistenSlow = () => {};
      }
      unlistenSr = await onSampleRateChanged((sr) => {
        if (cancelled || !Number.isFinite(sr)) return;
        defaultSampleRateRef.current = sr;
      });
      try {
        await meterAddFrameSubscriber(subscriptionId, {
          onFrame: (f) => {
            if (!cancelled) applyFrame(f);
          },
        });
      } catch (_) {
        /* engine may have stopped between get_engine_state and subscribe */
      }
    };

    void run();
    return () => {
      cancelled = true;
      unlistenSlow();
      unlistenSr();
      void meterRemoveFrameSubscriber(subscriptionId);
    };
    // subscriptionId is stable for the instance; refs are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    engineRunning,
    histMaxSamples,
    loudnessSlow,
    setAudio,
    setSpectrumPath,
    setSpectrumPeakPath,
    setVectorPath,
    setHistoryPathM,
    setHistoryPathST,
  ]);
}
