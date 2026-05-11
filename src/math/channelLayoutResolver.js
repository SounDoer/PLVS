/**
 * Single owner for deciding the effective channel layout.
 *
 * Detection is not implemented yet. For now:
 * - Manual presets resolve directly.
 * - Auto resolves to `unknown` (until detection exists).
 */

/**
 * @typedef {"auto" | "stereo" | "5.1"} ChannelLayoutSetting
 * @typedef {"unknown" | "stereo" | "5.1"} ResolvedChannelLayout
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
  const s = setting === "stereo" || setting === "5.1" || setting === "auto" ? setting : "auto";
  const channelCount = Number.isFinite(ctx?.channelCount) ? Number(ctx?.channelCount) : null;

  if (s === "stereo") return { mode: "manual", setting: "stereo", resolved: "stereo" };
  if (s === "5.1") return { mode: "manual", setting: "5.1", resolved: "5.1" };

  // Auto mode: detection not implemented yet.
  // If channelCount is unknown or >2, we still report `unknown` until a detector exists.
  void channelCount;
  return { mode: "auto", setting: "auto", resolved: "unknown" };
}
