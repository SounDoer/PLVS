import { getPeakMeterChannelLabels } from "./peakMeterChannelLabels.js";

/**
 * Peak channels view-model for the Peak panel.
 * Uses `peakDb`/`peakHoldDb` when available; otherwise falls back to stereo sample L/R.
 *
 * @param {any} displayAudio
 * @param {import("./peakMeterChannelLabels.js").PeakMeterChannelLabelsContext} [labelCtx]
 * @returns {{ label: string, valueDb: number, holdDb: number | null }[]}
 */
export function getPeakChannels(displayAudio, labelCtx) {
  const peakDb = Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb : null;
  const peakHoldDb = Array.isArray(displayAudio?.peakHoldDb) ? displayAudio.peakHoldDb : null;
  if (peakDb && peakDb.length > 0) {
    const labels = getPeakMeterChannelLabels(peakDb.length, labelCtx || {});
    return peakDb.map((v, i) => ({
      label: labels[i] ?? `Ch ${i + 1}`,
      valueDb: Number.isFinite(v) ? v : -Infinity,
      holdDb: peakHoldDb && Number.isFinite(peakHoldDb[i]) ? peakHoldDb[i] : null,
    }));
  }

  const l = Number.isFinite(displayAudio?.sampleL) ? displayAudio.sampleL : -Infinity;
  const r = Number.isFinite(displayAudio?.sampleR) ? displayAudio.sampleR : -Infinity;
  return [
    {
      label: "L",
      valueDb: l,
      holdDb: Number.isFinite(displayAudio?.samplePeakMaxL) ? displayAudio.samplePeakMaxL : null,
    },
    {
      label: "R",
      valueDb: r,
      holdDb: Number.isFinite(displayAudio?.samplePeakMaxR) ? displayAudio.samplePeakMaxR : null,
    },
  ];
}
