import {
  createStereoMapDerivationScratch,
  STEREO_MAP_MODES,
  visitStereoMapDerivedPoints,
} from "./stereoMapMath.js";

function createMinimumPlane(bandCount) {
  const values = new Float64Array(bandCount);
  values.fill(Infinity);
  return values;
}

function createMaximumPlane(bandCount) {
  const values = new Float64Array(bandCount);
  values.fill(-Infinity);
  return values;
}

export function createStereoMapHoldSummary(bandCount) {
  if (!Number.isInteger(bandCount) || bandCount < 0) {
    throw new RangeError("Stereo Map Hold band count must be a non-negative integer");
  }
  return {
    bandCount,
    positionMinimum: createMinimumPlane(bandCount),
    positionMaximum: createMaximumPlane(bandCount),
    correlationMinimum: createMinimumPlane(bandCount),
    monoLossMinimum: createMinimumPlane(bandCount),
    msRatioMaximum: createMaximumPlane(bandCount),
    positionValid: new Uint8Array(bandCount),
    correlationValid: new Uint8Array(bandCount),
    monoLossValid: new Uint8Array(bandCount),
    msRatioValid: new Uint8Array(bandCount),
  };
}

export function copyStereoMapHoldSummary(summary) {
  const copy = { bandCount: summary.bandCount };
  for (const [key, value] of Object.entries(summary)) {
    if (ArrayBuffer.isView(value)) copy[key] = value.slice();
  }
  return copy;
}

/** Total bytes retained by a Hold summary's typed-array planes. Independent of row count. */
export function stereoMapHoldSummaryByteLength(summary) {
  let total = 0;
  for (const value of Object.values(summary)) {
    if (ArrayBuffer.isView(value)) total += value.byteLength;
  }
  return total;
}

// Per-mode extremum targets, keyed by the mode name visitStereoMapDerivedPoints reports.
const MINIMUM_TARGETS = {
  [STEREO_MAP_MODES.POSITION]: { valueKey: "positionMinimum", validKey: "positionValid" },
  [STEREO_MAP_MODES.CORRELATION]: { valueKey: "correlationMinimum", validKey: "correlationValid" },
  [STEREO_MAP_MODES.MONO_LOSS_DB]: { valueKey: "monoLossMinimum", validKey: "monoLossValid" },
};
const MAXIMUM_TARGETS = {
  [STEREO_MAP_MODES.POSITION]: { valueKey: "positionMaximum", validKey: "positionValid" },
  [STEREO_MAP_MODES.MS_RATIO_DB]: { valueKey: "msRatioMaximum", validKey: "msRatioValid" },
};

function updateExtreme(summary, valueKey, validKey, index, value, isMaximum) {
  const valid = summary[validKey];
  const values = summary[valueKey];
  if (!valid[index] || (isMaximum ? value > values[index] : value < values[index])) {
    values[index] = value;
    valid[index] = 1;
  }
}

/**
 * Accumulate one primitive row into a Hold summary. Every mode is derived in a single pass over
 * the row (via visitStereoMapDerivedPoints) so each primitive band is read exactly once
 * regardless of how many modes are held. Only fully valid, fully opaque points update Hold —
 * gated and fading points are left untouched.
 */
export function accumulateStereoMapHold(summary, primitiveRow, scratch) {
  if (primitiveRow?.pl?.length !== summary.bandCount) {
    throw new RangeError("Stereo Map Hold row must match its summary band count");
  }

  const derivationScratch = scratch ?? createStereoMapDerivationScratch(summary.bandCount);
  visitStereoMapDerivedPoints(
    primitiveRow,
    (mode, index, value, state, opacity) => {
      if (state !== "valid" || opacity !== 1) return;
      const minimum = MINIMUM_TARGETS[mode];
      if (minimum) updateExtreme(summary, minimum.valueKey, minimum.validKey, index, value, false);
      const maximum = MAXIMUM_TARGETS[mode];
      if (maximum) updateExtreme(summary, maximum.valueKey, maximum.validKey, index, value, true);
    },
    derivationScratch
  );
  return summary;
}

function mergeMinimum(target, source, valueKey, validKey) {
  for (let index = 0; index < target.bandCount; index += 1) {
    if (!source[validKey][index]) continue;
    const value = source[valueKey][index];
    if (!target[validKey][index] || value < target[valueKey][index]) {
      target[valueKey][index] = value;
      target[validKey][index] = 1;
    }
  }
}

function mergeMaximum(target, source, valueKey, validKey) {
  for (let index = 0; index < target.bandCount; index += 1) {
    if (!source[validKey][index]) continue;
    const value = source[valueKey][index];
    if (!target[validKey][index] || value > target[valueKey][index]) {
      target[valueKey][index] = value;
      target[validKey][index] = 1;
    }
  }
}

export function mergeStereoMapHoldSummary(target, source) {
  if (target.bandCount !== source.bandCount) {
    throw new RangeError("Stereo Map Hold summaries must use the same band count");
  }
  mergeMinimum(target, source, "positionMinimum", "positionValid");
  mergeMaximum(target, source, "positionMaximum", "positionValid");
  mergeMinimum(target, source, "correlationMinimum", "correlationValid");
  mergeMinimum(target, source, "monoLossMinimum", "monoLossValid");
  mergeMaximum(target, source, "msRatioMaximum", "msRatioValid");
  return target;
}

function nullableValues(values, valid) {
  return Array.from(values, (value, index) => (valid[index] ? value : null));
}

export function stereoMapHoldValues(summary) {
  return {
    [STEREO_MAP_MODES.POSITION]: {
      minimum: nullableValues(summary.positionMinimum, summary.positionValid),
      maximum: nullableValues(summary.positionMaximum, summary.positionValid),
    },
    [STEREO_MAP_MODES.CORRELATION]: nullableValues(
      summary.correlationMinimum,
      summary.correlationValid
    ),
    [STEREO_MAP_MODES.MONO_LOSS_DB]: nullableValues(summary.monoLossMinimum, summary.monoLossValid),
    [STEREO_MAP_MODES.MS_RATIO_DB]: nullableValues(summary.msRatioMaximum, summary.msRatioValid),
  };
}

export class StereoMapHoldAccumulator {
  #epoch;
  #summary = null;
  #scratch = null;

  constructor(epoch = 0) {
    if (!Number.isInteger(epoch) || epoch < 0) {
      throw new RangeError("Stereo Map Hold epoch must be a non-negative integer");
    }
    this.#epoch = epoch;
  }

  get epoch() {
    return this.#epoch;
  }

  consumePrimitiveRow(row, epoch = this.#epoch) {
    if (epoch !== this.#epoch) return false;
    const bandCount = row?.pl?.length ?? 0;
    const summary = this.#summary ?? createStereoMapHoldSummary(bandCount);
    if (summary.bandCount !== bandCount) {
      throw new RangeError("Stereo Map Hold row must keep a stable band count");
    }
    if (!this.#scratch || this.#scratch.bandCount !== bandCount) {
      this.#scratch = createStereoMapDerivationScratch(bandCount);
    }
    accumulateStereoMapHold(summary, row, this.#scratch);
    this.#summary = summary;
    return true;
  }

  valuesFor(mode) {
    const summary = this.#summary ?? createStereoMapHoldSummary(0);
    const values = stereoMapHoldValues(summary);
    if (!(mode in values)) throw new TypeError(`Unknown Stereo Map mode: ${String(mode)}`);
    return values[mode];
  }

  clear() {
    this.#epoch += 1;
    this.#summary = null;
    this.#scratch = null;
    return this.#epoch;
  }
}
