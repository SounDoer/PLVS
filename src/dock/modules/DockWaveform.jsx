import { useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";

const WINDOW_SEC = 30;
const VIEW_W = 300;
const VIEW_H = 40;

/** Max absolute envelope across channels for one row, linear [0, 1]. */
function rowEnvelope(row) {
  const mins = Array.isArray(row?.waveformMin) ? row.waveformMin : [];
  const maxs = Array.isArray(row?.waveformMax) ? row.waveformMax : [];
  let peak = 0;
  for (const v of mins) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  for (const v of maxs) if (Number.isFinite(v)) peak = Math.max(peak, Math.abs(v));
  return Math.min(1, peak);
}

/** Scrolling compact waveform: symmetric envelope of the last 30 s. */
export function DockWaveform() {
  const { histSourceList = [] } = useHistoryData() ?? {};
  const windowSamples = Math.round(WINDOW_SEC / HIST_SAMPLE_SEC);
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
      const env = rowEnvelope(rows[i]);
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
