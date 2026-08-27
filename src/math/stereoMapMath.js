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
const MODE_LIST = Object.freeze(Object.values(STEREO_MAP_MODES));
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
  return deriveValueFromScalars(mode, pl, pr, c, scale, geometricMean);
}

function deriveValueFromScalars(mode, pl, pr, c, scale, geometricMean) {
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

export function createStereoMapDerivationScratch(bandCount) {
  if (!Number.isInteger(bandCount) || bandCount < 0) {
    throw new RangeError("Stereo Map derivation band count must be a non-negative integer");
  }
  return {
    bandCount,
    normalizedPl: new Float64Array(bandCount),
    normalizedPr: new Float64Array(bandCount),
    normalizedC: new Float64Array(bandCount),
    scale: new Float64Array(bandCount),
    geometricMean: new Float64Array(bandCount),
    energyDb: new Float64Array(bandCount),
    fullGridPeakDb: -Infinity,
    gateDb: GATE_FLOOR_DB,
  };
}

function prepareDerivation(row, scratch, instrumentation) {
  validatePrimitiveRow(row);
  if (!scratch || scratch.bandCount !== row.pl.length) {
    throw new RangeError("Stereo Map derivation scratch must match the row band count");
  }

  let fullGridPeakDb = -Infinity;
  for (let index = 0; index < row.pl.length; index += 1) {
    const sourcePl = row.pl[index];
    const sourcePr = row.pr[index];
    const sourceC = row.c[index];
    if (![sourcePl, sourcePr, sourceC].every(Number.isFinite)) {
      scratch.scale[index] = Number.NaN;
      scratch.energyDb[index] = Number.NaN;
      continue;
    }

    const clampedPl = Math.max(0, sourcePl);
    const clampedPr = Math.max(0, sourcePr);
    const scale = Math.max(clampedPl, clampedPr);
    scratch.scale[index] = scale;
    if (scale === 0) {
      scratch.normalizedPl[index] = 0;
      scratch.normalizedPr[index] = 0;
      scratch.normalizedC[index] = 0;
      scratch.geometricMean[index] = 0;
    } else {
      scratch.normalizedPl[index] = clampedPl / scale;
      scratch.normalizedPr[index] = clampedPr / scale;
      const geometricMean = Math.sqrt(Math.min(clampedPl, clampedPr)) / Math.sqrt(scale);
      scratch.geometricMean[index] = geometricMean;
      scratch.normalizedC[index] = Math.max(
        -geometricMean,
        Math.min(geometricMean, sourceC / scale)
      );
    }

    const db =
      scale === 0
        ? 10 * ENERGY_FLOOR_LOG10 + CAL_OFFSET_DB
        : 10 *
            Math.max(
              Math.log10(scale) +
                Math.log10(scratch.normalizedPl[index] + scratch.normalizedPr[index]),
              ENERGY_FLOOR_LOG10
            ) +
          CAL_OFFSET_DB;
    scratch.energyDb[index] = db;
    if (db > fullGridPeakDb) fullGridPeakDb = db;
  }

  scratch.fullGridPeakDb = fullGridPeakDb;
  scratch.gateDb = Math.max(GATE_FLOOR_DB, fullGridPeakDb - GATE_BELOW_PEAK_DB);
  if (instrumentation) {
    instrumentation.rows += 1;
    instrumentation.normalizedBands += row.pl.length;
  }
}

function visitDerivedModes(row, modes, visitor, scratch, instrumentation) {
  if (typeof visitor !== "function") {
    throw new TypeError("Stereo Map derived point visitor must be a function");
  }
  prepareDerivation(row, scratch, instrumentation);

  for (let index = 0; index < row.pl.length; index += 1) {
    const db = scratch.energyDb[index];
    const gated = Number.isNaN(db) || db < scratch.gateDb;
    const opacity = gated
      ? undefined
      : Math.min(1, Math.max(0, (db - scratch.gateDb) / GATE_FADE_DB));
    for (const mode of modes) {
      const value = gated
        ? null
        : deriveValueFromScalars(
            mode,
            scratch.normalizedPl[index],
            scratch.normalizedPr[index],
            scratch.normalizedC[index],
            scratch.scale[index],
            scratch.geometricMean[index]
          );
      const state = value === null || Number.isNaN(value) ? "invalid" : "valid";
      visitor(mode, index, value, state, opacity, Number.isNaN(db) ? null : db);
      if (instrumentation) instrumentation.visitedPoints += 1;
    }
  }
  return scratch;
}

/**
 * Visit all four derived modes after one row validation, normalization, and full-grid gate pass.
 * Callers provide reusable typed scratch so the visit allocates no derived row arrays.
 */
export function visitStereoMapDerivedPoints(row, visitor, scratch, instrumentation) {
  return visitDerivedModes(row, MODE_LIST, visitor, scratch, instrumentation);
}

/** Visit only the modes that currently have an open panel while sharing one normalization pass. */
export function visitSelectedStereoMapDerivedPoints(row, modes, visitor, scratch, instrumentation) {
  const selected = Array.from(modes ?? []);
  for (const mode of selected) validateMode(mode);
  return visitDerivedModes(row, selected, visitor, scratch, instrumentation);
}

/**
 * Derive a complete primitive row. `values` retains unclipped measurements for Hold; `points`
 * contains the strict display states consumed by Workspace, history snapshots, and Dock plots.
 * The validated `bandCentersHz` reference is retained so axis and hover consumers use the same
 * IPC grid without rebuilding it.
 */
export function deriveStereoMapRow(mode, row, range) {
  validateMode(mode);
  const { lowerBound, upperBound } = validateRange(range);
  validatePrimitiveRow(row);
  const scratch = createStereoMapDerivationScratch(row.pl.length);
  const values = new Array(row.pl.length);
  const points = new Array(row.pl.length);
  const energy = new Array(row.pl.length);
  visitDerivedModes(
    row,
    [mode],
    (_visitedMode, index, value, state, opacity, db) => {
      energy[index] = db;
      values[index] = value;
      points[index] =
        state === "invalid"
          ? { state: "invalid" }
          : projectPoint(value, opacity, lowerBound, upperBound);
    },
    scratch
  );

  return {
    mode,
    bandCentersHz: row.bandCentersHz,
    fullGridPeakDb: scratch.fullGridPeakDb,
    gateDb: scratch.gateDb,
    energyDb: energy,
    values,
    points,
  };
}
