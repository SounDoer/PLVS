import { buildSpectrumDataSnapshot } from "./FrameIntake.js";

/**
 * @param {import("../ipc/types.js").MeterHistoryEntry} row
 * @returns {import("../ipc/types.js").MeterHistoryEntry}
 */
function normalizeHistoryRow(row) {
  return {
    lufsMomentary: num(row.lufsMomentary ?? row.lufs_momentary),
    lufsShortTerm: num(row.lufsShortTerm ?? row.lufs_short_term),
    integrated: num(row.integrated),
    lra: num(row.lra),
    truePeakL: num(row.truePeakL ?? row.true_peak_l),
    truePeakR: num(row.truePeakR ?? row.true_peak_r),
    truePeakMaxDbtp: num(row.truePeakMaxDbtp ?? row.true_peak_max_dbtp),
    sampleLDb: num(row.sampleLdb ?? row.sampleLDb ?? row.sample_l_db),
    sampleRDb: num(row.sampleRdb ?? row.sampleRDb ?? row.sample_r_db),
    samplePeakMaxL: num(row.samplePeakMaxL ?? row.sample_peak_max_l),
    samplePeakMaxR: num(row.samplePeakMaxR ?? row.sample_peak_max_r),
    correlation: num(row.correlation),
    vectorscopePath: str(row.vectorscopePath ?? row.vectorscope_path),
    vectorscopePairX: num(row.vectorscopePairX ?? row.vectorscope_pair_x),
    vectorscopePairY: num(row.vectorscopePairY ?? row.vectorscope_pair_y),
    spectrumPath: str(row.spectrumPath ?? row.spectrum_path),
    spectrumPeakPath: str(row.spectrumPeakPath ?? row.spectrum_peak_path),
    spectrumBandCentersHz: arrNum(row.spectrumBandCentersHz ?? row.spectrum_band_centers_hz),
    spectrumSmoothDb: arrNum(row.spectrumSmoothDb ?? row.spectrum_smooth_db),
  };
}

function num(v) {
  return Number.isFinite(v) ? v : -Infinity;
}
function str(v) {
  return typeof v === "string" ? v : "";
}
function arrNum(a) {
  return Array.isArray(a) ? a : [];
}

/** Batched ring replay so one frame never runs ~36k `buildSpectrumDataSnapshot` etc. */
const SEED_ROW_BATCH = 2000;

function raf() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

/**
 * @param {object} row
 * @param {object} pick
 * @param {object} ctx
 * @param {(a: (prev: object) => object) => void} ctx.setAudio
 * @param {(s: string) => void} ctx.setSpectrumPath
 * @param {(s: string) => void} ctx.setSpectrumPeakPath
 * @param {(s: string) => void} ctx.setVectorPath
 * @param {import("./FrameIntake.js").FrameIntake} ctx.intake
 */
function finalizeSeededState(row, pick, ctx) {
  const { intake, setAudio, setSpectrumPath, setSpectrumPeakPath, setVectorPath } = ctx;
  intake.finalizeFromRow(row, pick.defaultSampleRate);
  setSpectrumPath(row.spectrumPath || "");
  setSpectrumPeakPath(row.spectrumPeakPath || "");
  setVectorPath(row.vectorscopePath || "");
  setAudio(() => ({
    momentary: Number.isFinite(row.lufsMomentary) ? row.lufsMomentary : -Infinity,
    shortTerm: Number.isFinite(row.lufsShortTerm) ? row.lufsShortTerm : -Infinity,
    integrated: Number.isFinite(row.integrated) ? row.integrated : -Infinity,
    mMax: -Infinity,
    stMax: -Infinity,
    lra: Number.isFinite(row.lra) ? row.lra : -Infinity,
    tpL: Number.isFinite(row.sampleLDb) ? row.sampleLDb : -Infinity,
    tpR: Number.isFinite(row.sampleRDb) ? row.sampleRDb : -Infinity,
    truePeakL: Number.isFinite(row.truePeakL) ? row.truePeakL : -Infinity,
    truePeakR: Number.isFinite(row.truePeakR) ? row.truePeakR : -Infinity,
    tpMax: Number.isFinite(row.truePeakMaxDbtp) ? row.truePeakMaxDbtp : -Infinity,
    samplePeakMaxL: Number.isFinite(row.samplePeakMaxL) ? row.samplePeakMaxL : -Infinity,
    samplePeakMaxR: Number.isFinite(row.samplePeakMaxR) ? row.samplePeakMaxR : -Infinity,
    sampleL: Number.isFinite(row.sampleLDb) ? row.sampleLDb : -Infinity,
    sampleR: Number.isFinite(row.sampleRDb) ? row.sampleRDb : -Infinity,
    samplePeak: Number.isFinite(row.truePeakMaxDbtp) ? row.truePeakMaxDbtp : -Infinity,
    correlation: Number.isFinite(row.correlation) ? row.correlation : -Infinity,
    vectorscopePairX: Number.isFinite(row.vectorscopePairX) ? row.vectorscopePairX : 0,
    vectorscopePairY: Number.isFinite(row.vectorscopePairY) ? row.vectorscopePairY : 1,
  }));
}

/**
 * @param {object[]} rawRows
 * @param {object} ctx
 * @param {number} ctx.histMaxSamples
 * @param {number} ctx.defaultSampleRate
 * @param {import("./FrameIntake.js").FrameIntake} ctx.intake
 * @param {(updater: (prev: object) => object) => void} ctx.setAudio
 * @param {(s: string) => void} ctx.setSpectrumPath
 * @param {(s: string) => void} ctx.setSpectrumPeakPath
 * @param {(s: string) => void} ctx.setVectorPath
 * @param {() => boolean} [ctx.isCancelled]
 * @returns {Promise<void>}
 */
export async function seedFloatHistoryFromRows(rawRows, ctx) {
  const { histMaxSamples, defaultSampleRate, intake, isCancelled } = ctx;
  const pick = { defaultSampleRate: defaultSampleRate || 48000 };
  if (!rawRows || !rawRows.length) {
    return;
  }
  // Ring buffer in Rust is capped; avoid normalizing a redundant prefix when a large dump is sent.
  const capped =
    rawRows.length > histMaxSamples ? rawRows.slice(rawRows.length - histMaxSamples) : rawRows;
  const n = capped.length;

  intake.reset();

  const histMax = histMaxSamples;
  for (let start = 0; start < n; start += SEED_ROW_BATCH) {
    if (isCancelled?.()) {
      return;
    }
    const end = Math.min(start + SEED_ROW_BATCH, n);
    for (let i = start; i < end; i += 1) {
      const row = normalizeHistoryRow(capped[i]);
      intake.pushHistRow(row, histMax, pick.defaultSampleRate);
    }
    if (end < n) {
      await raf();
    }
  }

  if (isCancelled?.()) {
    return;
  }
  const last = normalizeHistoryRow(capped[n - 1]);
  finalizeSeededState(last, pick, ctx);
}

// Re-export for callers that construct spectrum data outside of FrameIntake (e.g. snapshot tests).
export { buildSpectrumDataSnapshot };
