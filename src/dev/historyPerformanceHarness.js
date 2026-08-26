const DEFAULT_SCALAR_ROWS = 144_000;
const DEFAULT_VISUAL_ROWS = 360_000;
const SCALAR_CADENCE_MS = 100;
const VISUAL_CADENCE_MS = 40;
const DEFAULT_SPECTRUM_KEY = "spectrum:pair:0:1:combined:sp25:tilt300:smoff";
const DEFAULT_VECTORSCOPE_KEY = "vectorscope:pair:0:1";
// Speed 50 matches the Stereo Map panel's actual default (panelControls.js's stereoMapSpeedPercent
// default is 50, not 25 like Spectrum's) -- this key would not match a default panel otherwise.
const DEFAULT_STEREO_MAP_KEY = "stereoMap:pair:0:1:sp50:sm12";

function defaultScheduler() {
  const requestIdle =
    typeof window.requestIdleCallback === "function"
      ? (callback) => window.requestIdleCallback(callback)
      : (callback) =>
          window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }));
  const cancelIdle =
    typeof window.cancelIdleCallback === "function"
      ? (id) => window.cancelIdleCallback(id)
      : (id) => window.clearTimeout(id);
  return {
    requestIdleCallback: requestIdle,
    cancelIdleCallback: cancelIdle,
    setInterval: (callback, delay) => window.setInterval(callback, delay),
    clearInterval: (id) => window.clearInterval(id),
  };
}

function scalarRow(index, timestampMs) {
  const phase = index / 19;
  const left = 0.45 + Math.sin(phase) * 0.1;
  const right = 0.4 + Math.cos(phase) * 0.1;
  return {
    timestampMs,
    lufsMomentary: -20 + Math.sin(phase),
    lufsShortTerm: -22 + Math.cos(phase / 2),
    lufsMMax: -18,
    lufsStMax: -20,
    integrated: -23,
    lra: 5,
    dialogueIntegrated: -24,
    dialogueLra: 3,
    dialoguePercent: 70,
    dialogueActiveNow: index % 4 !== 0,
    truePeakL: -1,
    truePeakR: -1.5,
    truePeakMaxDbtp: -1,
    sampleLDb: -3,
    sampleRDb: -3.5,
    samplePeakMaxL: -2.5,
    samplePeakMaxR: -3,
    waveformMin: [-left, -right],
    waveformMax: [left, right],
    waveformSubPairs: new Float32Array(0),
    waveformSubCount: 0,
    rmsDb: [-24, -25],
    correlation: 0.75,
    sideToMidDb: -8,
    vectorscopePairX: 0,
    vectorscopePairY: 1,
    peakDb: [-6, -7],
    peakHoldDb: [-5, -6],
  };
}

function meterAudioFromScalarRow(row) {
  return {
    peakDb: row.peakDb,
    rmsDb: row.rmsDb,
    peakHoldDb: row.peakHoldDb,
    momentary: row.lufsMomentary,
    shortTerm: row.lufsShortTerm,
    integrated: row.integrated,
    mMax: row.lufsMMax,
    stMax: row.lufsStMax,
    lra: row.lra,
    tpL: row.sampleLDb,
    tpR: row.sampleRDb,
    truePeakL: row.truePeakL,
    truePeakR: row.truePeakR,
    tpMax: row.truePeakMaxDbtp,
    samplePeakMaxL: row.samplePeakMaxL,
    samplePeakMaxR: row.samplePeakMaxR,
    sampleL: row.sampleLDb,
    sampleR: row.sampleRDb,
    samplePeak: row.truePeakMaxDbtp,
    correlation: row.correlation,
    sideToMidDb: row.sideToMidDb,
    vectorscopePairX: row.vectorscopePairX,
    vectorscopePairY: row.vectorscopePairY,
    dialogueIntegrated: row.dialogueIntegrated,
    dialogueLra: row.dialogueLra,
    dialoguePercent: row.dialoguePercent,
    dialogueActiveNow: row.dialogueActiveNow,
  };
}

function visualPayload(fullVisual) {
  // Full mode intentionally represents the production payload: at 360k rows, 958 Spectrum
  // bands plus 200 Vectorscope floats retain roughly 1.3 GiB+ before object/chunk overhead.
  // Stereo Map shares the 958-band grid but stores three Float32 primitive planes (pl, pr, c)
  // per row instead of one, so its own full-mode retention is deliberately larger still.
  const bandCount = fullVisual ? 958 : 1;
  const pairValueCount = fullVisual ? 200 : 2;
  const bandCentersHz = Array.from({ length: bandCount }, (_, index) => 20 * 2 ** (index / 96));
  const smoothDb = new Float32Array(bandCount).fill(-30);
  const pairs = new Float32Array(pairValueCount);
  for (let index = 0; index < pairValueCount; index += 2) {
    pairs[index] = 0.25;
    pairs[index + 1] = 0.5;
  }
  const stereoMapBandCentersHz = new Float32Array(bandCentersHz);
  const stereoMapPl = new Float32Array(bandCount).fill(0.2);
  const stereoMapPr = new Float32Array(bandCount).fill(0.25);
  const stereoMapC = new Float32Array(bandCount).fill(0.05);
  return {
    bandCentersHz,
    smoothDb,
    pairs,
    stereoMapBandCentersHz,
    stereoMapPl,
    stereoMapPr,
    stereoMapC,
  };
}

// Keys not derived from a real workspace (deriveRetainedAnalysisKeys) are not in the retained set,
// so the visual-history sweep evicts them a grace period in and that family's measurement silently
// reports on an empty slab thereafter. Warn once per family instead of lying quietly -- this
// harness is the tool used to validate the eviction fix itself, so a hobbled run should be loud.
const warnedEmptyKeyFamilies = new Set();

function keyedEntries(keys, fallbackKey, value, familyLabel) {
  if (!keys?.length) {
    if (!warnedEmptyKeyFamilies.has(familyLabel)) {
      warnedEmptyKeyFamilies.add(familyLabel);
      console.warn(
        `[historyPerformanceHarness] no ${familyLabel}Keys supplied; synthesizing under the ` +
          `default key "${fallbackKey}". Unless a real ${familyLabel} panel with matching ` +
          `controls is open, that key is not in the retained set and the visual-history sweep ` +
          `will evict it after the grace period -- pass ${familyLabel}Keys derived from a real ` +
          `workspace to measure this family accurately.`
      );
    }
    return { [fallbackKey]: value };
  }
  return Object.fromEntries(keys.map((key) => [key, value]));
}

function visualRow(timestampMs, payload, spectrumKeys, vectorscopeKeys, stereoMapKeys) {
  return {
    timestampMs,
    waveformMin: [],
    waveformMax: [],
    spectrumByKey: keyedEntries(
      spectrumKeys,
      DEFAULT_SPECTRUM_KEY,
      {
        bandCentersHz: payload.bandCentersHz,
        smoothDb: payload.smoothDb,
      },
      "spectrum"
    ),
    vectorscopeByKey: keyedEntries(
      vectorscopeKeys,
      DEFAULT_VECTORSCOPE_KEY,
      {
        pairs: payload.pairs,
        correlation: 0.75,
        sideToMidDb: -8,
        midEnergy: 0.5,
        sideEnergy: 0.2,
      },
      "vectorscope"
    ),
    stereoMapByKey: keyedEntries(
      stereoMapKeys,
      DEFAULT_STEREO_MAP_KEY,
      {
        bandCentersHz: payload.stereoMapBandCentersHz,
        pl: payload.stereoMapPl,
        pr: payload.stereoMapPr,
        c: payload.stereoMapC,
      },
      "stereoMap"
    ),
  };
}

function progressReporter(onProgress, globalTarget) {
  return (progress, cancel) => {
    onProgress?.(progress);
    if (!globalTarget) return;
    globalTarget.__PLVS_HISTORY_PERF__ = { ...progress, cancel };
    if (typeof globalTarget.dispatchEvent === "function" && typeof CustomEvent === "function") {
      globalTarget.dispatchEvent(
        new CustomEvent("plvs-history-perf-progress", { detail: progress })
      );
    }
  };
}

export function seedHistoryPerformance({
  intake,
  publishAudio,
  onProgress,
  scalarRows = DEFAULT_SCALAR_ROWS,
  visualRows = DEFAULT_VISUAL_ROWS,
  fullVisual = false,
  spectrumKeys,
  vectorscopeKeys,
  stereoMapKeys,
  scheduler = defaultScheduler(),
  scalarBatchSize = 1_000,
  visualBatchSize = 2_000,
  globalTarget = typeof window === "undefined" ? null : window,
} = {}) {
  if (!intake?.pushHistRow || !intake?.pushVisualHistRow) {
    throw new TypeError("history performance harness requires a FrameIntake-compatible intake");
  }

  let cancelled = false;
  let idleId = null;
  let scalarCompleted = 0;
  let visualCompleted = 0;
  let settleDone;
  const payload = visualPayload(fullVisual);
  const total = scalarRows + visualRows;
  const requestIdle =
    scheduler.requestIdleCallback?.bind(scheduler) ??
    ((callback) =>
      scheduler.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 0));
  const cancelIdle =
    scheduler.cancelIdleCallback?.bind(scheduler) ?? scheduler.clearTimeout?.bind(scheduler);
  const done = new Promise((resolve) => {
    settleDone = resolve;
  });
  const report = progressReporter(onProgress, globalTarget);

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    if (idleId != null) cancelIdle(idleId);
    idleId = null;
    report(
      {
        phase: "cancelled",
        completed: scalarCompleted + visualCompleted,
        total,
        fullVisual,
      },
      cancel
    );
    settleDone({ cancelled: true, scalarCompleted, visualCompleted });
  };

  const schedule = (callback) => {
    idleId = requestIdle(callback);
  };
  const runVisualBatch = () => {
    idleId = null;
    if (cancelled) return;
    const end = Math.min(visualRows, visualCompleted + visualBatchSize);
    while (visualCompleted < end) {
      intake.pushVisualHistRow(
        visualRow(
          visualCompleted * VISUAL_CADENCE_MS,
          payload,
          spectrumKeys,
          vectorscopeKeys,
          stereoMapKeys
        ),
        Math.max(1, visualRows)
      );
      visualCompleted += 1;
    }
    report({ phase: "visual", completed: visualCompleted, total: visualRows, fullVisual }, cancel);
    if (cancelled) return;
    if (visualCompleted < visualRows) {
      schedule(runVisualBatch);
      return;
    }
    report({ phase: "complete", completed: total, total, fullVisual }, cancel);
    if (cancelled) return;
    settleDone({ cancelled: false, scalarCompleted, visualCompleted });
  };
  const runScalarBatch = () => {
    idleId = null;
    if (cancelled) return;
    const end = Math.min(scalarRows, scalarCompleted + scalarBatchSize);
    let latest = null;
    while (scalarCompleted < end) {
      latest = scalarRow(scalarCompleted, scalarCompleted * SCALAR_CADENCE_MS);
      intake.pushHistRow(latest, Math.max(1, scalarRows));
      scalarCompleted += 1;
    }
    if (latest) publishAudio?.(meterAudioFromScalarRow(latest));
    report({ phase: "scalar", completed: scalarCompleted, total: scalarRows, fullVisual }, cancel);
    if (cancelled) return;
    schedule(scalarCompleted < scalarRows ? runScalarBatch : runVisualBatch);
  };

  schedule(scalarRows > 0 ? runScalarBatch : runVisualBatch);
  return {
    done,
    cancel,
    updateRequestKeys(next = {}) {
      spectrumKeys = next.spectrumKeys;
      vectorscopeKeys = next.vectorscopeKeys;
      stereoMapKeys = next.stereoMapKeys;
    },
  };
}

export function startHistoryPerformanceHarness(options = {}) {
  const scheduler = options.scheduler ?? defaultScheduler();
  const scalarRows = options.scalarRows ?? DEFAULT_SCALAR_ROWS;
  const visualRows = options.visualRows ?? DEFAULT_VISUAL_ROWS;
  let liveIntervalId = null;
  let cancelled = false;
  let visualTimestampMs = visualRows * VISUAL_CADENCE_MS;
  let nextScalarTimestampMs = scalarRows * SCALAR_CADENCE_MS;
  let liveScalarIndex = scalarRows;
  let spectrumKeys = options.spectrumKeys;
  let vectorscopeKeys = options.vectorscopeKeys;
  let stereoMapKeys = options.stereoMapKeys;
  const payload = visualPayload(options.fullVisual ?? false);
  const scalarCapacity = Math.max(1, scalarRows);
  const visualCapacity = Math.max(1, visualRows);
  const seed = seedHistoryPerformance({ ...options, scheduler, scalarRows, visualRows });

  const seeded = seed.done.then((result) => {
    if (result.cancelled || cancelled) return result;
    liveIntervalId = scheduler.setInterval(() => {
      if (cancelled) return;
      options.intake.pushVisualHistRow(
        visualRow(visualTimestampMs, payload, spectrumKeys, vectorscopeKeys, stereoMapKeys),
        visualCapacity
      );
      while (visualTimestampMs >= nextScalarTimestampMs) {
        const row = scalarRow(liveScalarIndex, nextScalarTimestampMs);
        options.intake.pushHistRow(row, scalarCapacity);
        options.publishAudio?.(meterAudioFromScalarRow(row));
        liveScalarIndex += 1;
        nextScalarTimestampMs += SCALAR_CADENCE_MS;
      }
      visualTimestampMs += VISUAL_CADENCE_MS;
    }, VISUAL_CADENCE_MS);
    return result;
  });

  return {
    seeded,
    updateRequestKeys(next = {}) {
      spectrumKeys = next.spectrumKeys;
      vectorscopeKeys = next.vectorscopeKeys;
      stereoMapKeys = next.stereoMapKeys;
      seed.updateRequestKeys(next);
    },
    cancel() {
      if (cancelled) return;
      cancelled = true;
      seed.cancel();
      if (liveIntervalId != null) scheduler.clearInterval(liveIntervalId);
      liveIntervalId = null;
    },
  };
}
