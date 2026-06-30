import { fmtMetric } from "../math/formatMath";

const CORRELATION_SIGNAL_FLOOR_DB = -90;

export const STATS_META = {
  momentary: { label: "Momentary", unit: "LUFS", hint: "Loudness over a 400ms window" },
  shortTerm: { label: "Short-term", unit: "LUFS", hint: "Loudness over a 3s window" },
  integrated: {
    label: "Integrated",
    unit: "LUFS",
    hint: "Loudness over the whole program, gated below −70 LUFS",
  },
  momentaryMax: {
    label: "Momentary Max",
    unit: "LUFS",
    hint: "Highest Momentary (400ms) loudness reached so far",
  },
  shortTermMax: {
    label: "Short-term Max",
    unit: "LUFS",
    hint: "Highest Short-term (3s) loudness reached so far",
  },
  lra: { label: "Loudness Range", unit: "LU", hint: "LRA, loudness range over the whole program" },
  psr: { label: "Short-term Dynamics", unit: "dB", hint: "PSR, Peak to Short-term loudness Ratio" },
  plr: { label: "Integrated Dynamics", unit: "dB", hint: "PLR, Peak to Loudness Ratio" },
  dialogueCoverage: {
    label: "Dialogue Coverage",
    unit: "%",
    hint: "Share of time dialogue is detected",
  },
  dialogueIntegrated: {
    label: "Dialogue Integrated",
    unit: "LUFS",
    hint: "Loudness over dialogue only",
  },
  dialogueRange: { label: "Dialogue Range", unit: "LU", hint: "Loudness range over dialogue only" },
  dialogueOffset: {
    label: "Dialogue Offset",
    unit: "LU",
    hint: "Dialogue loudness relative to the overall mix",
  },
  truePeak: {
    label: "True Peak Max",
    unit: "dBTP",
    hint: "Highest inter-sample (true) peak level reached so far",
  },
  correlation: {
    label: "Correlation",
    unit: "",
    hint: "Phase correlation of the stereo pair (+1 in phase, −1 out of phase)",
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
];

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

function hasCorrelationSignal(displayAudio) {
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

/**
 * Assemble the full ordered list of stat readouts from the live/display audio object.
 * @param {object} displayAudio
 * @returns {{ id: string, label: string, value: string, unit: string, hint: string }[]}
 */
export function buildStatsMetrics(displayAudio) {
  const psr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.shortTerm)
      ? displayAudio.tpMax - displayAudio.shortTerm
      : -Infinity;
  const plr =
    Number.isFinite(displayAudio.tpMax) && Number.isFinite(displayAudio.integrated)
      ? displayAudio.tpMax - displayAudio.integrated
      : -Infinity;

  const value = {
    momentary: fmtMetric(displayAudio.momentary),
    shortTerm: fmtMetric(displayAudio.shortTerm),
    integrated: fmtMetric(displayAudio.integrated),
    momentaryMax: fmtMetric(displayAudio.mMax),
    shortTermMax: fmtMetric(displayAudio.stMax),
    lra: fmtMetric(displayAudio.lra),
    psr: fmtMetric(psr),
    plr: fmtMetric(plr),
    dialogueCoverage: Number.isFinite(displayAudio.dialoguePercent)
      ? `${displayAudio.dialoguePercent.toFixed(0)}`
      : "-",
    dialogueIntegrated: fmtMetric(displayAudio.dialogueIntegrated),
    dialogueRange: fmtMetric(displayAudio.dialogueLra),
    dialogueOffset: dialogueOffsetText(displayAudio.dialogueIntegrated, displayAudio.integrated),
    truePeak: fmtMetric(displayAudio.tpMax),
    correlation: fmtCorrelation(displayAudio),
  };

  return STATS_CANONICAL_ORDER.map((id) => ({
    id,
    ...STATS_META[id],
    value: value[id],
  }));
}
