import { troubleshootingUrl } from "./troubleshooting.js";
import { describeAudioDrop } from "./captureHealth.js";
import { CHANNEL_LAYOUTS, standardLayoutIdForCount } from "../math/channelLayoutTable.js";

/**
 * The layout PLVS chose from the channel count alone, or null. A source that reports its roles (a
 * Live output's speaker mapping, a file's stored layout) or a manual layout is not inferred, and
 * mono or stereo by count is not worth a notice. The count rule is the only way a known layout
 * arises without roles, so the layout is the count's standard layout.
 * @param {{ channelCount: number, loudnessLayoutKnown?: boolean | null, autoChannelRoles?: string[] | null, manualRoles?: string[] | null }} input
 * @returns {{ layoutId: string, name: string, channelCount: number } | null}
 */
export function inferredChannelLayout({
  channelCount,
  loudnessLayoutKnown = null,
  autoChannelRoles = null,
  manualRoles = null,
}) {
  if (!(channelCount >= 3) || loudnessLayoutKnown !== true || Array.isArray(manualRoles)) {
    return null;
  }
  if (Array.isArray(autoChannelRoles) && autoChannelRoles.length === channelCount) return null;
  const layoutId = standardLayoutIdForCount(channelCount);
  const layout = CHANNEL_LAYOUTS.find((candidate) => candidate.id === layoutId);
  return layout ? { layoutId: layout.id, name: layout.name, channelCount } : null;
}

/** @typedef {{ id: string, kind: string, text: string, details: string, action?: string, helpTopic?: string, phase?: string, requiresAttention?: boolean }} AppStatusItem */

/** @param {AppStatusItem} item */
export function statusHelpTarget(item) {
  return troubleshootingUrl(item.helpTopic) ? `status-help:${item.id}:${item.helpTopic}` : null;
}

/** @param {AppStatusItem} item */
export function statusActionTarget(item) {
  return item.action ? `status-action:${item.id}:${item.action}` : null;
}

/**
 * Current conditions, rather than a history of old notifications.
 * @param {{ notice?: {kind?: string, text: string, details?: string, helpTopic?: string, requiresAttention?: boolean}, layoutUnknown?: boolean, layoutInferred?: { name: string, channelCount: number } | null, autoChannelRoles?: string[], audioDrop?: {chunks: number, since: number}, update?: {phase: string, text: string, action?: string}, configurationRestart?: "required" | "restarting" | null }} input
 */
export function buildAppStatusItems({
  notice = null,
  layoutUnknown = false,
  layoutInferred = null,
  autoChannelRoles = null,
  audioDrop = null,
  update = null,
  configurationRestart = null,
} = {}) {
  /** @type {AppStatusItem[]} */
  const items = [];
  if (notice)
    items.push({
      id: "notice",
      kind: notice.kind ?? "info",
      text: notice.text,
      details: notice.details || notice.text,
      ...(notice.helpTopic ? { helpTopic: notice.helpTopic } : null),
      requiresAttention: notice.requiresAttention === true,
    });
  if (configurationRestart) {
    const restarting = configurationRestart === "restarting";
    items.push({
      id: "configuration-restart",
      kind: "warning",
      text: restarting ? "Restarting PLVS…" : "Restart Required",
      details: restarting
        ? "Configuration saved. PLVS is restarting."
        : "Configuration saved. Restart PLVS to finish.",
      ...(!restarting && { action: "restart-configuration" }),
    });
  }
  if (audioDrop)
    items.push({
      id: "audio-drop",
      kind: "warning",
      text: "Audio Dropped",
      helpTopic: "audio-dropped",
      details: describeAudioDrop(audioDrop),
    });
  if (layoutUnknown)
    items.push({
      id: "channel-layout",
      kind: "warning",
      text: "Channel Layout Unknown",
      helpTopic: "channel-layout-unknown",
      details:
        (Array.isArray(autoChannelRoles) && autoChannelRoles.some((role) => role !== "generic")
          ? `The system identifies some roles in the ${autoChannelRoles.length}-channel stream: ${autoChannelRoles.flatMap((role, index) => (role !== "generic" ? [`${index + 1}=${role}`] : [])).join(", ")}. Other channel roles remain unknown. `
          : "Channel layout is not recognized. ") +
        "Loudness uses channels 1–2 only. True Peak Max covers every channel. Set the channel layout in Settings.",
      action: "settings",
    });
  if (layoutInferred && !layoutUnknown)
    items.push({
      id: "channel-layout-inferred",
      kind: "info",
      text: "Channel Layout Inferred",
      helpTopic: "channel-layout-inferred",
      details:
        `The source does not report its speaker layout, so PLVS reads its ${layoutInferred.channelCount} channels as ${layoutInferred.name} by count. ` +
        "If they are separate microphones or use another layout, set the channel layout in Settings.",
      action: "settings",
    });
  if (update)
    items.push({
      id: "update",
      kind: update.phase === "error" ? "error" : "update",
      text: update.text,
      details:
        update.phase === "error"
          ? update.action === "check-update"
            ? "PLVS could not check for updates. Retry the update check. Your installed version and metering are unaffected."
            : "The update could not be completed. Open update details to review or retry. Metering is unaffected."
          : update.text,
      ...(update.phase === "error" ? { helpTopic: "update" } : null),
      phase: update.phase,
      action: update.action ?? "update",
    });
  const priority = { error: 0, warning: 1, guard: 2, info: 3, update: 4 };
  return items.sort(
    (a, b) =>
      Number(b.requiresAttention === true) - Number(a.requiresAttention === true) ||
      (priority[a.kind] ?? 3) - (priority[b.kind] ?? 3)
  );
}
