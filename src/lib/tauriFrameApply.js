import { SPECTRUM_SETTINGS } from "../config/scales.js";

/**
 * Shared Tauri `AudioFramePayload` handler.
 * @param {object} opts
 * @param {number} opts.histMaxSamples
 * @param {number} opts.visualMaxSamples
 * @param {import("./FrameIntake.js").FrameIntake} opts.intake
 * @param {import("react").MutableRefObject<number>} opts.frameRef
 * @param {import("react").MutableRefObject<number>} opts.selectedOffsetRef
 * @param {import("react").MutableRefObject<number | undefined>} opts.defaultSampleRateRef
 */
export function buildTauriFrameApply({
  histMaxSamples,
  visualMaxSamples,
  intake,
  frameRef,
  selectedOffsetRef,
  defaultSampleRateRef,
  setAudio,
  setHistoryPathM,
  setHistoryPathST,
  ackFrames,
  // Gate the shared live-display write so a background analysis (one whose session is not the
  // active/displayed one) keeps filling its own intake and acking the bridge without hijacking the
  // shared `audio` state that the non-scrub panels render from. Defaults to always-on for live mode.
  shouldDriveDisplay = () => true,
}) {
  const applyFrame = (f) => {
    frameRef.current += 1;
    const shouldPaintUi = frameRef.current % 2 === 0;
    // Heartbeat the native engine ~10Hz with the latest processed seq so it can bound its send
    // backlog. Reaching this line proves the UI thread is draining frames; if it stalls, acks stop
    // and the bridge drops frames instead of letting the host process grow unboundedly.
    if (ackFrames && frameRef.current % 6 === 0 && Number.isFinite(f.seq)) {
      ackFrames(f.seq);
    }
    const m = Number.isFinite(f.lufsMomentary) ? f.lufsMomentary : -Infinity;
    const st = Number.isFinite(f.lufsShortTerm) ? f.lufsShortTerm : -Infinity;
    const defaultSampleRate = defaultSampleRateRef.current ?? 48000;

    intake.pushFrame(
      f,
      histMaxSamples,
      defaultSampleRate,
      SPECTRUM_SETTINGS.freeze,
      visualMaxSamples
    );

    if (!shouldDriveDisplay()) return;

    setAudio((prev) => ({
      ...prev,
      peakDb: Array.isArray(f.peakDb) ? f.peakDb : prev.peakDb,
      peakHoldDb: Array.isArray(f.peakHoldDb) ? f.peakHoldDb : prev.peakHoldDb,
      momentary: m,
      shortTerm: st,
      mMax: Number.isFinite(f.lufsMMax) ? f.lufsMMax : -Infinity,
      stMax: Number.isFinite(f.lufsStMax) ? f.lufsStMax : -Infinity,
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
      spectrumResultsByKey:
        f.spectrumResultsByKey && typeof f.spectrumResultsByKey === "object"
          ? f.spectrumResultsByKey
          : (prev.spectrumResultsByKey ?? {}),
      vectorscopeResultsByKey:
        f.vectorscopeResultsByKey && typeof f.vectorscopeResultsByKey === "object"
          ? f.vectorscopeResultsByKey
          : (prev.vectorscopeResultsByKey ?? {}),
      dialogueIntegrated: Number.isFinite(f.dialogueIntegrated) ? f.dialogueIntegrated : -Infinity,
      dialogueLra: Number.isFinite(f.dialogueLra) ? f.dialogueLra : 0,
      dialoguePercent: Number.isFinite(f.dialoguePercent) ? f.dialoguePercent : null,
      dialogueActiveNow: !!f.dialogueActiveNow,
    }));

    if (selectedOffsetRef.current < 0 && shouldPaintUi) {
      setHistoryPathM?.("");
      setHistoryPathST?.("");
    }
  };

  return { applyFrame };
}
