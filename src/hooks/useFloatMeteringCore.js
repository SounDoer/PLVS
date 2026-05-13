import { useCallback, useEffect, useRef, useState } from "react";
import { getMeterHistory } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { onMeterHistoryCleared } from "../ipc/events.js";
import { useSettings } from "./useSettings";
import { useSnapshot } from "./useSnapshot";
import { useTauriFrameSubscription } from "./useTauriFrameSubscription";
import { useFloatEngineState } from "./useFloatEngineState";
import { seedFloatHistoryFromRows } from "../lib/floatHistorySeed.js";
import { resetFloatMeteringState } from "../lib/resetFloatMeteringState.js";

const HIST_MAX_SAMPLES = 36000;
const HIST_SAMPLE_SEC = 0.1;

const initialAudio = () => ({
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
});

/**
 * @param {string} [floatKind] Panel from `?float=…` (e.g. "loudness"). Used to avoid extra Tauri/IPC in non-loudness floats.
 */
export function useFloatMeteringCore(floatKind) {
  const noopSetHistoryM = useCallback(() => {}, []);
  const noopSetHistoryST = useCallback(() => {}, []);
  const { referenceProfileId, resolvedThemeId } = useSettings();
  const engineRunning = useFloatEngineState();
  const [selectedOffset, setSelectedOffset] = useState(-1);
  const [historyViewEpoch, setHistoryViewEpoch] = useState(0);
  const [audio, setAudio] = useState(initialAudio);
  const [spectrumPath, setSpectrumPath] = useState("");
  const [spectrumPeakPath, setSpectrumPeakPath] = useState("");
  const [vectorPath, setVectorPath] = useState("");

  const defaultSampleRateRef = useRef(48000);
  const frameRef = useRef(0);
  const histRef = useRef([]);
  const loudnessHistRef = useRef([]);
  const spectrumSnapRef = useRef([]);
  const spectrumDataRef = useRef(null);
  const spectrumDataSnapRef = useRef([]);
  const vectorSnapRef = useRef([]);
  const corrSnapRef = useRef([]);
  const audioSnapRef = useRef([]);
  const selectedOffsetRef = useRef(-1);

  useTauriFrameSubscription(engineRunning, {
    histMaxSamples: HIST_MAX_SAMPLES,
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
    setHistoryPathM: noopSetHistoryM,
    setHistoryPathST: noopSetHistoryST,
    defaultSampleRateRef,
    loudnessSlow: floatKind === "loudness",
  });

  useEffect(() => {
    if (!isTauri() || !engineRunning) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const rows = await getMeterHistory();
        if (cancelled || !rows || rows.length === 0) return;
        // Let one frame paint (live `meter` frames) before we start the chunked seed (see
        // `floatHistorySeed.js` — rAF between batches to avoid a single long jank).
        await new Promise((r) => {
          requestAnimationFrame(r);
        });
        if (cancelled) return;
        await seedFloatHistoryFromRows(rows, {
          histMaxSamples: HIST_MAX_SAMPLES,
          defaultSampleRate: defaultSampleRateRef.current,
          loudnessHistRef,
          spectrumDataRef,
          spectrumDataSnapRef,
          spectrumSnapRef,
          vectorSnapRef,
          corrSnapRef,
          audioSnapRef,
          histRef,
          setAudio,
          setSpectrumPath,
          setSpectrumPeakPath,
          setVectorPath,
          isCancelled: () => cancelled,
        });
      } catch {
        /* not running or backend empty */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [engineRunning]);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let u = () => {};
    void onMeterHistoryCleared(() => {
      resetFloatMeteringState({
        frameRef,
        selectedOffsetRef,
        histRef,
        loudnessHistRef,
        spectrumDataRef,
        spectrumDataSnapRef,
        spectrumSnapRef,
        vectorSnapRef,
        corrSnapRef,
        audioSnapRef,
        setAudio,
        setSpectrumPath,
        setSpectrumPeakPath,
        setVectorPath,
        setSelectedOffset,
      });
      setHistoryViewEpoch((e) => e + 1);
    }).then((un) => {
      u = un;
    });
    return () => {
      u();
    };
  }, []);

  const {
    displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    displayVectorPath,
    hasHistoryData,
    histSourceList,
    correlation,
  } = useSnapshot({
    selectedOffset,
    sampleSec: HIST_SAMPLE_SEC,
    loudnessHistRef,
    spectrumSnapRef,
    spectrumDataRef,
    spectrumDataSnapRef,
    vectorSnapRef,
    corrSnapRef,
    audioSnapRef,
    audio,
    spectrumPath,
    spectrumPeakPath,
    vectorPath,
  });

  useEffect(() => {
    selectedOffsetRef.current = selectedOffset;
  }, [selectedOffset]);

  return {
    engineRunning,
    referenceProfileId,
    resolvedThemeId,
    HIST_SAMPLE_SEC,
    selectedOffset,
    setSelectedOffset,
    displayAudio,
    displaySpectrumPath,
    displaySpectrumPeakPath,
    displaySpectrumData,
    displayVectorPath,
    hasHistoryData,
    histSourceList,
    correlation,
    historyViewEpoch,
  };
}
