#!/usr/bin/env node
/**
 * What does Stereo Map's energy plane cost if the HUD stops reporting a dB number?
 *
 * The shipped plane stores attenuation-below-peak across 63.25 dB at 0.25 dB per step, one byte per
 * band, because three things read it: the 60 dB gate, the 12 dB opacity fade, and a one-decimal HUD
 * readout. Only the HUD needs the range and the resolution. Rendering cares about a band being
 * hidden, being fully opaque, or sitting somewhere in a 12 dB ramp between the two.
 *
 * So this prices a codec that stores the *opacity* rather than the energy:
 *
 *   code 0            hidden (below gate)
 *   code 1..L         the ramp, each code the centre of an equal bin strictly inside (0, 1)
 *   code OPAQUE       fully opaque (at or above gate + fade)
 *   code INVALID      no value
 *
 * Bin centres, not evenly spaced endpoints: mapping the ramp to `c / (L + 1)` and clamping made the
 * two ends of the ramp absorb a whole step of error while the middle absorbed half, which the
 * resolution test caught. Centres give a uniform half-bin bound everywhere.
 *
 * Giving "hidden" and "opaque" their own codes makes both classifications exact by construction --
 * quantization only ever happens inside the ramp. The experiment verifies that rather than assuming
 * it, because "exact by construction" is a claim about code that can be wrong.
 *
 * Fixtures mirror `stereo-map-energy-codec-experiment.mjs` so the two rounds are comparable.
 */
import { decodeCentiDb, encodeCentiDb } from "../src/lib/packedHistoryCodecs.js";
import {
  STEREO_MAP_ENERGY_STEP_DB,
  encodeStereoMapRelativeEnergy,
  decodeStereoMapRelativeEnergy,
} from "../src/lib/stereoMapEnergyCodec.js";

const GATE_FLOOR_DB = -96;
const GATE_BELOW_PEAK_DB = 60;
const GATE_FADE_DB = 12;

/** Bit widths worth pricing. 8 is the shipped plane's width, kept for the byte comparison. */
export const CANDIDATE_BITS = [4, 5, 6];

export function codecLayout(bits) {
  const codes = 2 ** bits;
  const invalid = codes - 1;
  const opaque = codes - 2;
  // Codes 1..opaque-1 carry the ramp; opacity `c / (rampLevels + 1)` keeps them strictly inside
  // (0, 1) so a ramp code can never be mistaken for hidden or for fully opaque.
  const rampLevels = opaque - 1;
  return { bits, codes, invalid, opaque, rampLevels };
}

export function gateDbFor(peakDb) {
  return Math.max(GATE_FLOOR_DB, peakDb - GATE_BELOW_PEAK_DB);
}

export function trueOpacity(peakDb, energyDb) {
  if (!Number.isFinite(peakDb) || !Number.isFinite(energyDb)) return null;
  const gateDb = gateDbFor(peakDb);
  return Math.min(1, Math.max(0, (energyDb - gateDb) / GATE_FADE_DB));
}

export function encodeOpacity(peakDb, energyDb, layout) {
  if (!Number.isFinite(peakDb) || !Number.isFinite(energyDb)) return layout.invalid;
  const gateDb = gateDbFor(peakDb);
  // `<=`, not `<`: at exactly the gate the true opacity is 0, which draws nothing. Sending that
  // into the ramp would light a band the renderer currently leaves invisible.
  if (energyDb <= gateDb) return 0;
  if (energyDb >= gateDb + GATE_FADE_DB) return layout.opaque;
  const t = (energyDb - gateDb) / GATE_FADE_DB; // (0, 1)
  const code = Math.floor(t * layout.rampLevels) + 1;
  return Math.min(layout.rampLevels, Math.max(1, code));
}

export function decodeOpacity(code, layout) {
  if (code === layout.invalid) return null;
  if (code === 0) return 0;
  if (code === layout.opaque) return 1;
  return (code - 0.5) / layout.rampLevels;
}

/** Region a band renders in: 0 hidden, 1 ramp, 2 fully opaque. Hold summaries gate on region 2. */
function regionOf(opacity) {
  if (opacity === null) return null;
  if (opacity <= 0) return 0;
  if (opacity >= 1) return 2;
  return 1;
}

function createMetrics() {
  return {
    samples: 0,
    invalidBaseline: 0,
    regionMismatch: 0,
    falseHidden: 0,
    falseVisible: 0,
    falseOpaque: 0,
    falseTranslucent: 0,
    opacityCompared: 0,
    opacityErrorTotal: 0,
    opacityErrorMax: 0,
  };
}

function compare(metrics, peakDb, energyDb, layout) {
  metrics.samples += 1;
  const baseline = trueOpacity(peakDb, energyDb);
  const decoded = decodeOpacity(encodeOpacity(peakDb, energyDb, layout), layout);

  if (baseline === null) {
    metrics.invalidBaseline += 1;
    if (decoded !== null) metrics.regionMismatch += 1;
    return;
  }
  if (decoded === null) {
    metrics.regionMismatch += 1;
    return;
  }

  const wanted = regionOf(baseline);
  const got = regionOf(decoded);
  if (wanted !== got) {
    metrics.regionMismatch += 1;
    if (wanted > 0 && got === 0) metrics.falseHidden += 1;
    if (wanted === 0 && got > 0) metrics.falseVisible += 1;
    if (wanted === 2 && got !== 2) metrics.falseTranslucent += 1;
    if (wanted !== 2 && got === 2) metrics.falseOpaque += 1;
  }

  const error = Math.abs(baseline - decoded);
  metrics.opacityCompared += 1;
  metrics.opacityErrorTotal += error;
  if (error > metrics.opacityErrorMax) metrics.opacityErrorMax = error;
}

/** The shipped byte codec, measured on the same fixture so the two are directly comparable. */
function compareProduction(metrics, peakDb, energyDb) {
  metrics.samples += 1;
  const baseline = trueOpacity(peakDb, energyDb);
  const packedPeak = decodeCentiDb(encodeCentiDb(peakDb));
  const code = encodeStereoMapRelativeEnergy(packedPeak, energyDb);
  const energyBack = decodeStereoMapRelativeEnergy(packedPeak, code);
  // Below the gate the codec decodes to `-Infinity`, not `null`, and the renderer turns that into
  // opacity 0 -- it draws nothing. Only the invalid sentinel is genuinely "no value". Reading the
  // sentinel as a null is what made an earlier version of this harness report 47% of an exhaustive
  // sweep as mismatches that were not mismatches.
  const decoded =
    energyBack === null ? null : energyBack === -Infinity ? 0 : trueOpacity(packedPeak, energyBack);

  if (baseline === null || decoded === null) {
    metrics.invalidBaseline += 1;
    if ((baseline === null) !== (decoded === null)) metrics.regionMismatch += 1;
    return;
  }
  const wanted = regionOf(baseline);
  const got = regionOf(decoded);
  if (wanted !== got) {
    metrics.regionMismatch += 1;
    if (wanted > 0 && got === 0) metrics.falseHidden += 1;
    if (wanted === 0 && got > 0) metrics.falseVisible += 1;
    if (wanted === 2 && got !== 2) metrics.falseTranslucent += 1;
    if (wanted !== 2 && got === 2) metrics.falseOpaque += 1;
  }
  const error = Math.abs(baseline - decoded);
  metrics.opacityCompared += 1;
  metrics.opacityErrorTotal += error;
  if (error > metrics.opacityErrorMax) metrics.opacityErrorMax = error;
}

function finish(metrics) {
  return {
    samples: metrics.samples,
    invalidBaseline: metrics.invalidBaseline,
    regionMismatch: metrics.regionMismatch,
    falseHidden: metrics.falseHidden,
    falseVisible: metrics.falseVisible,
    falseOpaque: metrics.falseOpaque,
    falseTranslucent: metrics.falseTranslucent,
    opacityErrorMax: metrics.opacityErrorMax,
    opacityErrorMean: metrics.opacityCompared
      ? metrics.opacityErrorTotal / metrics.opacityCompared
      : 0,
  };
}

function sweep(apply) {
  const metrics = createMetrics();
  for (let peakCentiDb = -12_000; peakCentiDb <= 2400; peakCentiDb += 25) {
    const peakDb = decodeCentiDb(encodeCentiDb(peakCentiDb / 100));
    for (let attenuationCentiDb = 0; attenuationCentiDb <= 12_000; attenuationCentiDb += 1) {
      const energyDb = decodeCentiDb(encodeCentiDb(peakDb - attenuationCentiDb / 100));
      apply(metrics, peakDb, energyDb);
    }
  }
  return finish(metrics);
}

function representativeRows(apply) {
  const metrics = createMetrics();
  const rows = 512;
  const bands = 958;
  for (let row = 0; row < rows; row += 1) {
    const peakDb = decodeCentiDb(encodeCentiDb(-120 + ((row * 37) % 14_401) / 100));
    for (let band = 0; band < bands; band += 1) {
      if ((row * bands + band) % 997 === 0) {
        apply(metrics, peakDb, -Infinity);
        continue;
      }
      const attenuationDb = ((row * 1543 + band * 7919) % 12_001) / 100;
      apply(metrics, peakDb, decodeCentiDb(encodeCentiDb(peakDb - attenuationDb)));
    }
  }
  return finish(metrics);
}

/** Four-hour, single-key, single-mode projection, matching `stereo-map.md` §3.1. */
export const RETENTION = { rows: 360_000, bands: 958 };
const SHIPPED_TOTAL_BYTES = 867_512_696;
const SHIPPED_ENERGY_BYTES = 344_880_000;

export function projectedBytes(bits) {
  const plane = Math.ceil((RETENTION.rows * RETENTION.bands * bits) / 8);
  return {
    bits,
    planeBytes: plane,
    savedBytes: SHIPPED_ENERGY_BYTES - plane,
    keyTotalBytes: SHIPPED_TOTAL_BYTES - (SHIPPED_ENERGY_BYTES - plane),
    keyTotalDelta: -(SHIPPED_ENERGY_BYTES - plane) / SHIPPED_TOTAL_BYTES,
  };
}

export function runExperiment() {
  const candidates = {};
  for (const bits of CANDIDATE_BITS) {
    const layout = codecLayout(bits);
    candidates[`${bits}bit`] = {
      layout: {
        codes: layout.codes,
        rampLevels: layout.rampLevels,
        rampStepOpacity: 1 / layout.rampLevels,
        rampStepDb: GATE_FADE_DB / layout.rampLevels,
        worstOpacityError: 0.5 / layout.rampLevels,
      },
      bytes: projectedBytes(bits),
      sweep: sweep((m, p, e) => compare(m, p, e, layout)),
      representative: representativeRows((m, p, e) => compare(m, p, e, layout)),
    };
  }

  return {
    question:
      "If the HUD stops reporting energy in dB, how little can the plane store and still render " +
      "the same gate and the same fade?",
    shipped: {
      bits: 8,
      stepDb: STEREO_MAP_ENERGY_STEP_DB,
      bytes: { planeBytes: SHIPPED_ENERGY_BYTES, keyTotalBytes: SHIPPED_TOTAL_BYTES },
      sweep: sweep(compareProduction),
      representative: representativeRows(compareProduction),
    },
    candidates,
  };
}

function main() {
  const result = runExperiment();
  console.log(JSON.stringify(result, null, 2));
  console.log(`STEREO_MAP_OPACITY_CODEC_RESULT=${JSON.stringify(result)}`);
  return result;
}

const isMain =
  process.argv[1] != null &&
  new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href.toLowerCase() ===
    import.meta.url.toLowerCase();
if (isMain) main();
