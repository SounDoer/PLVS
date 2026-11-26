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
 *   captureApplicationUnavailable?: boolean,
 *   histMaxSamples: number,
 *   visualMaxSamples: number,
 *   audioRef: { current: any },
 *   intake: import("../lib/FrameIntake.js").FrameIntake,
 *   channelRolesRef: { current: any },
 *   dialogueGatingRef: { current: any },
 *   dialogueVadEngineRef: { current: any },
 *   transport: Pick<
 *     ReturnType<typeof import("./useCaptureTransport.js").useCaptureTransport>,
 *     "running" | "lifecycle" | "halt" | "markStarted" | "markStopped" | "markStopFailed" | "markSourceWaiting" | "recordAudioDrop"
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
  captureApplicationUnavailable = false,
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
  const {
    running,
    lifecycle,
    halt,
    markStarted,
    markStopped,
    markStopFailed,
    markSourceWaiting,
    recordAudioDrop,
  } = transport;
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
  /** @type {{ current: { deviceId: string, endpointKey: string | null, input: boolean } | null }} */
  const activeDeviceRef = useRef(null);
  /** @type {{ current: { deviceId: string, endpointKey: string | null, input: boolean, retryAt: number, started: boolean, reason: string } | null }} */
  const deviceRecoveryRef = useRef(null);
  /** @type {{ current: { id: string, waiting: boolean } | null }} */
  const applicationRef = useRef(null);

  useEffect(() => {
    histMaxSamplesRef.current = histMaxSamples;
    visualMaxSamplesRef.current = visualMaxSamples;
  }, [histMaxSamples, visualMaxSamples]);

  // A normal transport/device/configuration transition starts a new recovery budget. An automatic
  // recovery changes only `recoveryRevision`. The budget resets after the replacement has delivered
  // healthy frames for a short stability window.
  useEffect(() => {
    if (!running || applicationRef.current?.id !== captureDeviceId) applicationRef.current = null;
    if (activeDeviceRef.current?.deviceId !== captureDeviceId || !running)
      activeDeviceRef.current = null;
    if (running && deviceRecoveryRef.current?.deviceId === captureDeviceId) return;
    recoveryAttemptsRef.current = 0;
    recoveryPendingRef.current = false;
    recoveryRearmAtRef.current = 0;
    deviceRecoveryRef.current = null;
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
      const continuable = lifecycle !== "error" && audioRef.current?.continuable !== false;
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
              continuable,
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
    const application = applicationRef.current;
    if (captureApplicationUnavailable && application) {
      application.waiting = true;
      if (audioRef.current?.mode === "tauri") audioRef.current.continuable = false;
      stopTimer?.();
      markSourceWaiting?.();
      raiseNotice(
        "info",
        "Selected Application Unavailable",
        "Live is waiting for the selected application to return."
      );
      return;
    }
    const rebindingApplication = application?.waiting === true;
    if (rebindingApplication) recoveryPendingRef.current = true;
    const continuation = continuationRef?.current ?? null;
    if (continuationRef) continuationRef.current = null;
    const retrying = recoveryPendingRef.current;
    const continueSession =
      !retrying &&
      continuation?.continuable === true &&
      continuation.deviceId === captureDeviceId &&
      continuation.format === captureFormatSignature;
    const clearAfterSourceCheck =
      !retrying &&
      !captureDeviceUnavailable &&
      ((isTauri() && audioRef.current?.mode === "tauri") || (continuation && !continueSession));
    let mounted = true;
    let disconnected = false;
    let recoveryScheduled = false;
    let recoveryTimer;
    let streamId;
    let opening = false;
    let nativeStart = null;
    let meter = null;
    const unsubs = [];
    const liveAudio = { mode: "tauri", unsubs, meter: null, continuable: !retrying };
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
      if (!recoveryPendingRef.current) stopTimer?.();
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
    const stopForCaptureFailure = (message, reason) => {
      disconnected = true;
      halt(new Error(message));
      if (!recoveryPendingRef.current) stopTimer?.();
      setSelectedOffset(-1);
      const details = {
        permissionDenied:
          "Allow PLVS to access this source in your system settings, then select Start.",
        unsupportedFormat:
          "Check the device's sample rate and channel configuration or select another Source.",
        audioServiceInterrupted: "Check that system audio is available again, then select Start.",
      }[reason];
      raiseNotice("error", `Error: ${message}`, details, {
        requiresAttention: true,
        helpTopic:
          reason === "systemSpeakerLayout"
            ? "system-output-speaker-layout"
            : reason === "outputInUse"
              ? "output-in-use"
              : "audio-capture",
      });
    };
    const recoveringDevice = () => deviceRecoveryRef.current?.deviceId === captureDeviceId;
    const recoveringStalledInput = () =>
      recoveringDevice() && deviceRecoveryRef.current?.reason === "inputCallbackStalled";
    const scheduleRecovery = (reason, device = null) => {
      const retryLimit = [
        "inputMissing",
        "inputStreamInvalidated",
        "deviceInvalidated",
        "audioServiceInterrupted",
      ].includes(reason)
        ? CAPTURE_INVALIDATION_RETRY_LIMIT
        : 1;
      if (recoveryAttemptsRef.current >= retryLimit) return false;

      const delay = recoveryAttemptsRef.current * CAPTURE_INVALIDATION_RETRY_STEP_MS;
      recoveryAttemptsRef.current += 1;
      if (!recoveryPendingRef.current) stopTimer?.();
      recoveryPendingRef.current = true;
      recoveryRearmAtRef.current = 0;
      recoveryScheduled = true;
      if (audioRef.current?.mode === "tauri") audioRef.current.continuable = false;
      if (device) {
        deviceRecoveryRef.current = {
          deviceId: device.deviceId,
          endpointKey: device.endpointKey,
          input: device.input,
          retryAt: Date.now() + delay,
          started: false,
          reason,
        };
      }
      const restart = () => setRecoveryRevision((revision) => revision + 1);
      if (delay === 0) restart();
      else recoveryTimer = window.setTimeout(restart, delay);
      return true;
    };
    if (captureDeviceUnavailable && !recoveringDevice()) {
      // Inventory can report loss before the backend error reaches the WebView.
      const device = activeDeviceRef.current;
      if (
        !device?.input ||
        device.deviceId !== captureDeviceId ||
        !scheduleRecovery("inputMissing", device)
      )
        stopForDisconnectedSource();
      return;
    }
    const init = async () => {
      const deviceRecovery = deviceRecoveryRef.current;
      if (deviceRecovery?.deviceId === captureDeviceId) deviceRecovery.started = true;
      let listing = false;
      try {
        await stopInFlightRef.current;
        if (!mounted) return;
        if (isTauri()) {
          const applicationId = /^app-[0-9a-f]{32}$/.test(captureDeviceId) ? captureDeviceId : null;
          listing = true;
          const devices = mixApplicationIds ? [] : await listAudioDevices();
          listing = false;
          if (!mounted) return;
          const resolved =
            applicationId || mixApplicationIds
              ? { device: { id: captureDeviceId, defaultSampleRate: 48_000 }, isAutomatic: false }
              : resolveDevice(devices ?? [], captureDeviceId);
          const { device: resolvedDevice, isAutomatic } = resolved;
          if (!resolvedDevice) {
            if (isAutomatic) throw new Error("No input devices reported by the native engine");
            if (
              !recoveringStalledInput() &&
              deviceRecovery &&
              scheduleRecovery(deviceRecovery.reason, deviceRecovery)
            )
              return;
            stopForDisconnectedSource();
            return;
          }
          const exactDevice =
            !isAutomatic && !applicationId && !mixApplicationIds
              ? {
                  deviceId: captureDeviceId,
                  endpointKey: resolvedDevice.endpointKey ?? null,
                  input: !resolvedDevice.isSystemOutputMonitor,
                }
              : null;
          const previousDevice = deviceRecovery ?? activeDeviceRef.current;
          if (
            exactDevice &&
            previousDevice &&
            (previousDevice.endpointKey !== exactDevice.endpointKey ||
              (deviceRecovery && !exactDevice.endpointKey))
          ) {
            stopForCaptureFailure(
              "The selected audio source changed. Select Start to retry. If that fails, reselect it in Source.",
              undefined
            );
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
          if (clearAfterSourceCheck) clearLocalMeterStateForRestart();
          // Automatic reports its policy, since the engine opens the OS default itself.
          const publishStarted = () =>
            markStarted?.({
              resolvedDeviceId: isAutomatic ? "default" : (resolvedDevice.id ?? engineDeviceId),
            });

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
            const firstFrameAfterRecovery = retrying && recoveryPendingRef.current;
            if (firstFrameAfterRecovery) {
              // Keep the previous measurement if reopening never produces a frame.
              clearLocalMeterStateForRestart();
              measurementOwner?.beginSession();
              liveAudio.continuable = true;
            }
            if (recoveryPendingRef.current) {
              recoveryPendingRef.current = false;
              recoveryRearmAtRef.current = Date.now() + CAPTURE_RECOVERY_STABILITY_MS;
              if (rebindingApplication) application.waiting = false;
              if (applicationId) {
                raiseNotice(
                  "info",
                  "Audio Capture Recovered",
                  "Capture resumed on the same application. A fresh measurement started."
                );
              } else if (recoveringDevice()) {
                raiseNotice(
                  "info",
                  "Audio Capture Recovered",
                  deviceRecovery.input
                    ? "Capture resumed on the same input. A fresh measurement started."
                    : "Capture resumed on the same output. A fresh measurement started."
                );
              } else {
                raiseNotice(
                  "info",
                  "Audio Capture Recovered",
                  "Capture resumed on the current default output. A fresh measurement started."
                );
              }
            } else if (recoveryRearmAtRef.current > 0 && Date.now() >= recoveryRearmAtRef.current) {
              recoveryAttemptsRef.current = 0;
              recoveryRearmAtRef.current = 0;
              deviceRecoveryRef.current = null;
            }
            baseApply(f);
            if (firstFrameAfterRecovery) {
              measurementOwner?.commitSession();
              publishStarted();
            }
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
              if (payload.streamId !== undefined && payload.streamId !== streamId) return;
              meter?.closeMeterResets();
              const message = payload.error || "Audio capture stopped";
              if (recoveringStalledInput()) {
                if (payload.reason === "deviceDisconnected") stopForDisconnectedSource();
                else stopForCaptureFailure(message, payload.reason);
                return;
              }
              if (
                payload.reason === "inputCallbackStalled" &&
                exactDevice?.input &&
                scheduleRecovery(payload.reason, exactDevice)
              )
                return;
              if (
                recoveringDevice() &&
                payload.reason === "deviceDisconnected" &&
                scheduleRecovery(deviceRecoveryRef.current.reason, deviceRecoveryRef.current)
              )
                return;
              if (payload.reason === "deviceDisconnected" && !isAutomatic && !applicationId) {
                stopForDisconnectedSource();
                return;
              }
              if (
                (payload.reason === "deviceInvalidated" ||
                  payload.reason === "inputStreamInvalidated" ||
                  payload.reason === "audioServiceInterrupted" ||
                  payload.reason === "deviceDisconnected") &&
                scheduleRecovery(payload.reason, exactDevice)
              )
                return;
              stopForCaptureFailure(message, payload.reason);
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
          if (!retrying) measurementOwner?.beginSession();
          try {
            opening = true;
            nativeStart = startAudioCapture({
              deviceId: engineDeviceId,
              ...(exactDevice?.endpointKey && { endpointKey: exactDevice.endpointKey }),
              ...(retrying && { recoveryAttempt: recoveryAttemptsRef.current }),
              onStreamId: (id) => {
                streamId = id;
              },
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
            opening = false;
          } catch (error) {
            releaseListeners();
            if (!retrying) measurementOwner?.abortSession();
            throw error;
          }
          if (!mounted || disconnected || recoveryScheduled) {
            meter?.closeMeterResets();
            releaseListeners();
            if (!retrying) measurementOwner?.abortSession();
            return;
          }
          if (!retrying) measurementOwner?.commitSession();
          activeDeviceRef.current = exactDevice;
          if (applicationId && !rebindingApplication)
            applicationRef.current = { id: applicationId, waiting: false };
          liveAudio.meter = meter;
          audioRef.current = liveAudio;
          if (!retrying) publishStarted();
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
        const message = err?.message || "Audio unavailable";
        if (
          (listing || opening) &&
          deviceRecovery &&
          !recoveringStalledInput() &&
          scheduleRecovery(deviceRecovery.reason, deviceRecovery)
        ) {
          return;
        }
        stopForCaptureFailure(message, undefined);
      }
    };
    // An inventory-driven rerender can replace the retry effect before its timer fires.
    const deviceRecovery = deviceRecoveryRef.current;
    const retryDelay =
      deviceRecovery?.deviceId === captureDeviceId ? deviceRecovery.retryAt - Date.now() : 0;
    if (recoveringDevice() && recoveryPendingRef.current && deviceRecovery?.started) {
      // If the old effect had already begun opening the source, this is a new attempt.
      if (!scheduleRecovery(deviceRecovery.reason, deviceRecovery)) {
        if (captureDeviceUnavailable) stopForDisconnectedSource();
        else
          stopForCaptureFailure(
            "Capture stopped: the selected input did not stabilize.",
            undefined
          );
      }
      return () => window.clearTimeout(recoveryTimer);
    }
    if (retryDelay > 0) recoveryTimer = window.setTimeout(init, retryDelay);
    else void init();
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
    captureApplicationUnavailable,
    recoveryRevision,
  ]);
  /* eslint-enable react-hooks/exhaustive-deps, react-hooks/immutability */
}
