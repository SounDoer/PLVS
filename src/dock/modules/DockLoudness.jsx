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
export function DockLoudness({ controls }) {
  const { displayAudio } = useFrameData();
  const { histSourceList = [] } = useHistoryData() ?? {};
  const metric = METRICS.find((candidate) => candidate.key === controls?.metric) ?? METRICS[0];
  const value = displayAudio?.[metric.key];

  const sparkSamples = Math.round(SPARK_WINDOW_SEC / HIST_SAMPLE_SEC);
  // History rows store the short keys written by FrameIntake.pushHistRow (m / st).
  const path = buildHistoryPath(
    histSourceList,
    "st",
    sparkSamples,
    0,
    (v) => loudnessHistY(v, SPARK_H),
    SPARK_W
  );

  return (
    <div className="flex h-full min-w-0 items-center gap-2 px-2">
      <div className="flex shrink-0 items-baseline gap-1 px-1">
        <span
          className="font-[family-name:var(--ui-font-mono)] text-lg font-semibold leading-none tabular-nums"
          style={{ color: metric.color }}
        >
          {fmtMetric(value)}
        </span>
        <span className="text-[9px] font-bold text-muted-foreground">{metric.short}</span>
      </div>
      {controls?.showSparkline !== false ? (
        <svg
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          className="h-6 w-full min-w-12 flex-1"
          aria-hidden="true"
        >
          {controls?.showReference ? (
            <line
              x1="0"
              x2={SPARK_W}
              y1={loudnessHistY(controls.referenceLufs, SPARK_H)}
              y2={loudnessHistY(controls.referenceLufs, SPARK_H)}
              stroke="var(--ui-chart-reference)"
              strokeWidth="1"
              strokeDasharray="3 3"
            />
          ) : null}
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
      ) : null}
    </div>
  );
}
