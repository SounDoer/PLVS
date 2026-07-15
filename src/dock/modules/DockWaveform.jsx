import { useMemo } from "react";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { DockHistoryWindowHud, dockHistoryInteractionProps } from "./DockHistoryInteraction.jsx";

const VIEW_W = 300;
const VIEW_H = 40;

/** Max absolute envelope across channels for one row, linear [0, 1]. */
function rowEnvelope(row, controls) {
  const mins = Array.isArray(row?.waveformMin) ? row.waveformMin : [];
  const maxs = Array.isArray(row?.waveformMax) ? row.waveformMax : [];
  let peak = 0;
  const indexes = controls?.view === "single" ? [controls.channel] : mins.map((_, index) => index);
  for (const index of indexes) {
    if (Number.isFinite(mins[index])) peak = Math.max(peak, Math.abs(mins[index]));
    if (Number.isFinite(maxs[index])) peak = Math.max(peak, Math.abs(maxs[index]));
  }
  return Math.min(1, peak);
}

/** Build a bounded envelope path: at most two points per horizontal pixel column. */
export function buildDockWaveformPath(
  histSourceList,
  controls,
  windowSamples,
  viewWidth = VIEW_W,
  viewHeight = VIEW_H
) {
  const total = histSourceList.length;
  const safeWindowSamples = Math.max(2, Math.floor(windowSamples));
  if (total < 2) return "";
  const oldestVisible = total - safeWindowSamples;
  const start = Math.max(0, oldestVisible);
  const end = total - 1;
  const columns = Math.max(2, Math.min(Math.floor(viewWidth), safeWindowSamples));
  const amplitudes = new Float32Array(columns);
  const populated = new Uint8Array(columns);

  for (let index = start; index <= end; index += 1) {
    const position = index - oldestVisible;
    const column = Math.max(
      0,
      Math.min(
        columns - 1,
        Math.round((position / Math.max(1, safeWindowSamples - 1)) * (columns - 1))
      )
    );
    amplitudes[column] = Math.max(amplitudes[column], rowEnvelope(histSourceList[index], controls));
    populated[column] = 1;
  }

  const mid = viewHeight / 2;
  const top = [];
  const bottom = [];
  for (let column = 0; column < columns; column += 1) {
    if (!populated[column]) continue;
    const x = (column / Math.max(1, columns - 1)) * viewWidth;
    const extent = amplitudes[column] * mid;
    top.push(`${top.length ? "L" : "M"} ${x} ${mid - extent}`);
    bottom.push(`L ${x} ${mid + extent}`);
  }
  if (top.length < 2) return "";
  return `${top.join(" ")} ${bottom.reverse().join(" ")} Z`;
}

/** Scrolling compact waveform with the Dock's shared live time window. */
export function DockWaveform({ controls }) {
  const { histSourceList = [] } = useHistoryData() ?? {};
  const windowSamples = Math.round((controls?.dockHistoryWindowSec ?? 60) / HIST_SAMPLE_SEC);
  const historyLength = histSourceList.length;
  const path = useMemo(
    () => buildDockWaveformPath(histSourceList, controls, windowSamples),
    // The history array is mutated in place; length is the advancing version signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [histSourceList, historyLength, controls?.view, controls?.channel, windowSamples]
  );

  return (
    <div
      {...dockHistoryInteractionProps(controls)}
      className="relative h-full min-w-0 flex-1 px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)]"
    >
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {path ? <path d={path} fill="var(--ui-waveform-trace)" opacity="0.6" /> : null}
      </svg>
      <DockHistoryWindowHud controls={controls} />
    </div>
  );
}
