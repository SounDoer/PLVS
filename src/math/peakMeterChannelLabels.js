/**
 * Peak meter column titles by interleaved channel index, in WAVE / ffmpeg channel order:
 * 5.1 is FL FR FC LFE SL SR → L R C LFE Ls Rs; 7.1 is FL FR FC LFE BL BR SL SR →
 * L R C LFE Lb Rb Ls Rs. Must match `src-tauri/src/dsp/channel_weights.rs`.
 * Labels name the loudness weighting role, not the WAVE speaker bit: `Ls/Rs` is the +1.5 dB
 * surround pair even where a 5.1 device mask calls it BL/BR.
 *
 * Formats come from the shared channel layout table, keyed by layout id (`5.1`, `7.1.4`, …). Pass
 * `ctx.formatId` when the backend can identify a layout explicitly.
 */

import { CHANNEL_LAYOUTS, layoutsForChannelCount } from "./channelLayoutTable.js";

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
export const PEAK_METER_CHANNEL_FORMATS = Object.freeze(
  Object.fromEntries(
    CHANNEL_LAYOUTS.map((layout) => [
      layout.id,
      { id: layout.id, channels: layout.roles.length, labels: [...layout.roles] },
    ])
  )
);

/**
 * @param {number} channelCount
 * @returns {string[] | null} Null unless exactly one layout has this channel count: 8 channels is
 * 7.1 or 5.1.2 and must not be named by count alone.
 */
function labelsForExactChannelCount(channelCount) {
  const matches = layoutsForChannelCount(Math.max(0, Math.floor(channelCount)));
  return matches.length === 1 ? [...matches[0].roles] : null;
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
