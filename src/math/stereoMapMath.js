// Keep this aligned with src-tauri/src/dsp/spectrum_bank.rs. It is the frontend's single
// calibration source until build-time constants are shared across the Rust/JavaScript boundary.
export const CAL_OFFSET_DB = 16.5;

export const STEREO_MAP_MODES = Object.freeze({
  POSITION: "position",
  CORRELATION: "correlation",
  MONO_LOSS_DB: "monoLossDb",
  MS_RATIO_DB: "msRatioDb",
});

const MODES = new Set(Object.values(STEREO_MAP_MODES));
const ENERGY_FLOOR_LOG10 = -20;
const GATE_FLOOR_DB = -96;
const GATE_BELOW_PEAK_DB = 60;
const GATE_FADE_DB = 12;
const ROUNDOFF_EPSILON = Number.EPSILON * 16;

function validateMode(mode) {
  if (!MODES.has(mode)) {
    throw new TypeError(`Unknown Stereo Map mode: ${String(mode)}`);
  }
}

function validateRange({ lowerBound, upperBound } = {}) {
  if (!Number.isFinite(lowerBound) || !Number.isFinite(upperBound)) {
    throw new TypeError("Stereo Map range bounds must be finite numbers");
  }
  if (lowerBound >= upperBound) {
    throw new RangeError("Stereo Map lowerBound must be less than upperBound");
  }
  return { lowerBound, upperBound };
}

function validateOpacity(opacity) {
  if (!Number.isFinite(opacity)) {
    throw new TypeError("Stereo Map opacity must be finite");
  }
  if (opacity < 0 || opacity > 1) {
    throw new RangeError("Stereo Map opacity must be between 0 and 1");
  }
}

function normalizePrimitive({ pl, pr, c } = {}) {
  if (![pl, pr, c].every(Number.isFinite)) return null;

  const clampedPl = Math.max(0, pl);
  const clampedPr = Math.max(0, pr);
  const scale = Math.max(clampedPl, clampedPr);
  if (scale === 0) {
    return { pl: 0, pr: 0, c: 0, scale: 0, geometricMean: 0 };
  }

  const scaledPl = clampedPl / scale;
  const scaledPr = clampedPr / scale;
  const cauchyBound = Math.sqrt(Math.min(clampedPl, clampedPr)) / Math.sqrt(scale);
  const scaledC = Math.max(-cauchyBound, Math.min(cauchyBound, c / scale));
  return {
    pl: scaledPl,
    pr: scaledPr,
    c: scaledC,
    scale,
    geometricMean: cauchyBound,
  };
}

function clampRoundoffToZero(value, magnitude) {
  if (value >= 0) return value;
  return value >= -ROUNDOFF_EPSILON * Math.max(1, magnitude) ? 0 : null;
}

function deriveValue(mode, primitive) {
  if (!primitive) return null;
  const { pl, pr, c, scale, geometricMean } = primitive;
  if (scale === 0) return null;

  const sum = pl + pr;

  switch (mode) {
    case STEREO_MAP_MODES.POSITION:
      return sum === 0 ? null : (pl - pr) / sum;

    case STEREO_MAP_MODES.CORRELATION:
      if (geometricMean === 0) return null;
      return Math.max(-1, Math.min(1, c / geometricMean));

    case STEREO_MAP_MODES.MONO_LOSS_DB: {
      const actual = clampRoundoffToZero(sum + 2 * c, sum + 2 * Math.abs(c));
      const ideal = clampRoundoffToZero(sum + 2 * geometricMean, sum + 2 * Math.abs(geometricMean));
      if (actual === null || ideal === null || ideal === 0) return null;
      if (actual === 0) return -Infinity;
      const ratio = Math.max(0, Math.min(1, actual / ideal));
      return 10 * Math.log10(ratio);
    }

    case STEREO_MAP_MODES.MS_RATIO_DB: {
      const side = clampRoundoffToZero(sum - 2 * c, sum + 2 * Math.abs(c));
      const mid = clampRoundoffToZero(sum + 2 * c, sum + 2 * Math.abs(c));
      if (side === null || mid === null || (side === 0 && mid === 0)) return null;
      if (side === 0) return -Infinity;
      if (mid === 0) return Infinity;
      return 10 * Math.log10(side / mid);
    }

    default:
      return null;
  }
}

function projectPoint(value, opacity, lowerBound, upperBound) {
  if (value === null || Number.isNaN(value)) return { state: "invalid" };
  if (value < lowerBound) {
    return { state: "belowRange", value: lowerBound, opacity };
  }
  if (value > upperBound) {
    return { state: "aboveRange", value: upperBound, opacity };
  }
  if (!Number.isFinite(value)) return { state: "invalid" };
  return { state: "finite", value, opacity };
}

function energyDb(primitive) {
  if (!primitive) return null;
  const { pl, pr, scale } = primitive;
  if (scale === 0) return 10 * ENERGY_FLOOR_LOG10 + CAL_OFFSET_DB;

  const log10Energy = Math.log10(scale) + Math.log10(pl + pr);
  return 10 * Math.max(log10Energy, ENERGY_FLOOR_LOG10) + CAL_OFFSET_DB;
}

/**
 * Derive and clip one primitive point. Primitive non-finites are invalid; formula infinities
 * remain valid and project to an explicit range state.
 */
export function deriveStereoMapPoint(mode, primitive, range, opacity = 1) {
  validateMode(mode);
  const { lowerBound, upperBound } = validateRange(range);
  validateOpacity(opacity);
  const value = deriveValue(mode, normalizePrimitive(primitive));
  return projectPoint(value, opacity, lowerBound, upperBound);
}

function isNumericRow(value) {
  return Array.isArray(value) || ArrayBuffer.isView(value);
}

function validatePrimitiveRow(row) {
  if (
    !row ||
    !isNumericRow(row.bandCentersHz) ||
    !isNumericRow(row.pl) ||
    !isNumericRow(row.pr) ||
    !isNumericRow(row.c)
  ) {
    throw new TypeError("Stereo Map row requires bandCentersHz, pl, pr, and c arrays");
  }
  if (
    row.bandCentersHz.length !== row.pl.length ||
    row.pl.length !== row.pr.length ||
    row.pl.length !== row.c.length
  ) {
    throw new TypeError("Stereo Map bandCentersHz, pl, pr, and c arrays must have equal lengths");
  }
  for (const center of row.bandCentersHz) {
    if (!Number.isFinite(center)) {
      throw new TypeError("Stereo Map bandCentersHz values must be finite");
    }
  }
}

/**
 * Derive a complete primitive row. `values` retains unclipped measurements for Hold; `points`
 * contains the strict display states consumed by Workspace, history snapshots, and Dock plots.
 * The validated `bandCentersHz` reference is retained so axis and hover consumers use the same
 * IPC grid without rebuilding it.
 */
export function deriveStereoMapRow(mode, row, range) {
  validateMode(mode);
  validatePrimitiveRow(row);
  const { lowerBound, upperBound } = validateRange(range);

  const normalized = new Array(row.pl.length);
  const energy = new Array(row.pl.length);
  let fullGridPeakDb = -Infinity;

  for (let index = 0; index < row.pl.length; index += 1) {
    const primitive = normalizePrimitive({
      pl: row.pl[index],
      pr: row.pr[index],
      c: row.c[index],
    });
    normalized[index] = primitive;
    const db = energyDb(primitive);
    energy[index] = db;
    if (db !== null && db > fullGridPeakDb) fullGridPeakDb = db;
  }

  const gateDb = Math.max(GATE_FLOOR_DB, fullGridPeakDb - GATE_BELOW_PEAK_DB);
  const values = new Array(row.pl.length);
  const points = new Array(row.pl.length);

  for (let index = 0; index < row.pl.length; index += 1) {
    const db = energy[index];
    if (db === null || db < gateDb) {
      values[index] = null;
      points[index] = { state: "invalid" };
      continue;
    }

    const value = deriveValue(mode, normalized[index]);
    values[index] = value;
    const opacity = Math.min(1, Math.max(0, (db - gateDb) / GATE_FADE_DB));
    points[index] = projectPoint(value, opacity, lowerBound, upperBound);
  }

  return {
    mode,
    bandCentersHz: row.bandCentersHz,
    fullGridPeakDb,
    gateDb,
    energyDb: energy,
    values,
    points,
  };
}
