/**
 * Peak meter column titles by interleaved channel index. Default 6ch order matches the native
 * 5.1 / BS.1770 path: FL, FR, FC, LFE, SL, SR → L, R, C, LFE, Ls, Rs.
 *
 * Add new entries to {@link PEAK_METER_CHANNEL_FORMATS} and {@link ORDERED_FORMAT_IDS}, or pass
 * `ctx.formatId` when the backend can identify a layout explicitly.
 */

/** @typedef {"auto" | "stereo" | "5.1"} ChannelLayoutSetting */
/** @typedef {"unknown" | "stereo" | "5.1"} ResolvedChannelLayout */

/**
 * @typedef {object} PeakMeterChannelLabelsContext
 * @property {ChannelLayoutSetting} [channelLayout]
 * @property {ResolvedChannelLayout} [resolvedLayout]
 * @property {string} [formatId] Optional key in {@link PEAK_METER_CHANNEL_FORMATS} when detection supplies it.
 * @property {string[]} [overrideLabels] User per-channel labels; used verbatim when length === channelCount.
 */

/**
 * @typedef {object} PeakMeterChannelFormatDef
 * @property {string} id
 * @property {number} channels Exact channel count for this row.
 * @property {string[]} labels Short label per interleaved channel index.
 */

/** @type {Record<string, PeakMeterChannelFormatDef>} */
export const PEAK_METER_CHANNEL_FORMATS = Object.freeze({
  mono: { id: "mono", channels: 1, labels: ["M"] },
  stereo: { id: "stereo", channels: 2, labels: ["L", "R"] },
  lcr: { id: "lcr", channels: 3, labels: ["L", "R", "C"] },
  quad: { id: "quad", channels: 4, labels: ["L", "R", "Ls", "Rs"] },
  surround50: { id: "surround50", channels: 5, labels: ["L", "R", "C", "Ls", "Rs"] },
  surround51: {
    id: "surround51",
    channels: 6,
    labels: ["L", "R", "C", "LFE", "Ls", "Rs"],
  },
  surround71: {
    id: "surround71",
    channels: 8,
    labels: ["L", "R", "C", "LFE", "Ls", "Rs", "Lb", "Rb"],
  },
});

const ORDERED_FORMAT_IDS = [
  "mono",
  "stereo",
  "lcr",
  "quad",
  "surround50",
  "surround51",
  "surround71",
];

/**
 * @param {number} channelCount
 * @returns {string[] | null} Null if no registered format matches the count exactly.
 */
function labelsForExactChannelCount(channelCount) {
  const n = Math.max(0, Math.floor(channelCount));
  for (const fid of ORDERED_FORMAT_IDS) {
    const def = PEAK_METER_CHANNEL_FORMATS[fid];
    if (def && def.channels === n) {
      return [...def.labels];
    }
  }
  return null;
}

/**
 * @param {number} channelCount
 * @param {PeakMeterChannelLabelsContext} [ctx]
 * @returns {string[]}
 */
export function getPeakMeterChannelLabels(channelCount, ctx = {}) {
  const n = Math.max(0, Math.floor(Number(channelCount)));
  if (n === 0) {
    return [];
  }

  if (Array.isArray(ctx.overrideLabels) && ctx.overrideLabels.length === n) {
    return [...ctx.overrideLabels];
  }

  if (ctx.formatId) {
    const def = PEAK_METER_CHANNEL_FORMATS[ctx.formatId];
    if (def && def.channels === n) {
      return [...def.labels];
    }
  }

  // Auto mode with unknown layout: skip name matching to avoid mislabelling channels.
  if (ctx.resolvedLayout === "unknown") {
    return Array.from({ length: n }, (_, i) => `Ch ${i + 1}`);
  }

  const exact = labelsForExactChannelCount(n);
  if (exact) {
    return exact;
  }

  return Array.from({ length: n }, (_, i) => `Ch ${i + 1}`);
}
