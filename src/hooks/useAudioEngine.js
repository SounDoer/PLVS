import { useEffect, useRef, useState } from "react";
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
import { onEngineBackpressure, onEngineStateChanged, onMixCaptureStatus } from "../ipc/events.js";
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
  dialogueLra: -Infinity,
  dialoguePercent: null,
  dialogueActiveNow: false,
  dialogueDetectionError: null,
};

const CAPTURE_RECOVERY_STABILITY_MS = 2_000;
const CAPTURE_INVALIDATION_RETRY_LIMIT = 3;
const CAPTURE_INVALIDATION_RETRY_STEP_MS = 300;

/**
 * @param {{
 *   captureDeviceId?: string,
 *   captureFormatSignature?: string,
 *   mixApplicationIds?: string[],
 *   mixOutputId?: string,
 *   mixCaptureInputs?: { id: string, channels: number[] }[],
 *   mixRouting?: { roles: string[], routes: Record<string, any>, outputRoles?: string[] },
 *   mixInput?: { id: string, channels: number[] },
 *   captureDeviceUnavailable?: boolean,
 *   histMaxSamples: number,
 *   visualMaxSamples: number,
 *   audioRef: { current: any },
 *   intake: import("../lib/FrameIntake.js").FrameIntake,
 *   channelRolesRef: { current: any },
 *   dialogueGatingRef: { current: any },
 *   dialogueVadEngineRef: { current: any },
 *   transport: Pick<
 *     ReturnType<typeof import("./useCaptureTransport.js").useCaptureTransport>,
 *     "running" | "lifecycle" | "halt" | "markStarted" | "markStopped" | "markStopFailed" | "recordAudioDrop"
 *   >,
 *   display: any,
 *   defaultSampleRateRef: { current: any },
 *   measurementOwner?: any,
 *   continuationRef?: { current: { deviceId: string, format: string, continuable: boolean } | null },
 * }} options
 */
export function useAudioEngine({
  captureDeviceId = "default",
  mixApplicationIds,
  mixInput,
  mixOutputId,
  mixCaptureInputs,
  mixRouting,
  /** When channels/default rate change for the active device, bumps to restart WASAPI/session (e.g. Windows speaker layout). */
  captureFormatSignature = "",
  captureDeviceUnavailable = false,
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
  continuationRef = null,
}) {
  const { running, lifecycle, halt, markStarted, markStopped, markStopFailed, recordAudioDrop } =
    transport;
  const stopInFlightRef = useRef(Promise.resolve());
  const {
    frameRef,
    selectedOffsetRef,
    latestAudioRef,
    setAudio,
    setSelectedOffset,
    raiseNotice,
    beginMixCapture,
    updateMixCapture,
    setShowClock,
    clock: { resetTimer, stopTimer },
  } = display;
  const internalDefaultSampleRateRef = useRef(48000);
  const defaultSampleRateRef = externalDefaultSampleRateRef ?? internalDefaultSampleRateRef;
  const histMaxSamplesRef = useRef(histMaxSamples);
  const visualMaxSamplesRef = useRef(visualMaxSamples);
  const [recoveryRevision, setRecoveryRevision] = useState(0);
  const recoveryAttemptsRef = useRef(0);
  const recoveryPendingRef = useRef(false);
  const recoveryRearmAtRef = useRef(0);

  useEffect(() => {
    histMaxSamplesRef.current = histMaxSamples;
    visualMaxSamplesRef.current = visualMaxSamples;
  }, [histMaxSamples, visualMaxSamples]);

  // A normal transport/device/configuration transition starts a new recovery budget. An automatic
  // recovery changes only `recoveryRevision`. The budget resets after the replacement has delivered
  // healthy frames for a short stability window.
  useEffect(() => {
    recoveryAttemptsRef.current = 0;
    recoveryPendingRef.current = false;
    recoveryRearmAtRef.current = 0;
  }, [running, captureDeviceId, captureFormatSignature]);

  const clearLocalMeterStateForRestart = () => {
    intake.reset();
    frameRef.current = 0;
    selectedOffsetRef.current = -1;
    setSelectedOffset(-1);
    setAudio({ ...CLEARED_AUDIO_STATE });
    resetTimer?.({ restart: true });
    setShowClock?.(true);
  };

  // Only capture, source, format, and recovery changes should restart the native stream.
  // History capacities and capture settings are read from refs without restarting this effect.
  // `defaultSampleRateRef` may be a ref lifted from the parent (shared with the file-analysis
  // engine); writing its `.current` inside the effect is the intended ref-box mutation, so the
  // immutability rule is disabled here alongside exhaustive-deps.
  /* eslint-disable react-hooks/exhaustive-deps, react-hooks/immutability */
  useEffect(() => {
    if (!running) {
      const stopResult = stopInFlightRef.current;
      const endedSession = audioRef.current?.mode === "tauri";
      let mounted = true;
      void stopResult
        .then(() => {
          if (!mounted) return;
          if (audioRef.current?.mode === "tauri") audioRef.current = null;
          // Stop pauses: the next Start of this Source continues the measurement. A failure ends it.
          if (endedSession && continuationRef) {
            continuationRef.current = {
              deviceId: captureDeviceId,
              format: captureFormatSignature,
              continuable: lifecycle !== "error",
            };
          }
          if (lifecycle !== "error") markStopped?.();
        })
        .catch((error) => {
          if (mounted) markStopFailed?.(error);
        });
      return () => {
        mounted = false;
      };
    }
    const continuation = continuationRef?.current ?? null;
    if (continuationRef) continuationRef.current = null;
    const continueSession =
      continuation?.continuable === true &&
      continuation.deviceId === captureDeviceId &&
      continuation.format === captureFormatSignature;
    if (isTauri() && audioRef.current?.mode === "tauri" && !captureDeviceUnavailable) {
      clearLocalMeterStateForRestart();
    } else if (continuation && !continueSession && !captureDeviceUnavailable) {
      // A different Source or format, or a failed session, starts a fresh measurement: the
      // retained history must not suggest that it continues.
      clearLocalMeterStateForRestart();
    }
    let mounted = true;
    let disconnected = false;
    let recoveryScheduled = false;
    let recoveryTimer;
    let nativeStart = null;
    let meter = null;
    const unsubs = [];
    const releaseListeners = () => {
      for (const unlisten of unsubs.splice(0)) {
        try {
          unlisten();
        } catch (_) {}
      }
    };
    const stopForDisconnectedSource = () => {
      disconnected = true;
      halt(new Error("Source Disconnected"));
      stopTimer?.();
      setSelectedOffset(-1);
      raiseNotice(
        "warning",
        mixRouting === null ? "Mix Routing Needs Attention" : "Source Disconnected",
        mixRouting === null
          ? "Open the Mix editor and choose valid channel routes, then select Start."
          : "Reconnect the device or choose another in Sources, then select Start.",
        { requiresAttention: true, helpTopic: "audio-capture" }
      );
    };
    if (captureDeviceUnavailable) {
      stopForDisconnectedSource();
      return;
    }
    const init = async () => {
      try {
        await stopInFlightRef.current;
        if (!mounted) return;
        if (isTauri()) {
          const applicationId = /^app-[0-9a-f]{32}$/.test(captureDeviceId) ? captureDeviceId : null;
          const devices = mixApplicationIds ? [] : await listAudioDevices();
          if (!mounted) return;
          const resolved =
            applicationId || mixApplicationIds
              ? { device: { id: captureDeviceId, defaultSampleRate: 48_000 }, isAutomatic: false }
              : resolveDevice(devices ?? [], captureDeviceId);
          const { device: resolvedDevice, isAutomatic } = resolved;
          if (!resolvedDevice) {
            if (isAutomatic) throw new Error("No input devices reported by the native engine");
            stopForDisconnectedSource();
            return;
          }

          let engineDeviceId;
          if (mixApplicationIds) {
            defaultSampleRateRef.current = 48_000;
            engineDeviceId = "default";
          } else if (applicationId) {
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
            onDialogueDetectionError: (code, message) =>
              raiseNotice(
                "error",
                `Error: ${message}`,
                `Detector: ${dialogueVadEngineRef?.current ?? DEFAULT_DIALOGUE_VAD_ENGINE}; ${code}`,
                { requiresAttention: true, helpTopic: "dialogue-detection" }
              ),
          });
          const applyFrame = (f) => {
            if (!mounted || disconnected || recoveryScheduled) return;
            if (recoveryPendingRef.current) {
              recoveryPendingRef.current = false;
              recoveryRearmAtRef.current = Date.now() + CAPTURE_RECOVERY_STABILITY_MS;
              raiseNotice("info", "Audio configuration changed — measurement restarted");
            } else if (recoveryRearmAtRef.current > 0 && Date.now() >= recoveryRearmAtRef.current) {
              recoveryAttemptsRef.current = 0;
              recoveryRearmAtRef.current = 0;
            }
            baseApply(f);
          };

          await setChannelRoles(channelRolesRef?.current ?? null);
          await setDialogueGating(dialogueGatingRef?.current ?? false);
          await setDialogueVadEngine(dialogueVadEngineRef?.current ?? DEFAULT_DIALOGUE_VAD_ENGINE);

          if (!mounted || disconnected) return;
          // Subscribed before start: a capture can fail right after `audio_start` returns, or
          // later (stall, device loss). Without this the UI keeps showing LIVE over a frozen meter.
          unsubs.push(
            await onEngineStateChanged((payload) => {
              if (!mounted || disconnected || recoveryScheduled || payload?.state !== "error")
                return;
              meter?.closeMeterResets();
              if (payload.reason === "deviceDisconnected" && !isAutomatic && !applicationId) {
                stopForDisconnectedSource();
                return;
              }
              const message = payload.error || "Audio capture stopped";
              const invalidated = payload.reason === "deviceInvalidated";
              const retryLimit = invalidated ? CAPTURE_INVALIDATION_RETRY_LIMIT : 1;
              if (
                (invalidated || payload.reason === "deviceDisconnected") &&
                recoveryAttemptsRef.current < retryLimit
              ) {
                // Give Windows progressively more time to settle if it invalidates the replacement.
                const delay = recoveryAttemptsRef.current * CAPTURE_INVALIDATION_RETRY_STEP_MS;
                recoveryAttemptsRef.current += 1;
                recoveryPendingRef.current = true;
                recoveryRearmAtRef.current = 0;
                recoveryScheduled = true;
                const restart = () => setRecoveryRevision((revision) => revision + 1);
                if (delay === 0) restart();
                else recoveryTimer = window.setTimeout(restart, delay);
                return;
              }
              halt(new Error(message));
              stopTimer?.();
              setSelectedOffset(-1);
              raiseNotice("error", `Error: ${message}`, undefined, {
                requiresAttention: true,
                helpTopic:
                  payload.reason === "systemSpeakerLayout"
                    ? "system-output-speaker-layout"
                    : payload.reason === "outputInUse"
                      ? "output-in-use"
                      : "audio-capture",
              });
            })
          );
          if (!mounted || disconnected) {
            releaseListeners();
            return;
          }
          unsubs.push(
            await onEngineBackpressure((payload) => {
              if (mounted) recordAudioDrop?.(payload?.droppedChunks);
            })
          );

          if (!mounted || disconnected) {
            releaseListeners();
            return;
          }
          beginMixCapture?.(mixApplicationIds ? captureDeviceId : null, continueSession);
          if (mixApplicationIds) {
            unsubs.push(
              await onMixCaptureStatus((payload) => {
                if (mounted && payload && Array.isArray(payload.unavailable)) {
                  updateMixCapture?.(captureDeviceId, payload);
                }
              })
            );
          }
          if (!mounted || disconnected) {
            releaseListeners();
            return;
          }
          measurementOwner?.beginSession();
          try {
            nativeStart = startAudioCapture({
              deviceId: engineDeviceId,
              ...(applicationId ? { applicationId } : {}),
              ...(mixApplicationIds ? { mixApplicationIds } : {}),
              ...(mixInput ? { mixInput } : {}),
              ...(mixOutputId ? { mixOutputId } : {}),
              ...(mixCaptureInputs ? { mixInputs: mixCaptureInputs } : {}),
              ...(mixRouting ? { mixRouting } : {}),
              continueSession,
              onFrame: applyFrame,
            });
            meter = await nativeStart;
          } catch (error) {
            releaseListeners();
            measurementOwner?.abortSession();
            throw error;
          }
          if (!mounted || disconnected || recoveryScheduled) {
            meter?.closeMeterResets();
            releaseListeners();
            measurementOwner?.abortSession();
            return;
          }
          measurementOwner?.commitSession();
          audioRef.current = { mode: "tauri", unsubs, meter };
          // Automatic captures the OS default route, not the row resolveDevice picked as a
          // fallback, so report the policy rather than a physical device the engine never opened.
          markStarted?.({
            resolvedDeviceId: isAutomatic ? "default" : (resolvedDevice.id ?? engineDeviceId),
          });
          return;
        }

        halt(new Error("Browser preview does not provide audio capture."));
        setSelectedOffset(-1);
        raiseNotice(
          "error",
          "Error: Browser preview: metering runs in the desktop app. Use `npm run desktop:dev`."
        );
      } catch (err) {
        releaseListeners();
        if (!mounted || disconnected || recoveryScheduled) return;
        halt(err);
        setSelectedOffset(-1);
        raiseNotice("error", `Error: ${err?.message || "Audio unavailable"}`, undefined, {
          requiresAttention: true,
          helpTopic: "audio-capture",
        });
      }
    };
    init();
    return () => {
      mounted = false;
      window.clearTimeout(recoveryTimer);
      meter?.closeMeterResets();
      releaseListeners();
      if (nativeStart) {
        // A stop or replacement must wait for this exact native start, even before it is visible.
        const stopped = nativeStart.then(
          () => stopAudioCapture(),
          () => {}
        );
        stopInFlightRef.current = stopped;
        const releaseBarrier = () => {
          if (stopInFlightRef.current === stopped) stopInFlightRef.current = Promise.resolve();
        };
        void stopped.then(releaseBarrier, releaseBarrier);
      }
    };
  }, [
    running,
    captureDeviceId,
    mixApplicationIds,
    mixInput,
    mixOutputId,
    mixCaptureInputs,
    mixRouting,
    beginMixCapture,
    updateMixCapture,
    captureFormatSignature,
    captureDeviceUnavailable,
    recoveryRevision,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/immutability */
}
