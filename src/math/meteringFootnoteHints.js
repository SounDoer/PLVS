/**
 * Footer / status-line hints when the channel layout preset does not match the live stream,
 * or when auto layout cannot classify multichannel PCM. Add new rules here as formats grow.
 *
 * @typedef {object} MeteringFootnoteHint
 * @property {string} id Stable id for keys / analytics (kebab-case).
 * @property {string} message Short single-line text for the status bar.
 * @property {string} [title] Optional tooltip with more detail.
 */

/**
 * @param {object} ctx
 * @param {boolean} ctx.running
 * @param {string} ctx.channelLayout UI setting: `auto` | `stereo` | `5.1` | `7.1`
 * @param {number} ctx.channelCount Live peak meter channel count (0 when idle / unknown).
 * @returns {MeteringFootnoteHint[]}
 */
export function buildMeteringFootnoteHints({ running, channelLayout, channelCount }) {
  const ch = Number.isFinite(channelCount) ? Math.max(0, Math.floor(channelCount)) : 0;
  const layout =
    channelLayout === "stereo" ||
    channelLayout === "5.1" ||
    channelLayout === "7.1" ||
    channelLayout === "auto"
      ? channelLayout
      : "auto";
  const out = [];

  if (!running || ch < 1) {
    return out;
  }

  if (layout === "auto" && ch > 2 && ch !== 6 && ch !== 8) {
    out.push({
      id: "layout-auto-unknown-multichannel",
      message: `Multi-channel (Auto): ${ch} ch is not a recognized layout; loudness uses Ch 1–2.`,
      title:
        "Auto recognizes mono, stereo, 5.1, and 7.1. For other channel counts, pick a matching layout when available; otherwise loudness falls back to the first two channels.",
    });
  }

  if (layout === "5.1" && ch < 6) {
    out.push({
      id: "layout-manual-51-insufficient-channels",
      message: `5.1 preset but stream is ${ch} ch: loudness follows stereo (Ch 1–2).`,
      title:
        "BS.1770 5.1 aggregation requires six channels (FL FR C LFE SL SR). With fewer channels, the engine treats the stream as stereo for loudness while peak meters still reflect each live channel.",
    });
  }

  if (layout === "7.1" && ch < 8) {
    out.push({
      id: "layout-manual-71-insufficient-channels",
      message: `7.1 preset but stream is ${ch} ch: loudness follows stereo (Ch 1–2).`,
      title:
        "BS.1770 7.1 aggregation requires eight channels in the selected 7.1 layout. With fewer channels, the engine treats the stream as stereo for loudness while peak meters still reflect each live channel.",
    });
  }

  if (layout === "stereo" && ch > 2) {
    out.push({
      id: "layout-manual-stereo-surplus-channels",
      message: `Stereo preset but stream is ${ch} ch: loudness uses Ch 1–2 only; peaks show all ${ch}.`,
      title:
        "With the Stereo layout preset, integrated loudness uses only the first two interleaved channels. Per-channel peak meters still show every channel in the stream.",
    });
  }

  return out;
}
