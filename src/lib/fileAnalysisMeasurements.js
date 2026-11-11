import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import { roleTokensToLabels } from "../math/channelRoles.js";
import { STATS_META } from "./statsCatalog.js";

// Order is the stable export order; the toolbar can display any user-selected subset.
export const FILE_METRICS = Object.freeze(
  [
    { id: "integrated", field: "integratedLufs" },
    { id: "lra", field: "lra", label: "LRA" },
    { id: "momentaryMax", field: "mMaxLufs", location: "mMaxWindowEnd" },
    { id: "shortTermMax", field: "stMaxLufs", location: "stMaxWindowEnd" },
    {
      id: "samplePeakMax",
      field: "samplePeakMaxDb",
      label: "Sample Peak Max",
      unit: "dBFS",
      location: "samplePeakMax",
    },
    { id: "truePeak", field: "truePeakMaxDbtp", location: "truePeakMax" },
    { id: "dialogueIntegrated", field: "dialogueLoudnessLufs", dialogue: true },
    {
      id: "loudnessToDialogueRatio",
      field: "loudnessToDialogueRatioLu",
      dialogue: true,
      label: "LDR",
    },
    { id: "dialogueCoverage", field: "dialogueCoveragePercent", dialogue: true },
    { id: "dialogueRange", field: "dialogueRangeLu", dialogue: true },
  ].map((metric) =>
    Object.freeze({
      label: STATS_META[metric.id]?.label,
      unit: STATS_META[metric.id]?.unit,
      ...metric,
    })
  )
);

export const DEFAULT_FILE_METRIC_IDS = Object.freeze(["integrated", "lra", "truePeak"]);

export const FILE_UNAVAILABLE_EXPLANATIONS = Object.freeze({
  notEnabled: "Dialogue Detection was off.",
  detectorFailed: "Dialogue Detection failed during this analysis.",
  noDialogue: "No dialogue was detected.",
  insufficientData: "There was insufficient evidence to measure this value.",
  belowMeasurementFloor: "The signal was below the measurement floor or loudness gate.",
  unavailable: "This analysis did not record this measurement.",
});

export function fileChannelLabels(summary, roles) {
  return getPeakMeterChannelLabels(summary.channelCount ?? summary.channels, {
    formatId: summary.loudnessLayoutKnown ? summary.loudnessLayout : undefined,
    resolvedLayout: "unknown",
    overrideLabels: Array.isArray(roles) ? roleTokensToLabels(roles) : undefined,
  });
}

export function fileUnavailableReasons(summary, dialogue, decodedFrames) {
  const reasons = {};
  const elapsed =
    Number.isFinite(decodedFrames) && summary.sampleRateHz > 0
      ? decodedFrames / summary.sampleRateHz
      : (summary.durationMs ?? 0) / 1000;
  for (const metric of FILE_METRICS) {
    if (Number.isFinite(summary[metric.field])) continue;
    if (metric.dialogue) {
      reasons[metric.field] = !dialogue.enabled
        ? "notEnabled"
        : dialogue.error
          ? "detectorFailed"
          : metric.id !== "dialogueCoverage" && summary.dialogueCoveragePercent === 0
            ? "noDialogue"
            : "insufficientData";
    } else if (metric.id === "truePeak" || metric.id === "samplePeakMax") {
      reasons[metric.field] =
        elapsed <= 0
          ? "insufficientData"
          : summary.channelPeaks.length
            ? "belowMeasurementFloor"
            : "unavailable";
    } else {
      const needed = metric.id === "lra" || metric.id === "shortTermMax" ? 3 : 0.4;
      reasons[metric.field] =
        elapsed < needed || (metric.id === "lra" && Number.isFinite(summary.integratedLufs))
          ? "insufficientData"
          : "belowMeasurementFloor";
    }
  }
  return reasons;
}
