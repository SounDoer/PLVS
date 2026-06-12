/**
 * Single owner for deciding the effective channel layout.
 *
 * @typedef {"auto" | "stereo" | "5.1" | "7.1"} ChannelLayoutSetting
 * @typedef {"unknown" | "mono" | "stereo" | "lcr" | "quad" | "surround50" | "5.1" | "7.1"} ResolvedChannelLayout
 *
 * @typedef {object} ChannelLayoutResolution
 * @property {"auto" | "manual"} mode
 * @property {ChannelLayoutSetting} setting
 * @property {ResolvedChannelLayout} resolved
 */

/**
 * @param {ChannelLayoutSetting} setting
 * @param {{ channelCount?: number | null | undefined } | undefined} ctx
 * @returns {ChannelLayoutResolution}
 */
export function resolveChannelLayout(setting, ctx) {
  const s =
    setting === "stereo" || setting === "5.1" || setting === "7.1" || setting === "auto"
      ? setting
      : "auto";

  if (s === "stereo") return { mode: "manual", setting: "stereo", resolved: "stereo" };
  if (s === "5.1") return { mode: "manual", setting: "5.1", resolved: "5.1" };
  if (s === "7.1") return { mode: "manual", setting: "7.1", resolved: "7.1" };

  // Auto mode: map standard channel counts to their layout; non-standard counts (e.g. 7) stay unknown.
  const ch = Number.isFinite(ctx?.channelCount) ? Math.floor(Number(ctx.channelCount)) : 0;
  /** @type {Record<number, ResolvedChannelLayout>} */
  const byCount = {
    1: "mono",
    2: "stereo",
    3: "lcr",
    4: "quad",
    5: "surround50",
    6: "5.1",
    8: "7.1",
  };
  const resolved = byCount[ch] ?? "unknown";
  return { mode: "auto", setting: "auto", resolved };
}
