import { getPeakMeterChannelLabels } from "./peakMeterChannelLabels.js";

/**
 * Channel view-model for Peak-family Level Meter modes.
 * Uses `field` when available; otherwise falls back to stereo sample L/R for Peak.
 *
 * @param {any} displayAudio
 * @param {import("./peakMeterChannelLabels.js").PeakMeterChannelLabelsContext} [labelCtx]
 * @returns {{ label: string, valueDb: number }[]}
 */
export function getPeakChannels(displayAudio, labelCtx, field = "peakDb") {
  const channelDb = Array.isArray(displayAudio?.[field]) ? displayAudio[field].slice(0, 16) : null;
  if (channelDb && channelDb.length > 0) {
    const labels = getPeakMeterChannelLabels(channelDb.length, labelCtx || {});
    return channelDb.map((v, i) => ({
      label: labels[i] ?? `Ch ${i + 1}`,
      valueDb: Number.isFinite(v) ? v : -Infinity,
    }));
  }

  if (field !== "peakDb") return [];

  const l = Number.isFinite(displayAudio?.sampleL) ? displayAudio.sampleL : -Infinity;
  const r = Number.isFinite(displayAudio?.sampleR) ? displayAudio.sampleR : -Infinity;
  return [
    { label: "L", valueDb: l },
    { label: "R", valueDb: r },
  ];
}
