import { useId, useMemo } from "react";
import { loudnessHistY } from "../../config/scales.js";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { buildHistoryPath } from "../../math/historyMath.js";
import { fmtMetric } from "../../math/formatMath.js";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { DockHistoryWindowHud, dockHistoryInteractionProps } from "./DockHistoryInteraction.jsx";

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

/** Compact Loudness history with the normal panel's layers and M/ST/I readouts. */
export function DockLoudness({ controls }) {
  const { displayAudio } = useFrameData();
  const { histSourceList = [] } = useHistoryData() ?? {};
  const visibleLayerIds = controls?.loudnessHistoryVisibleLayerIds ?? DEFAULT_VISIBLE_LAYER_IDS;
  const showMomentary = visibleLayerIds.includes("momentary");
  const showShortTerm = visibleLayerIds.includes("shortTerm");
  const showReference = visibleLayerIds.includes("ref");
  const referenceLufs = controls?.loudnessReferenceLufs ?? -23;
  const yRange = {
    min: controls?.loudnessYMinDb ?? -64,
    max: controls?.loudnessYMaxDb ?? 0,
  };
  const sparkSamples = Math.round((controls?.dockHistoryWindowSec ?? 60) / HIST_SAMPLE_SEC);
  const historyLength = histSourceList.length;
  const momentaryPath = useMemo(
    () =>
      buildHistoryPath(
        histSourceList,
        "m",
        sparkSamples,
        0,
        (value) => loudnessHistY(value, SPARK_H, yRange),
        SPARK_W
      ),
    // The history array is mutated in place; length is the advancing version signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [histSourceList, historyLength, sparkSamples, yRange.min, yRange.max]
  );
  const shortTermPath = useMemo(
    () =>
      buildHistoryPath(
        histSourceList,
        "st",
        sparkSamples,
        0,
        (value) => loudnessHistY(value, SPARK_H, yRange),
        SPARK_W
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [histSourceList, historyLength, sparkSamples, yRange.min, yRange.max]
  );
  const useOverGradient = showReference && Number.isFinite(referenceLufs);
  const referenceOffset = loudnessHistY(referenceLufs, SPARK_H, yRange) / SPARK_H;
  const momentaryGradientId = useId().replace(/:/g, "");
  const shortTermGradientId = useId().replace(/:/g, "");

  return (
    <div
      {...dockHistoryInteractionProps(controls)}
      className="flex h-full min-w-0 items-stretch"
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
            {useOverGradient ? (
              <>
                <linearGradient
                  id={momentaryGradientId}
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={SPARK_H}
                >
                  <stop offset={0} style={{ stopColor: "var(--ui-loudness-momentary-over)" }} />
                  <stop
                    offset={referenceOffset}
                    style={{ stopColor: "var(--ui-loudness-momentary-over)" }}
                  />
                  <stop
                    offset={referenceOffset}
                    style={{ stopColor: "var(--ui-loudness-momentary)" }}
                  />
                  <stop offset={1} style={{ stopColor: "var(--ui-loudness-momentary)" }} />
                </linearGradient>
                <linearGradient
                  id={shortTermGradientId}
                  gradientUnits="userSpaceOnUse"
                  x1={0}
                  y1={0}
                  x2={0}
                  y2={SPARK_H}
                >
                  <stop offset={0} style={{ stopColor: "var(--ui-loudness-shortterm-over)" }} />
                  <stop
                    offset={referenceOffset}
                    style={{ stopColor: "var(--ui-loudness-shortterm-over)" }}
                  />
                  <stop
                    offset={referenceOffset}
                    style={{ stopColor: "var(--ui-loudness-shortterm)" }}
                  />
                  <stop offset={1} style={{ stopColor: "var(--ui-loudness-shortterm)" }} />
                </linearGradient>
              </>
            ) : null}
          </defs>
          {showMomentary && momentaryPath ? (
            <path
              data-testid="dock-loudness-momentary"
              d={momentaryPath}
              fill="none"
              stroke={
                useOverGradient ? `url(#${momentaryGradientId})` : "var(--ui-loudness-momentary)"
              }
              strokeWidth="var(--ui-loudness-momentary-stroke-width)"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {showShortTerm && shortTermPath ? (
            <path
              data-testid="dock-loudness-short-term"
              d={shortTermPath}
              fill="none"
              stroke={
                useOverGradient ? `url(#${shortTermGradientId})` : "var(--ui-loudness-shortterm)"
              }
              strokeWidth="var(--ui-loudness-shortterm-stroke-width)"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>
        <DockHistoryWindowHud controls={controls} />
      </div>
      {controls?.showReadouts !== false ? (
        <DockLoudnessReadouts displayAudio={displayAudio} />
      ) : null}
    </div>
  );
}
