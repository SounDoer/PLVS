import { useId, useMemo } from "react";
import { loudnessHistY } from "../../config/scales.js";
import { loudnessTraceGradientStops } from "../../lib/loudnessTraceColor.js";
import { RuleGradient } from "../../components/panels/LoudnessRuleGradient.jsx";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { buildHistoryPath, buildHistoryPathFromIndex } from "../../math/historyMath.js";
import { fmtMetric } from "../../math/formatMath.js";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { DockHistoryWindowHud, dockHistoryInteractionProps } from "./DockHistoryInteraction.jsx";
import { DockExpandedMetric } from "./DockExpandedMetric.jsx";

const READOUTS = [
  { key: "momentary", short: "M", label: "Momentary" },
  { key: "shortTerm", short: "ST", label: "Short-term" },
  { key: "integrated", short: "I", label: "Integrated" },
];

const SPARK_W = 120;
const SPARK_H = 60;
const DEFAULT_VISIBLE_LAYER_IDS = ["momentary", "shortTerm", "ref"];

function DockLoudnessReadouts({ displayAudio }) {
  return (
    <div
      data-testid="dock-loudness-readouts"
      className="grid min-h-0 shrink-0 items-baseline content-around"
      style={{
        gridTemplateColumns: "max-content max-content",
        gridTemplateRows: "repeat(3, max-content)",
        columnGap: "var(--ui-dock-gap-column)",
      }}
    >
      {READOUTS.map(({ key, short, label }) => {
        const formatted = fmtMetric(displayAudio?.[key]);
        return (
          <div
            key={key}
            data-testid="dock-loudness-readout"
            className="contents"
            aria-label={`${label} ${formatted} LUFS`}
          >
            <span
              data-testid="dock-loudness-readout-label"
              className="justify-self-start font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground"
            >
              {short}
            </span>
            <span className="w-[var(--ui-dock-readout-w)] justify-self-end whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold leading-none tabular-nums text-foreground">
              {formatted}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function DockLoudnessExpandedReadouts({ displayAudio }) {
  return (
    <div
      data-testid="dock-loudness-readouts"
      className="grid min-w-0 shrink-0 grid-cols-3 items-start"
      style={{ columnGap: "var(--ui-dock-gap-region)" }}
    >
      {READOUTS.map(({ key, short, label }) => {
        const formatted = fmtMetric(displayAudio?.[key]);
        return (
          <div
            key={key}
            data-testid="dock-loudness-readout"
            className="min-w-0 overflow-hidden"
            aria-label={`${label} ${formatted} LUFS`}
          >
            <DockExpandedMetric label={short} value={formatted} unit="LUFS" />
          </div>
        );
      })}
    </div>
  );
}

/** Compact Loudness history with the normal panel's layers and M/ST/I readouts. */
export function DockLoudness({ controls, heightMode = "standard" }) {
  const { displayAudio } = useFrameData();
  const {
    histSourceList = [],
    loudnessDisplayIndex = null,
    referenceLufs = null,
    momentaryRules,
    shortTermRules,
  } = useHistoryData() ?? {};
  const visibleLayerIds = controls?.loudnessHistoryVisibleLayerIds ?? DEFAULT_VISIBLE_LAYER_IDS;
  const showMomentary = visibleLayerIds.includes("momentary");
  const showShortTerm = visibleLayerIds.includes("shortTerm");
  // Null reference means the profile is Off: no line, whatever the layer ids still say.
  const showReference = visibleLayerIds.includes("ref") && Number.isFinite(referenceLufs);
  const yRange = {
    min: controls?.loudnessYMinDb ?? -64,
    max: controls?.loudnessYMaxDb ?? 0,
  };
  const sparkSamples = Math.round((controls?.dockHistoryWindowSec ?? 60) / HIST_SAMPLE_SEC);
  const historyLength = histSourceList.length;
  // The live history ring is mutated in place. Once it reaches capacity, both its reference and
  // length stay stable while pushes advance the samples, so length alone would freeze these
  // memos. The newest timestamp is the advancing version signal after the ring fills.
  const latestSampleTimestampMs =
    historyLength > 0
      ? typeof histSourceList.rowAt === "function"
        ? histSourceList.rowAt(historyLength - 1)?.timestampMs
        : histSourceList[historyLength - 1]?.timestampMs
      : undefined;
  const momentaryPath = useMemo(
    () =>
      loudnessDisplayIndex
        ? buildHistoryPathFromIndex(
            histSourceList,
            loudnessDisplayIndex,
            "m",
            sparkSamples,
            0,
            (value) => loudnessHistY(value, SPARK_H, yRange),
            SPARK_W
          )
        : buildHistoryPath(
            histSourceList,
            "m",
            sparkSamples,
            0,
            (value) => loudnessHistY(value, SPARK_H, yRange),
            SPARK_W
          ),
    // The history array is mutated in place; length advances while filling and timestamp after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      histSourceList,
      loudnessDisplayIndex,
      historyLength,
      latestSampleTimestampMs,
      sparkSamples,
      yRange.min,
      yRange.max,
    ]
  );
  const shortTermPath = useMemo(
    () =>
      loudnessDisplayIndex
        ? buildHistoryPathFromIndex(
            histSourceList,
            loudnessDisplayIndex,
            "st",
            sparkSamples,
            0,
            (value) => loudnessHistY(value, SPARK_H, yRange),
            SPARK_W
          )
        : buildHistoryPath(
            histSourceList,
            "st",
            sparkSamples,
            0,
            (value) => loudnessHistY(value, SPARK_H, yRange),
            SPARK_W
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      histSourceList,
      loudnessDisplayIndex,
      historyLength,
      latestSampleTimestampMs,
      sparkSamples,
      yRange.min,
      yRange.max,
    ]
  );
  const showReferenceLine = showReference && Number.isFinite(referenceLufs);
  const referenceY = showReferenceLine ? loudnessHistY(referenceLufs, SPARK_H, yRange) : null;
  const mStops = loudnessTraceGradientStops(momentaryRules, yRange, "var(--ui-loudness-momentary)");
  const stStops = loudnessTraceGradientStops(
    shortTermRules,
    yRange,
    "var(--ui-loudness-shortterm)"
  );
  const mGradId = useId().replace(/:/g, "");
  const stGradId = useId().replace(/:/g, "");
  const expanded = heightMode === "expanded";

  return (
    <div
      {...dockHistoryInteractionProps(controls)}
      className={`flex h-full min-w-0 items-stretch ${expanded ? "flex-col" : "flex-row"}`}
      style={{
        gap: "var(--ui-dock-gap-region)",
        padding: "var(--ui-dock-pad-y) var(--ui-dock-pad-x)",
      }}
    >
      <div className="relative min-h-0 min-w-12 flex-1">
        <svg
          data-testid="dock-loudness-history"
          viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
          preserveAspectRatio="none"
          className="h-full w-full"
          role="img"
          aria-label="Loudness history"
        >
          <defs>
            {mStops ? <RuleGradient id={mGradId} stops={mStops} height={SPARK_H} /> : null}
            {stStops ? <RuleGradient id={stGradId} stops={stStops} height={SPARK_H} /> : null}
          </defs>
          {showMomentary && momentaryPath ? (
            <path
              data-testid="dock-loudness-momentary"
              d={momentaryPath}
              fill="none"
              stroke={mStops ? `url(#${mGradId})` : "var(--ui-loudness-momentary)"}
              strokeWidth="var(--ui-loudness-momentary-stroke-width)"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {showShortTerm && shortTermPath ? (
            <path
              data-testid="dock-loudness-short-term"
              d={shortTermPath}
              fill="none"
              stroke={stStops ? `url(#${stGradId})` : "var(--ui-loudness-shortterm)"}
              strokeWidth="var(--ui-loudness-shortterm-stroke-width)"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {referenceY != null ? (
            <line
              data-testid="dock-loudness-reference-line"
              x1={0}
              x2={SPARK_W}
              y1={referenceY}
              y2={referenceY}
              stroke="var(--foreground)"
              strokeWidth="1"
              strokeDasharray="3 3"
              vectorEffect="non-scaling-stroke"
              opacity={0.7}
            />
          ) : null}
        </svg>
        <DockHistoryWindowHud controls={controls} />
      </div>
      {controls?.showReadouts !== false ? (
        expanded ? (
          <DockLoudnessExpandedReadouts displayAudio={displayAudio} />
        ) : (
          <DockLoudnessReadouts displayAudio={displayAudio} />
        )
      ) : null}
    </div>
  );
}
