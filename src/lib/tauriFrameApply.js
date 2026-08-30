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
    stereoMapResultsByKey:
      frame.stereoMapResultsByKey && typeof frame.stereoMapResultsByKey === "object"
        ? frame.stereoMapResultsByKey
        : (previous.stereoMapResultsByKey ?? {}),
    dialogueIntegrated: Number.isFinite(frame.dialogueIntegrated)
      ? frame.dialogueIntegrated
      : -Infinity,
    dialogueLra: Number.isFinite(frame.dialogueLra) ? frame.dialogueLra : 0,
    dialoguePercent: Number.isFinite(frame.dialoguePercent) ? frame.dialoguePercent : null,
    dialogueActiveNow: !!frame.dialogueActiveNow,
  };
}

/**
 * Resolves the frame's band grid against a per-session cache and writes it onto every band row the
 * frame carries -- Spectrum's and Stereo Map's, which sit on the same grid by construction.
 *
 * The grid is ~958 frequencies that depend on nothing but the sample rate, so the engine sends it
 * only when it changes and once a second after that, and stamps every frame with its id. A frame
 * whose id we have no grid for is one whose grid-carrying frame the bridge dropped: its band rows
 * are removed rather than plotted, and the next resend restores them. Panels already treat a
 * missing per-key result as "no frame yet", which is exactly the right reading.
 *
 * @param {object} frame the deserialised payload, mutated in place
 * @param {{ id: number, centers: number[] | null }} cache
 */
export function applyBandGrid(frame, cache) {
  const id = frame.bandGridId;
  const sent = frame.bandGridCentersHz;
  if (Array.isArray(sent) && sent.length > 0) {
    cache.id = id;
    cache.centers = sent;
  }
  const centers = cache.centers && cache.id === id ? cache.centers : null;

  const stamp = (byKey) => {
    if (!byKey || typeof byKey !== "object") return byKey;
    if (!centers) return {};
    for (const entry of Object.values(byKey)) {
      if (entry && typeof entry === "object") entry.bandCentersHz = centers;
    }
    return byKey;
  };

  frame.spectrumResultsByKey = stamp(frame.spectrumResultsByKey);
  frame.stereoMapResultsByKey = stamp(frame.stereoMapResultsByKey);
  if (frame.visualHistTick) {
    stamp(frame.visualHistTick.spectrumByKey);
    stamp(frame.visualHistTick.stereoMapByKey);
  }
  if (Array.isArray(frame.visualHistBatch)) {
    for (const tick of frame.visualHistBatch) {
      stamp(tick?.spectrumByKey);
      stamp(tick?.stereoMapByKey);
    }
  }
  return frame;
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
  // One cache per handler: a new capture session builds a new handler, and the grid cannot outlive
  // the sample rate that produced it.
  const bandGrid = { id: 0, centers: null };
  const applyFrame = (f) => {
    frameRef.current += 1;
    applyBandGrid(f, bandGrid);
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
