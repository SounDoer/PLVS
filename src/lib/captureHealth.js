/**
 * User-facing copy for Live capture health: an Automatic capture following the system default
 * output, and audio dropped before analysis.
 */
import { formatAudioDeviceLabel } from "./audioDeviceLabels.js";

/**
 * Notice text when a running Automatic Live capture moved to a new default output, otherwise null.
 *
 * @param {{ previousLabel: string, nextLabel: string, captureDeviceId: string, sourceMode: string, running: boolean }} input
 * @returns {string | null}
 */
export function automaticOutputChangeNotice({
  previousLabel,
  nextLabel,
  captureDeviceId,
  sourceMode,
  running,
}) {
  if (!previousLabel || !nextLabel || previousLabel === nextLabel) return null;
  if (captureDeviceId !== "default" || sourceMode !== "live" || !running) return null;
  // Both halves: the hardware name alone cannot tell "CABLE Input" from "CABLE In 16ch", and the
  // endpoint name alone is often just "Speakers".
  const { primary, secondary } = formatAudioDeviceLabel(nextLabel);
  const name = secondary ? `${primary} (${secondary})` : primary;
  return `Output changed to ${name} — measurement restarted`;
}

/**
 * Footer tooltip for audio dropped before analysis in the current Live session.
 *
 * @param {{ chunks: number, since: number }} audioDrop
 * @returns {string}
 */
export function describeAudioDrop({ chunks, since }) {
  const time = new Date(since).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const noun = chunks === 1 ? "chunk" : "chunks";
  return `${chunks} audio ${noun} dropped before analysis since ${time}. Integrated, LRA and max readings may be affected. Clear to reset.`;
}
