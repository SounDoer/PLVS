import { buildRtaBands, SPECTRUM_SETTINGS } from "../config/scales.js";

/**
 * @param {import("../ipc/types.js").MeterHistoryEntry} row
 * @param {{ defaultSampleRate?: number }} pick
 */
export function buildSpectrumDataSnapshot(row, pick) {
  const centers = row.spectrumBandCentersHz || [];
  const dbList = row.spectrumSmoothDb || [];
  const nyquist = (pick.defaultSampleRate || 48000) * 0.5;
  const minF = Math.max(20, SPECTRUM_SETTINGS.minHz || 20);
  const maxF = Math.max(minF * 1.2, Math.min(SPECTRUM_SETTINGS.maxHz || 20000, nyquist));
  const bands = buildRtaBands(minF, maxF, SPECTRUM_SETTINGS.resolution || "1/6");
  if (bands.length === dbList.length && dbList.length > 0) {
    return { bands, dbList: [...dbList] };
  }
  return {
    bands: centers.map((fc) => ({ fLow: fc, fHigh: fc, fCenter: fc })),
    dbList: [...dbList],
  };
}

/**
 * Shared Tauri `AudioFramePayload` handler (main webview and float panes).
 * @param {object} opts
 * @param {import("react").MutableRefObject<number | undefined>} opts.defaultSampleRateRef
 */
export function buildTauriFrameApply({
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
}) {
  const pick = () => ({ defaultSampleRate: defaultSampleRateRef.current ?? 48000 });

  /** @param {import("../ipc/types.js").MeterHistoryEntry} row */
  const pushHistorySnapFromRow = (row) => {
    const p = pick();
    const hm = Number.isFinite(row.lufsMomentary) ? row.lufsMomentary : -Infinity;
    const hst = Number.isFinite(row.lufsShortTerm) ? row.lufsShortTerm : -Infinity;
    loudnessHistRef.current.push({ m: hm, st: hst });
    if (loudnessHistRef.current.length > histMaxSamples) loudnessHistRef.current.shift();

    const snap = {
      momentary: hm,
      shortTerm: hst,
      integrated: Number.isFinite(row.integrated) ? row.integrated : -Infinity,
      lra: Number.isFinite(row.lra) ? row.lra : -Infinity,
      truePeakL: Number.isFinite(row.truePeakL) ? row.truePeakL : -Infinity,
      truePeakR: Number.isFinite(row.truePeakR) ? row.truePeakR : -Infinity,
      tpMax: Number.isFinite(row.truePeakMaxDbtp) ? row.truePeakMaxDbtp : -Infinity,
      samplePeak: Number.isFinite(row.truePeakMaxDbtp) ? row.truePeakMaxDbtp : -Infinity,
      tpL: Number.isFinite(row.sampleLDb) ? row.sampleLDb : -Infinity,
      tpR: Number.isFinite(row.sampleRDb) ? row.sampleRDb : -Infinity,
      sampleL: Number.isFinite(row.sampleLDb) ? row.sampleLDb : -Infinity,
      sampleR: Number.isFinite(row.sampleRDb) ? row.sampleRDb : -Infinity,
      samplePeakMaxL: Number.isFinite(row.samplePeakMaxL) ? row.samplePeakMaxL : -Infinity,
      samplePeakMaxR: Number.isFinite(row.samplePeakMaxR) ? row.samplePeakMaxR : -Infinity,
      correlation: Number.isFinite(row.correlation) ? row.correlation : -Infinity,
      vectorscopePairX: Number.isFinite(row.vectorscopePairX) ? row.vectorscopePairX : 0,
      vectorscopePairY: Number.isFinite(row.vectorscopePairY) ? row.vectorscopePairY : 1,
    };
    audioSnapRef.current.push(snap);
    if (audioSnapRef.current.length > histMaxSamples) audioSnapRef.current.shift();

    const c = Number.isFinite(row.correlation) ? row.correlation : -Infinity;
    corrSnapRef.current.push(c);
    if (corrSnapRef.current.length > histMaxSamples) corrSnapRef.current.shift();
    vectorSnapRef.current.push(row.vectorscopePath || "");
    if (vectorSnapRef.current.length > histMaxSamples) vectorSnapRef.current.shift();
    spectrumSnapRef.current.push(row.spectrumPath || "");
    if (spectrumSnapRef.current.length > histMaxSamples) spectrumSnapRef.current.shift();
    spectrumDataSnapRef.current.push(buildSpectrumDataSnapshot(row, p));
    if (spectrumDataSnapRef.current.length > histMaxSamples) spectrumDataSnapRef.current.shift();
  };

  const applyFrame = (f) => {
    frameRef.current += 1;
    const shouldPaintUi = frameRef.current % 2 === 0;
    const m = Number.isFinite(f.lufsMomentary) ? f.lufsMomentary : -Infinity;
    const st = Number.isFinite(f.lufsShortTerm) ? f.lufsShortTerm : -Infinity;
    const histTick = f.loudnessHistTick;
    const p = pick();

    setAudio((prev) => {
      const nextAudio = {
        ...prev,
        peakDb: Array.isArray(f.peakDb) ? f.peakDb : prev.peakDb,
        peakHoldDb: Array.isArray(f.peakHoldDb) ? f.peakHoldDb : prev.peakHoldDb,
        momentary: m,
        shortTerm: st,
        integrated: Number.isFinite(f.integrated) ? f.integrated : -Infinity,
        lra: Number.isFinite(f.lra) ? f.lra : -Infinity,
        truePeakL: Number.isFinite(f.truePeakL) ? f.truePeakL : -Infinity,
        truePeakR: Number.isFinite(f.truePeakR) ? f.truePeakR : -Infinity,
        samplePeak: Number.isFinite(f.truePeakMaxDbtp) ? f.truePeakMaxDbtp : -Infinity,
        tpMax: Number.isFinite(f.truePeakMaxDbtp) ? f.truePeakMaxDbtp : -Infinity,
        tpL: Number.isFinite(f.sampleLDb) ? f.sampleLDb : -Infinity,
        tpR: Number.isFinite(f.sampleRDb) ? f.sampleRDb : -Infinity,
        sampleL: Number.isFinite(f.sampleLDb) ? f.sampleLDb : -Infinity,
        sampleR: Number.isFinite(f.sampleRDb) ? f.sampleRDb : -Infinity,
        samplePeakMaxL: Number.isFinite(f.sampleLDb)
          ? Math.max(prev.samplePeakMaxL, f.sampleLDb)
          : prev.samplePeakMaxL,
        samplePeakMaxR: Number.isFinite(f.sampleRDb)
          ? Math.max(prev.samplePeakMaxR, f.sampleRDb)
          : prev.samplePeakMaxR,
        correlation: Number.isFinite(f.correlation) ? f.correlation : -Infinity,
        vectorscopePairX: Number.isFinite(f.vectorscopePairX)
          ? f.vectorscopePairX
          : (prev.vectorscopePairX ?? 0),
        vectorscopePairY: Number.isFinite(f.vectorscopePairY)
          ? f.vectorscopePairY
          : (prev.vectorscopePairY ?? 1),
      };
      if (histTick != null) {
        pushHistorySnapFromRow(histTick);
      }
      return nextAudio;
    });

    if (!SPECTRUM_SETTINGS.freeze) {
      const centers = f.spectrumBandCentersHz || [];
      const dbList = f.spectrumSmoothDb || [];
      const nyquist = (p.defaultSampleRate || 48000) * 0.5;
      const minF = Math.max(20, SPECTRUM_SETTINGS.minHz || 20);
      const maxF = Math.max(minF * 1.2, Math.min(SPECTRUM_SETTINGS.maxHz || 20000, nyquist));
      const bands = buildRtaBands(minF, maxF, SPECTRUM_SETTINGS.resolution || "1/6");
      const spectrumData =
        bands.length === dbList.length && dbList.length > 0
          ? { bands, dbList: [...dbList] }
          : {
              bands: centers.map((fc) => ({ fLow: fc, fHigh: fc, fCenter: fc })),
              dbList: [...dbList],
            };
      spectrumDataRef.current = spectrumData;
      if (selectedOffsetRef.current < 0 && shouldPaintUi) {
        setSpectrumPath(f.spectrumPath || "");
        setSpectrumPeakPath(f.spectrumPeakPath || "");
        setVectorPath(f.vectorscopePath || "");
      }
    }

    histRef.current = loudnessHistRef.current;
    if (selectedOffsetRef.current < 0 && shouldPaintUi) {
      setHistoryPathM("");
      setHistoryPathST("");
    }
  };

  return { applyFrame };
}
