import { useEffect, useRef } from "react";
import {
  listAudioDevices,
  previewAudioDevice,
  startAudioCapture,
  stopAudioCapture,
  setChannelRoles,
  setDialogueGating,
  setDialogueVadEngine,
  ackFrames,
} from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { onEngineBackpressure, onEngineStateChanged } from "../ipc/events.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";
import { resolveDevice } from "../lib/audioEngineCommands.js";
import { DEFAULT_DIALOGUE_VAD_ENGINE } from "../settings/defaults.js";

const CLEARED_AUDIO_STATE = {
  peakDb: [],
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
  vectorscopePairX: 0,
  vectorscopePairY: 1,
  dialogueIntegrated: -Infinity,
  dialogueLra: 0,
  dialoguePercent: null,
  dialogueActiveNow: false,
};

export function useAudioEngine({
  captureDeviceId = "default",
  /** When channels/default rate change for the active device, bumps to restart WASAPI/session (e.g. Windows speaker layout). */
  captureFormatSignature = "",
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  intake,
  channelRolesRef,
  dialogueGatingRef,
  dialogueVadEngineRef,
  transport,
  display,
  defaultSampleRateRef: externalDefaultSampleRateRef,
  measurementOwner = null,
}) {
  const { running, lifecycle, halt, markStarted, markStopped, markStopFailed, recordAudioDrop } =
    transport;
  const stopInFlightRef = useRef(Promise.resolve());
  const stoppedAudioRef = useRef(null);
  const {
    frameRef,
    selectedOffsetRef,
    latestAudioRef,
    setAudio,
    setSelectedOffset,
    raiseNotice,
    setShowClock,
    clock: { resetTimer, stopTimer },
  } = display;
  const internalDefaultSampleRateRef = useRef(48000);
  const defaultSampleRateRef = externalDefaultSampleRateRef ?? internalDefaultSampleRateRef;
  const histMaxSamplesRef = useRef(histMaxSamples);
  const visualMaxSamplesRef = useRef(visualMaxSamples);

  useEffect(() => {
    histMaxSamplesRef.current = histMaxSamples;
    visualMaxSamplesRef.current = visualMaxSamples;
  }, [histMaxSamples, visualMaxSamples]);

  const clearLocalMeterStateForRestart = () => {
    intake.reset();
    frameRef.current = 0;
    selectedOffsetRef.current = -1;
    setSelectedOffset(-1);
    setAudio({ ...CLEARED_AUDIO_STATE });
    resetTimer?.({ restart: true });
    setShowClock?.(true);
  };

  /**
   * Start/stop native or browser audio capture. Dependency list is intentionally narrow:
   * - `running`, `captureDeviceId`, `captureFormatSignature`, and history ring capacities are the only
   *   inputs that should restart the engine when they change.
   * - All `*Ref` arguments are mutable boxes read inside the effect; their **identities** are
   *   stable (useRef), and the effect reads `.current` on each run — listing them would
   *   not change behavior but would force redundant teardown/restart.
   * - `raiseNotice`, `setRunning`, etc. are React state setters with stable identity; including
   *   them is redundant. The `display` wrapper object is a fresh literal each render — only its
   *   identity-stable fields are read here, so it must not be listed either. If a future caller passed an unstable inline setter, stale closures
   *   would be a bug in the caller, not fixed by widening this array.
   */
  // `defaultSampleRateRef` may be a ref lifted from the parent (shared with the file-analysis
  // engine); writing its `.current` inside the effect is the intended ref-box mutation, so the
  // immutability rule is disabled here alongside exhaustive-deps.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/immutability */
  useEffect(() => {
    if (!running) {
      const stopResult = stopInFlightRef.current;
      stopInFlightRef.current = Promise.resolve();
      if (audioRef.current) {
        try {
          audioRef.current.stream?.getTracks()?.forEach((t) => t.stop());
        } catch (_) {}
        try {
          audioRef.current.ctx?.close();
        } catch (_) {}
      }
      void stopResult
        .then(() => {
          audioRef.current = null;
          if (lifecycle !== "error") markStopped?.();
        })
        .catch((error) => markStopFailed?.(error));
      return;
    }
    if (isTauri() && audioRef.current?.mode === "tauri") {
      clearLocalMeterStateForRestart();
    }
    let mounted = true;
    const init = async () => {
      try {
        const stopResult = stopInFlightRef.current;
        stopInFlightRef.current = Promise.resolve();
        await stopResult;
        if (!mounted) return;
        if (isTauri()) {
          const applicationId = /^app-[0-9a-f]{32}$/.test(captureDeviceId) ? captureDeviceId : null;
          const devices = await listAudioDevices();
          if (!mounted) return;
          if (!applicationId && !devices?.length) {
            throw new Error("No input devices reported by the native engine");
          }
          const resolved = applicationId
            ? { device: { id: applicationId, defaultSampleRate: 48_000 }, isAutomatic: false }
            : resolveDevice(devices, captureDeviceId);
          const { device: resolvedDevice, isAutomatic } = resolved;

          let engineDeviceId;
          if (applicationId) {
            const preview = await previewAudioDevice("default");
            if (!mounted) return;
            defaultSampleRateRef.current = preview.sampleRateHz || 48_000;
            engineDeviceId = "default";
          } else if (isAutomatic) {
            const preview = await previewAudioDevice("default");
            if (!mounted) return;
            defaultSampleRateRef.current = preview.sampleRateHz || 48000;
            engineDeviceId = "default";
          } else {
            defaultSampleRateRef.current = resolvedDevice.defaultSampleRate || 48000;
            engineDeviceId = resolvedDevice.id;
          }

          const unsubs = [];
          const { applyFrame: baseApply } = buildTauriFrameApply({
            histMaxSamples: histMaxSamplesRef,
            visualMaxSamples: visualMaxSamplesRef,
            intake,
            frameRef,
            defaultSampleRateRef,
            setAudio,
            latestAudioRef,
            shouldPublishDisplay: () => selectedOffsetRef.current < 0,
            ackFrames: (seq) => {
              void ackFrames(seq);
            },
            onReducedFrame: (frame, nextAudio) =>
              measurementOwner?.capture(frame, nextAudio, {
                dialogueActive: dialogueGatingRef?.current === true,
              }),
          });
          const applyFrame = (f) => {
            if (!mounted) return;
            baseApply(f);
          };

          try {
            await setChannelRoles(channelRolesRef?.current ?? null);
          } catch (_) {}

          try {
            await setDialogueGating(dialogueGatingRef?.current ?? false);
          } catch (_) {}

          try {
            await setDialogueVadEngine(
              dialogueVadEngineRef?.current ?? DEFAULT_DIALOGUE_VAD_ENGINE
            );
          } catch (_) {}

          const releaseListeners = () => {
            for (const u of unsubs.splice(0)) u();
          };
          // Subscribed before start: a capture can fail right after `audio_start` returns, or
          // later (stall, device loss). Without this the UI keeps showing LIVE over a frozen meter.
          unsubs.push(
            await onEngineStateChanged((payload) => {
              if (!mounted || payload?.state !== "error") return;
              const message = payload.error || "Audio capture stopped";
              halt(new Error(message));
              stopTimer?.();
              setSelectedOffset(-1);
              raiseNotice("error", `Error: ${message}`);
            }),
            await onEngineBackpressure((payload) => {
              if (mounted) recordAudioDrop?.(payload?.droppedChunks);
            })
          );

          measurementOwner?.beginSession();
          try {
            await startAudioCapture({
              deviceId: engineDeviceId,
              ...(applicationId ? { applicationId } : {}),
              onFrame: applyFrame,
            });
          } catch (error) {
            releaseListeners();
            measurementOwner?.abortSession();
            throw error;
          }
          if (!mounted) {
            releaseListeners();
            measurementOwner?.abortSession();
            return;
          }
          measurementOwner?.commitSession();
          audioRef.current = { mode: "tauri", unsubs };
          markStarted?.({ resolvedDeviceId: resolvedDevice.id ?? engineDeviceId });
          return;
        }

        halt(new Error("Browser preview does not provide audio capture."));
        setSelectedOffset(-1);
        raiseNotice(
          "error",
          "Error: Browser preview: metering runs in the desktop app (Rust DSP). Use `npm run tauri dev`."
        );
      } catch (err) {
        halt(err);
        setSelectedOffset(-1);
        raiseNotice("error", `Error: ${err?.message || "Audio unavailable"}`);
      }
    };
    init();
    return () => {
      mounted = false;
      const currentAudio = audioRef.current;
      if (currentAudio?.mode === "tauri" && stoppedAudioRef.current !== currentAudio) {
        stoppedAudioRef.current = currentAudio;
        stopInFlightRef.current = Promise.resolve(stopAudioCapture());
        for (const u of currentAudio.unsubs || []) {
          try {
            u();
          } catch (_) {}
        }
      }
      if (currentAudio) {
        try {
          currentAudio.stream?.getTracks()?.forEach((t) => t.stop());
        } catch (_) {}
        try {
          currentAudio.ctx?.close();
        } catch (_) {}
      }
    };
  }, [running, captureDeviceId, captureFormatSignature, histMaxSamples, visualMaxSamples]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/immutability */
}
