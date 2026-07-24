import { fmtMetric } from "../math/formatMath";

const CORRELATION_SIGNAL_FLOOR_DB = -90;

export const STATS_META = {
  momentary: {
    label: "Momentary",
    shortLabel: "M",
    unit: "LUFS",
    hint: "Loudness over a 400ms window",
  },
  shortTerm: {
    label: "Short-term",
    shortLabel: "ST",
    unit: "LUFS",
    hint: "Loudness over a 3s window",
  },
  integrated: {
    label: "Integrated",
    shortLabel: "I",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  momentaryMax: {
    label: "Momentary Max",
    shortLabel: "M Max",
    unit: "LUFS",
    hint: "Highest Momentary (400ms) loudness reached so far",
  },
  shortTermMax: {
    label: "Short-term Max",
    shortLabel: "ST Max",
    unit: "LUFS",
    hint: "Highest Short-term (3s) loudness reached so far",
  },
  lra: {
    label: "Loudness Range",
    shortLabel: "LRA",
    unit: "LU",
    hint: "LRA, loudness range over the whole program",
  },
  psr: {
    label: "Short-term Dynamics",
    shortLabel: "PSR",
    unit: "dB",
    hint: "PSR, Peak to Short-term loudness Ratio",
  },
  plr: {
    label: "Integrated Dynamics",
    shortLabel: "PLR",
    unit: "dB",
    hint: "PLR, Peak to Loudness Ratio",
  },
  dialogueCoverage: {
    label: "Dialogue Coverage",
    shortLabel: "Dlg Cov",
    unit: "%",
    hint: "Share of time dialogue is detected",
  },
  dialogueIntegrated: {
    label: "Dialogue Integrated",
    shortLabel: "Dlg I",
    unit: "LUFS",
    hint: "Loudness over dialogue only",
  },
  dialogueRange: {
    label: "Dialogue Range",
    shortLabel: "Dlg LRA",
    unit: "LU",
    hint: "Loudness range over dialogue only",
  },
  dialogueOffset: {
    label: "Dialogue Offset",
    shortLabel: "Dlg Offset",
    unit: "LU",
    hint: "Dialogue loudness relative to the overall mix",
  },
  truePeak: {
    label: "True Peak Max",
    shortLabel: "TP Max",
    unit: "dBTP",
    hint: "Highest inter-sample (true) peak level reached so far",
  },
  correlation: {
    label: "Correlation",
    shortLabel: "Corr",
    unit: "",
    hint: "Phase correlation of the stereo pair (+1 in phase, −1 out of phase)",
  },
  sideToMid: {
    label: "Side/Mid",
    shortLabel: "S/M",
    unit: "dB",
    hint: "Side energy relative to Mid energy for the selected stereo pair",
  },
};

export const STATS_CANONICAL_ORDER = [
  "momentary",
  "shortTerm",
  "integrated",
  "momentaryMax",
  "shortTermMax",
  "lra",
  "psr",
  "plr",
  "dialogueCoverage",
  "dialogueIntegrated",
  "dialogueRange",
  "dialogueOffset",
  "truePeak",
  "correlation",
  "sideToMid",
];

/// Decimals the readout shows. Anything not listed goes through `fmtMetric`, which is fixed at 1.
/// Editors round to this so a typed threshold can never be finer than the number it is judged
/// against -- a rule of `-23.04` against a panel reading `-23.0` fails with nothing on screen to
/// explain it.
const STAT_DECIMALS = { correlation: 2, dialogueCoverage: 0 };

/// @returns {number} decimals for `metricId`, defaulting to the 1 that `fmtMetric` renders.
export function statDecimals(metricId) {
  return STAT_DECIMALS[metricId] ?? 1;
}

/// Round `value` to what the panel can show for `metricId`. Non-finite input passes through.
export function roundToStatPrecision(metricId, value) {
  if (!Number.isFinite(value)) return value;
  const factor = 10 ** statDecimals(metricId);
  return Math.round(value * factor) / factor;
}

export const STATS_OPTIONS = STATS_CANONICAL_ORDER.map((id) => ({
  id,
  label: STATS_META[id].label,
  hint: STATS_META[id].hint,
}));

export function dialogueOffsetText(dialogueIntegrated, integrated) {
  if (!Number.isFinite(dialogueIntegrated) || !Number.isFinite(integrated)) return "-";
  const d = dialogueIntegrated - integrated;
  return `${d >= 0 ? "+" : "-"}${Math.abs(d).toFixed(1)}`;
}

export function hasCorrelationSignal(displayAudio) {
  const peakDb = displayAudio?.peakDb;
  if (Array.isArray(peakDb)) {
    return peakDb.some((v) => Number.isFinite(v) && v > CORRELATION_SIGNAL_FLOOR_DB);
  }
  return true;
}

// Correlation is bounded to [-1, +1], so finite values only need fixed 2-decimal
// precision, but silence/near-silence is indeterminate rather than "0.00".
function fmtCorrelation(displayAudio) {
  if (!hasCorrelationSignal(displayAudio)) return "-";
  const v = displayAudio?.correlation;
  return Number.isFinite(v) ? v.toFixed(2) : "-";
}

function fmtSideToMid(displayAudio) {
  if (!hasCorrelationSignal(displayAudio)) return "-";
  const v = displayAudio?.sideToMidDb;
  return Number.isFinite(v) ? v.toFixed(1) : "-";
}

/**
 * Raw numeric value per stat id, before any formatting.
 *
 * Shared with Loudness Profile evaluation, which has to compare numbers rather than the display
 * strings. Keeping one mapping from engine fields to stat ids is the point: a second copy would
 * be free to drift from what the panel actually shows.
 *
 * @param {object} displayAudio
 * @returns {Record<string, number>} non-finite where the metric has no usable value
 */
export function buildStatsValues(displayAudio) {
  const psr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.shortTerm)
      ? displayAudio.tpMax - displayAudio.shortTerm
      : -Infinity;
  const plr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.integrated)
      ? displayAudio.tpMax - displayAudio.integrated
      : -Infinity;
  const dialogueOffset =
    Number.isFinite(displayAudio.dialogueIntegrated) && Number.isFinite(displayAudio.integrated)
      ? displayAudio.dialogueIntegrated - displayAudio.integrated
      : -Infinity;

  return {
    momentary: displayAudio.momentary,
    shortTerm: displayAudio.shortTerm,
    integrated: displayAudio.integrated,
    momentaryMax: displayAudio.mMax,
    shortTermMax: displayAudio.stMax,
    lra: displayAudio.lra,
    psr,
    plr,
    dialogueCoverage: displayAudio.dialoguePercent,
    dialogueIntegrated: displayAudio.dialogueIntegrated,
    dialogueRange: displayAudio.dialogueLra,
    dialogueOffset,
    truePeak: displayAudio.tpMax,
    correlation: displayAudio.correlation,
    sideToMid: displayAudio.sideToMidDb,
  };
}

/**
 * Assemble the full ordered list of stat readouts from the live/display audio object.
 * @param {object} displayAudio
 * @returns {{ id: string, label: string, value: string, unit: string, hint: string }[]}
 */
export function buildStatsMetrics(displayAudio) {
  const raw = buildStatsValues(displayAudio);

  const value = {
    momentary: fmtMetric(raw.momentary),
    shortTerm: fmtMetric(raw.shortTerm),
    integrated: fmtMetric(raw.integrated),
    momentaryMax: fmtMetric(raw.momentaryMax),
    shortTermMax: fmtMetric(raw.shortTermMax),
    lra: fmtMetric(raw.lra),
    psr: fmtMetric(raw.psr),
    plr: fmtMetric(raw.plr),
    dialogueCoverage: Number.isFinite(raw.dialogueCoverage)
      ? `${raw.dialogueCoverage.toFixed(0)}`
      : "-",
    dialogueIntegrated: fmtMetric(raw.dialogueIntegrated),
    dialogueRange: fmtMetric(raw.dialogueRange),
    dialogueOffset: dialogueOffsetText(displayAudio.dialogueIntegrated, displayAudio.integrated),
    truePeak: fmtMetric(raw.truePeak),
    correlation: fmtCorrelation(displayAudio),
    sideToMid: fmtSideToMid(displayAudio),
  };

  return STATS_CANONICAL_ORDER.map((id) => ({
    id,
    ...STATS_META[id],
    value: value[id],
  }));
}
