import { useEffect, useRef } from "react";
import {
  listAudioDevices,
  previewAudioDevice,
  startAudioCapture,
  stopAudioCapture,
  setLoudnessWeights,
  setDialogueGating,
  ackFrames,
} from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";
import { resolveDevice, buildDeviceStatus } from "../lib/audioEngineCommands.js";

const CLEARED_AUDIO_STATE = {
  peakDb: [],
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
  vectorscopePairX: 0,
  vectorscopePairY: 1,
  dialogueIntegrated: -Infinity,
  dialogueLra: 0,
  dialoguePercent: null,
  dialogueActiveNow: false,
};

export function useAudioEngine({
  running,
  captureDeviceId = "default",
  /** When channels/default rate change for the active device, bumps to restart WASAPI/session (e.g. Windows speaker layout). */
  captureFormatSignature = "",
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  rafRef,
  frameRef,
  intake,
  selectedOffsetRef,
  loudnessWeightsRef,
  dialogueGatingRef,
  setAudio,
  setHistoryPathM,
  setHistoryPathST,
  setStatus,
  setStatus2,
  setRunning,
  setSelectedOffset,
  resetTimer,
  setShowClock,
}) {
  const defaultSampleRateRef = useRef(48000);

  const clearLocalMeterStateForRestart = () => {
    intake.reset();
    frameRef.current = 0;
    selectedOffsetRef.current = -1;
    setSelectedOffset(-1);
    setHistoryPathM("");
    setHistoryPathST("");
    setAudio({ ...CLEARED_AUDIO_STATE });
    resetTimer?.({ restart: true });
    setShowClock?.(true);
  };

  /**
   * Start/stop native or browser audio capture. Dependency list is intentionally narrow:
   * - `running`, `captureDeviceId`, `captureFormatSignature` are the only
   *   inputs that should restart the engine when they change.
   * - All `*Ref` arguments are mutable boxes read inside the effect; their **identities** are
   *   stable (useRef), and the effect reads `.current` on each run — listing them would
   *   not change behavior but would force redundant teardown/restart.
   * - `setStatus`, `setRunning`, etc. are React state setters with stable identity; including
   *   them is redundant. If a future caller passed an unstable inline setter, stale closures
   *   would be a bug in the caller, not fixed by widening this array.
   */
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!running) {
      if (audioRef.current?.mode === "tauri") {
        void stopAudioCapture();
        for (const u of audioRef.current?.unsubs || []) {
          try {
            u();
          } catch (_) {}
        }
      }
      if (audioRef.current) {
        try {
          audioRef.current.stream?.getTracks()?.forEach((t) => t.stop());
        } catch (_) {}
        try {
          audioRef.current.ctx?.close();
        } catch (_) {}
      }
      audioRef.current = null;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    if (isTauri() && audioRef.current?.mode === "tauri") {
      clearLocalMeterStateForRestart();
    }
    let mounted = true;
    const init = async () => {
      try {
        if (isTauri()) {
          setStatus("Starting system audio capture…");
          const devices = await listAudioDevices();
          if (!mounted) return;
          if (!devices?.length) {
            throw new Error("No input devices reported by the native engine");
          }
          const { device: resolvedDevice, isAutomatic } = resolveDevice(devices, captureDeviceId);

          let engineDeviceId;
          let statusMain;
          let deviceStatusLabel;

          if (isAutomatic) {
            const preview = await previewAudioDevice("default");
            if (!mounted) return;
            defaultSampleRateRef.current = preview.sampleRateHz || 48000;
            engineDeviceId = "default";
            statusMain = "Monitoring system playback (loopback)";
            deviceStatusLabel = preview.label;
          } else {
            defaultSampleRateRef.current = resolvedDevice.defaultSampleRate || 48000;
            engineDeviceId = resolvedDevice.id;
            ({ statusMain, deviceStatusLabel } = buildDeviceStatus(resolvedDevice));
          }

          const unsubs = [];
          const { applyFrame: baseApply } = buildTauriFrameApply({
            histMaxSamples,
            visualMaxSamples,
            intake,
            frameRef,
            selectedOffsetRef,
            defaultSampleRateRef,
            setAudio,
            setHistoryPathM,
            setHistoryPathST,
            ackFrames: (seq) => {
              void ackFrames(seq);
            },
          });
          const applyFrame = (f) => {
            if (!mounted) return;
            baseApply(f);
          };

          try {
            await setLoudnessWeights(loudnessWeightsRef?.current ?? null);
          } catch (_) {}

          try {
            await setDialogueGating(dialogueGatingRef?.current ?? false);
          } catch (_) {}

          await startAudioCapture({
            deviceId: engineDeviceId,
            onFrame: applyFrame,
          });
          if (!mounted) return;
          audioRef.current = { mode: "tauri", unsubs };
          setStatus(statusMain);
          setStatus2(`Device: ${deviceStatusLabel}`);
          return;
        }

        setRunning(false);
        setSelectedOffset(-1);
        setStatus(
          "Browser preview: metering runs in the desktop app (Rust DSP). Use `npm run tauri dev`."
        );
        setStatus2("Device: Not connected");
      } catch (err) {
        setRunning(false);
        setSelectedOffset(-1);
        setStatus(`Error: ${err?.message || "Audio unavailable"}`);
        setStatus2("Device: Not connected");
      }
    };
    init();
    return () => {
      mounted = false;
      const rafId = rafRef.current;
      if (rafId) cancelAnimationFrame(rafId);
      if (audioRef.current?.mode === "tauri") {
        void stopAudioCapture();
        for (const u of audioRef.current?.unsubs || []) {
          try {
            u();
          } catch (_) {}
        }
      }
      if (audioRef.current) {
        try {
          audioRef.current.stream?.getTracks()?.forEach((t) => t.stop());
        } catch (_) {}
        try {
          audioRef.current.ctx?.close();
        } catch (_) {}
      }
    };
  }, [running, captureDeviceId, captureFormatSignature]);
  /* eslint-enable react-hooks/exhaustive-deps */
}
