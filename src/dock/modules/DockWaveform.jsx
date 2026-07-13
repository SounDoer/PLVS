import { useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";

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

/** Scrolling compact waveform: symmetric envelope of the last 30 s. */
export function DockWaveform({ controls }) {
  const { histSourceList = [] } = useHistoryData() ?? {};
  const windowSamples = Math.round((controls?.windowSec ?? 30) / HIST_SAMPLE_SEC);
  const rows = histSourceList.slice(-windowSamples);

  let d = "";
  if (rows.length >= 2) {
    const mid = VIEW_H / 2;
    const xOf = (i) => (i / (windowSamples - 1)) * VIEW_W;
    // Right-align: newest sample at the right edge.
    const offset = windowSamples - rows.length;
    let top = "";
    let bottom = "";
    for (let i = 0; i < rows.length; i++) {
      const env = rowEnvelope(rows[i], controls);
      const x = xOf(offset + i);
      const yTop = mid - env * mid;
      const yBottom = mid + env * mid;
      top += `${top ? " L" : "M"} ${x} ${yTop}`;
      bottom = ` L ${x} ${yBottom}${bottom}`;
    }
    d = `${top}${bottom} Z`;
  }

  return (
    <div className="h-full min-w-0 flex-1 px-1 py-[6px]">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        className="h-full w-full"
        aria-hidden="true"
      >
        {d ? <path d={d} fill="var(--ui-waveform-trace)" opacity="0.6" /> : null}
      </svg>
    </div>
  );
}
