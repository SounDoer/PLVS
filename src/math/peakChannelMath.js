import { getPeakMeterChannelLabels } from "./peakMeterChannelLabels.js";

/**
 * Peak channels view-model for the Peak panel.
 * Uses `peakDb` when available; otherwise falls back to stereo sample L/R.
 *
 * @param {any} displayAudio
 * @param {import("./peakMeterChannelLabels.js").PeakMeterChannelLabelsContext} [labelCtx]
 * @returns {{ label: string, valueDb: number }[]}
 */
export function getPeakChannels(displayAudio, labelCtx) {
  const peakDb = Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb.slice(0, 16) : null;
  if (peakDb && peakDb.length > 0) {
    const labels = getPeakMeterChannelLabels(peakDb.length, labelCtx || {});
    return peakDb.map((v, i) => ({
      label: labels[i] ?? `Ch ${i + 1}`,
      valueDb: Number.isFinite(v) ? v : -Infinity,
    }));
  }

  const l = Number.isFinite(displayAudio?.sampleL) ? displayAudio.sampleL : -Infinity;
  const r = Number.isFinite(displayAudio?.sampleR) ? displayAudio.sampleR : -Infinity;
  return [
    { label: "L", valueDb: l },
    { label: "R", valueDb: r },
  ];
}
