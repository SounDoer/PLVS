import { useState } from "react";
import { loudnessHistY } from "../../config/scales.js";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { buildHistoryPath } from "../../math/historyMath.js";
import { fmtMetric } from "../../math/formatMath.js";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";

const METRICS = [
  { key: "shortTerm", short: "S", color: "var(--ui-loudness-shortterm)" },
  { key: "integrated", short: "I", color: "var(--ui-loudness-shortterm)" },
  { key: "momentary", short: "M", color: "var(--ui-loudness-momentary)" },
];

const SPARK_WINDOW_SEC = 60;
const SPARK_W = 120;
const SPARK_H = 24;

/** Primary LUFS readout (click cycles S/I/M) + a fixed-window sparkline. */
export function DockLoudness() {
  const { displayAudio } = useFrameData();
  const { histSourceList = [] } = useHistoryData() ?? {};
  const [metricIndex, setMetricIndex] = useState(0);
  const metric = METRICS[metricIndex];
  const value = displayAudio?.[metric.key];

  const sparkSamples = Math.round(SPARK_WINDOW_SEC / HIST_SAMPLE_SEC);
  const path = buildHistoryPath(
    histSourceList,
    "shortTerm",
    sparkSamples,
    0,
    (v) => loudnessHistY(v, SPARK_H),
    SPARK_W
  );

  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-2">
      <button
        type="button"
        aria-label="Loudness metric (click to cycle)"
        onClick={() => setMetricIndex((i) => (i + 1) % METRICS.length)}
        className="flex shrink-0 items-baseline gap-1 rounded px-1 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <span
          className="font-[family-name:var(--ui-font-mono)] text-lg font-semibold leading-none tabular-nums"
          style={{ color: metric.color }}
        >
          {fmtMetric(value)}
        </span>
        <span className="text-[9px] font-bold text-muted-foreground">{metric.short}</span>
      </button>
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        preserveAspectRatio="none"
        className="h-6 w-full min-w-12 flex-1"
        aria-hidden="true"
      >
        {path ? (
          <path
            d={path}
            fill="none"
            stroke="var(--ui-loudness-shortterm)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        ) : null}
      </svg>
    </div>
  );
}
