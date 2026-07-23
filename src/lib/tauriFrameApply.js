import { SPECTRUM_SETTINGS } from "../config/scales.js";

function currentValue(value) {
  return value && typeof value === "object" && "current" in value ? value.current : value;
}

export function reduceMeterAudioFrame(previous, frame) {
  const m = Number.isFinite(frame.lufsMomentary) ? frame.lufsMomentary : -Infinity;
  const st = Number.isFinite(frame.lufsShortTerm) ? frame.lufsShortTerm : -Infinity;
  return {
    ...previous,
    peakDb: Array.isArray(frame.peakDb) ? frame.peakDb : previous.peakDb,
    rmsDb: Array.isArray(frame.rmsDb) ? frame.rmsDb : (previous.rmsDb ?? []),
    peakHoldDb: Array.isArray(frame.peakHoldDb) ? frame.peakHoldDb : previous.peakHoldDb,
    momentary: m,
    shortTerm: st,
    mMax: Number.isFinite(frame.lufsMMax) ? frame.lufsMMax : -Infinity,
    stMax: Number.isFinite(frame.lufsStMax) ? frame.lufsStMax : -Infinity,
    integrated: Number.isFinite(frame.integrated) ? frame.integrated : -Infinity,
    lra: Number.isFinite(frame.lra) ? frame.lra : -Infinity,
    truePeakL: Number.isFinite(frame.truePeakL) ? frame.truePeakL : -Infinity,
    truePeakR: Number.isFinite(frame.truePeakR) ? frame.truePeakR : -Infinity,
    samplePeak: Number.isFinite(frame.truePeakMaxDbtp) ? frame.truePeakMaxDbtp : -Infinity,
    tpMax: Number.isFinite(frame.truePeakMaxDbtp) ? frame.truePeakMaxDbtp : -Infinity,
    tpL: Number.isFinite(frame.sampleLDb) ? frame.sampleLDb : -Infinity,
    tpR: Number.isFinite(frame.sampleRDb) ? frame.sampleRDb : -Infinity,
    sampleL: Number.isFinite(frame.sampleLDb) ? frame.sampleLDb : -Infinity,
    sampleR: Number.isFinite(frame.sampleRDb) ? frame.sampleRDb : -Infinity,
    samplePeakMaxL: Number.isFinite(frame.sampleLDb)
      ? Math.max(previous.samplePeakMaxL, frame.sampleLDb)
      : previous.samplePeakMaxL,
    samplePeakMaxR: Number.isFinite(frame.sampleRDb)
      ? Math.max(previous.samplePeakMaxR, frame.sampleRDb)
      : previous.samplePeakMaxR,
    correlation: Number.isFinite(frame.correlation) ? frame.correlation : -Infinity,
    sideToMidDb: Number.isFinite(frame.sideToMidDb) ? frame.sideToMidDb : -Infinity,
    vectorscopePairX: Number.isFinite(frame.vectorscopePairX)
      ? frame.vectorscopePairX
      : (previous.vectorscopePairX ?? 0),
    vectorscopePairY: Number.isFinite(frame.vectorscopePairY)
      ? frame.vectorscopePairY
      : (previous.vectorscopePairY ?? 1),
    spectrumResultsByKey:
      frame.spectrumResultsByKey && typeof frame.spectrumResultsByKey === "object"
        ? frame.spectrumResultsByKey
        : (previous.spectrumResultsByKey ?? {}),
    vectorscopeResultsByKey:
      frame.vectorscopeResultsByKey && typeof frame.vectorscopeResultsByKey === "object"
        ? frame.vectorscopeResultsByKey
        : (previous.vectorscopeResultsByKey ?? {}),
    dialogueIntegrated: Number.isFinite(frame.dialogueIntegrated)
      ? frame.dialogueIntegrated
      : -Infinity,
    dialogueLra: Number.isFinite(frame.dialogueLra) ? frame.dialogueLra : 0,
    dialoguePercent: Number.isFinite(frame.dialoguePercent) ? frame.dialoguePercent : null,
    dialogueActiveNow: !!frame.dialogueActiveNow,
  };
}

/**
 * Shared Tauri `AudioFramePayload` handler.
 * @param {object} opts
 * @param {number | import("react").MutableRefObject<number>} opts.histMaxSamples
 * @param {number | import("react").MutableRefObject<number>} opts.visualMaxSamples
 * @param {import("./FrameIntake.js").FrameIntake} opts.intake
 * @param {import("react").MutableRefObject<number>} opts.frameRef
 * @param {import("react").MutableRefObject<number | undefined>} opts.defaultSampleRateRef
 */
export function buildTauriFrameApply({
  histMaxSamples,
  visualMaxSamples,
  intake,
  frameRef,
  defaultSampleRateRef,
  setAudio,
  latestAudioRef,
  ackFrames,
  // Gate the shared live-display write so a background analysis (one whose session is not the
  // active/displayed one) keeps filling its own intake and acking the bridge without hijacking the
  // shared `audio` state that the non-scrub panels render from. Defaults to always-on for live mode.
  shouldDriveDisplay = () => true,
  shouldPublishDisplay = () => true,
}) {
  const applyFrame = (f) => {
    frameRef.current += 1;
    // Heartbeat the native engine ~10Hz with the latest processed seq so it can bound its send
    // backlog. Reaching this line proves the UI thread is draining frames; if it stalls, acks stop
    // and the bridge drops frames instead of letting the host process grow unboundedly.
    if (ackFrames && frameRef.current % 6 === 0 && Number.isFinite(f.seq)) {
      ackFrames(f.seq);
    }
    const defaultSampleRate = defaultSampleRateRef.current ?? 48000;

    intake.pushFrame(
      f,
      currentValue(histMaxSamples),
      defaultSampleRate,
      SPECTRUM_SETTINGS.freeze,
      currentValue(visualMaxSamples)
    );

    if (!shouldDriveDisplay()) return;

    const next = reduceMeterAudioFrame(latestAudioRef.current, f);
    latestAudioRef.current = next;
    if (!shouldPublishDisplay()) return;
    setAudio(next);
  };

  return { applyFrame };
}
