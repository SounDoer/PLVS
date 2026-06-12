import { useEffect, useRef } from "react";
import {
  listAudioDevices,
  previewAudioDevice,
  startAudioCapture,
  stopAudioCapture,
  setVectorscopePair,
  setSpectrumChannel,
  setLoudnessWeights,
} from "../ipc/commands.js";
import { onLoudnessSlow } from "../ipc/events.js";
import { isTauri } from "../ipc/env.js";
import { buildTauriFrameApply } from "../lib/tauriFrameApply.js";
import { resolveDevice, buildDeviceStatus } from "../lib/audioEngineCommands.js";

export function useAudioEngine({
  running,
  captureDeviceId = "default",
  /** When channels/default rate change for the active device, bumps to restart WASAPI/session (e.g. Windows speaker layout). */
  captureFormatSignature = "",
  histMaxSamples,
  visualMaxSamples,
  audioRef,
  spectrumStateRef: _spectrumStateRef,
  spectrumTimeRef,
  rafRef,
  frameRef,
  intake,
  selectedOffsetRef,
  vectorscopePairRef,
  spectrumChannelRef,
  loudnessWeightsRef,
  setAudio,
  setSpectrumPath,
  setSpectrumPeakPath,
  setVectorPath,
  setHistoryPathM,
  setHistoryPathST,
  setStatus,
  setStatus2,
  setRunning,
  setSelectedOffset,
}) {
  const defaultSampleRateRef = useRef(48000);

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
          const uSlow = await onLoudnessSlow((p) => {
            if (!mounted) return;
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
          unsubs.push(uSlow);

          const { applyFrame: baseApply } = buildTauriFrameApply({
            histMaxSamples,
            visualMaxSamples,
            intake,
            frameRef,
            selectedOffsetRef,
            defaultSampleRateRef,
            setAudio,
            setSpectrumPath,
            setSpectrumPeakPath,
            setVectorPath,
            setHistoryPathM,
            setHistoryPathST,
          });
          const applyFrame = (f) => {
            if (!mounted) return;
            baseApply(f);
          };

          try {
            const p = vectorscopePairRef?.current ?? { x: 0, y: 1 };
            await setVectorscopePair({ x: p.x, y: p.y });
          } catch (_) {}

          try {
            const sc = spectrumChannelRef?.current ?? { type: "pair", x: 0, y: 1 };
            await setSpectrumChannel(sc);
          } catch (_) {}

          try {
            await setLoudnessWeights(loudnessWeightsRef?.current ?? null);
          } catch (_) {}

          await startAudioCapture({
            deviceId: engineDeviceId,
            onFrame: applyFrame,
          });
          if (!mounted) return;
          audioRef.current = { mode: "tauri", unsubs };
          setStatus(statusMain);
          setStatus2(`Device: ${deviceStatusLabel}`);
          spectrumTimeRef.current = performance.now() / 1000;
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
