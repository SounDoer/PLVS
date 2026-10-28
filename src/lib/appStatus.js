import { describeAudioDrop } from "./captureHealth.js";

/** @typedef {{ id: string, kind: string, text: string, details: string, action?: string, phase?: string, requiresAttention?: boolean }} AppStatusItem */

/**
 * Current conditions, rather than a history of old notifications.
 * @param {{ notice?: {kind?: string, text: string, details?: string, requiresAttention?: boolean}, layoutUnknown?: boolean, audioDrop?: {chunks: number, since: number}, update?: {phase: string, text: string, action?: string} }} input
 */
export function buildAppStatusItems({
  notice = null,
  layoutUnknown = false,
  audioDrop = null,
  update = null,
} = {}) {
  /** @type {AppStatusItem[]} */
  const items = [];
  if (notice)
    items.push({
      id: "notice",
      kind: notice.kind ?? "info",
      text: notice.text,
      details: notice.details || notice.text,
      requiresAttention: notice.requiresAttention === true,
    });
  if (audioDrop)
    items.push({
      id: "audio-drop",
      kind: "warning",
      text: "Audio Dropped",
      details: describeAudioDrop(audioDrop),
    });
  if (layoutUnknown)
    items.push({
      id: "channel-layout",
      kind: "warning",
      text: "Channel Layout Unknown",
      details:
        "Channel layout is not recognized. Loudness uses channels 1–2 only. Set the channel layout in Settings.",
      action: "settings",
    });
  if (update)
    items.push({
      id: "update",
      kind: update.phase === "error" ? "error" : "update",
      text: update.text,
      details:
        update.phase === "error"
          ? "The update could not be completed. Open update details to review or retry. Metering is unaffected."
          : update.text,
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
