import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { selectPolarWindow } from "../../math/vectorscopePolarMath.js";
import { VectorscopePolarPlot } from "../../components/panels/VectorscopePolarPlot.jsx";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { dockVectorscopeKey } from "../dockAnalysisRequest.js";
import { normalizeDockModuleControls } from "../dockModuleControls.js";

const CORRELATION_SIGNAL_FLOOR_DB = -90;
const LIVE_CORRELATION_DISPLAY_ALPHA = 0.25;
const CORRELATION_MIN_WIDTH_PX = 72;
const CONTENT_GAP_PX = 8;
const EXPANDED_CORRELATION_HEIGHT_PX = 44;
const CORRELATION_FULL_LABEL_MIN_WIDTH_PX = 184;
const PAIR_LABEL_MIN_AVAILABLE_HEIGHT_PX = 44;

function clampCorrelation(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

function hasPairSignal(peakDb, x, y) {
  if (!Array.isArray(peakDb)) return false;
  const first = Number.isFinite(peakDb[x]) ? peakDb[x] : -Infinity;
  const second = Number.isFinite(peakDb[y]) ? peakDb[y] : -Infinity;
  return Math.max(first, second) > CORRELATION_SIGNAL_FLOOR_DB;
}

function markerColor(value) {
  if (value < 0) return "var(--ui-signal-bad)";
  if (value < 0.35) return "var(--ui-signal-warn)";
  return "var(--ui-signal-good)";
}

function formatCorrelation(value) {
  if (value === null) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

function computePlotBox(width, height, expanded, isPolar) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { w: 48, h: 48 };
  // Standard layout puts the correlation rail beside the plot (reserve its width); expanded stacks
  // it below (reserve its height).
  const availHeight = expanded ? height - EXPANDED_CORRELATION_HEIGHT_PX : height;
  const availWidth = expanded ? width : width - CONTENT_GAP_PX - CORRELATION_MIN_WIDTH_PX;
  if (isPolar) {
    // The polar plot is an upper semicircle — a diameter wide by a radius tall, i.e. 2:1. A square
    // box would leave the top half empty, so give it a 2:1 box: height fills the available height,
    // width is twice that (capped by the available width so it never overruns the correlation rail).
    const h = Math.max(32, Math.floor(Math.min(availHeight, availWidth / 2)));
    return { w: h * 2, h };
  }
  const side = Math.max(32, Math.floor(Math.min(availHeight, availWidth)));
  return { w: side, h: side };
}

/** Compact live Vectorscope with a dedicated correlation readout. */
export function DockVectorscope({ controls = {}, heightMode = "standard" }) {
  const { displayAudio, channelCount = 0, peakLabelContext } = useFrameData();
  const historyData = useHistoryData();
  const contentRef = useRef(null);
  const displayCorrelationRef = useRef(null);
  const [plotBox, setPlotBox] = useState({ w: 48, h: 48 });
  const [contentWidth, setContentWidth] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  const normalizedControls = normalizeDockModuleControls("correlation", controls);
  const pair = normalizedControls.pair;
  const mode = normalizedControls.mode;
  const isLissajous = mode === "lissajous";
  const [peakHoldResetKey, setPeakHoldResetKey] = useState(0);
  const canResetPeakHold = mode === "polarLevel" && normalizedControls.polarLevelPeakHold;
  const key = dockVectorscopeKey(normalizedControls);
  const result = displayAudio?.vectorscopeResultsByKey?.[key];
  const pairX = Number.isFinite(result?.pairX) ? result.pairX : pair.x;
  const pairY = Number.isFinite(result?.pairY) ? result.pairY : pair.y;
  const rawCorrelation =
    hasPairSignal(displayAudio?.peakDb, pairX, pairY) && Number.isFinite(result?.correlation)
      ? clampCorrelation(result.correlation)
      : null;
  const displayCorrelation = useMemo(() => {
    if (rawCorrelation === null) {
      displayCorrelationRef.current = null;
      return null;
    }
    const previous = displayCorrelationRef.current;
    const next =
      previous === null
        ? rawCorrelation
        : previous + (rawCorrelation - previous) * LIVE_CORRELATION_DISPLAY_ALPHA;
    displayCorrelationRef.current = next;
    return next;
  }, [rawCorrelation]);
  const labelCount = Number.isFinite(channelCount) && channelCount >= 2 ? channelCount : 2;
  const labels = getPeakMeterChannelLabels(labelCount, peakLabelContext || {});
  const firstLabel = labels[pairX] ?? `Ch ${pairX + 1}`;
  const secondLabel = labels[pairY] ?? `Ch ${pairY + 1}`;
  const polarSlab = isLissajous ? null : historyData?.getVectorscopeHistoryForKey?.(key);
  const polarRows = polarSlab ? selectPolarWindow(polarSlab) : [];
  const expanded = heightMode === "expanded";
  const availablePlotHeight = Math.max(
    0,
    contentHeight - (expanded ? EXPANDED_CORRELATION_HEIGHT_PX : 0)
  );
  const showPairLabels = availablePlotHeight >= PAIR_LABEL_MIN_AVAILABLE_HEIGHT_PX;
  const correlationLabel =
    expanded && contentWidth >= CORRELATION_FULL_LABEL_MIN_WIDTH_PX ? "Correlation" : "Corr";

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const measure = () => {
      const rect = content.getBoundingClientRect();
      setContentWidth(rect.width);
      setContentHeight(rect.height);
      setPlotBox(computePlotBox(rect.width, rect.height, expanded, !isLissajous));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded, isLissajous]);

  return (
    <div className="h-full min-w-0 px-[var(--ui-dock-pad-x)] py-[var(--ui-dock-pad-y)]">
      <div
        ref={contentRef}
        data-layout={expanded ? "expanded" : "standard"}
        className={`flex h-full min-w-0 items-center gap-[var(--ui-dock-gap-region)] ${
          expanded ? "flex-col" : "flex-row"
        }`}
      >
        <div
          data-testid="dock-vectorscope-plot"
          data-peak-hold-reset={canResetPeakHold ? "true" : undefined}
          className={`relative shrink-0 overflow-hidden ${canResetPeakHold ? "cursor-pointer" : ""}`}
          style={{ width: plotBox.w, height: plotBox.h }}
          onClick={canResetPeakHold ? () => setPeakHoldResetKey((k) => k + 1) : undefined}
        >
          {isLissajous ? (
            <svg
              data-testid="dock-vectorscope-lissajous-grid"
              className="pointer-events-none absolute inset-0 block h-full w-full"
              viewBox="0 0 260 260"
              preserveAspectRatio="none"
              aria-hidden
            >
              <line
                x1="4"
                y1="4"
                x2="256"
                y2="256"
                stroke="var(--ui-vectorscope-grid-stroke)"
                strokeWidth="0.35"
                strokeDasharray="var(--ui-vectorscope-grid-dash)"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1="256"
                y1="4"
                x2="4"
                y2="256"
                stroke="var(--ui-vectorscope-grid-stroke)"
                strokeWidth="0.35"
                strokeDasharray="var(--ui-vectorscope-grid-dash)"
                vectorEffect="non-scaling-stroke"
              />
              {result?.path ? (
                <path
                  data-testid="dock-vectorscope-trace"
                  d={result.path}
                  fill="none"
                  stroke="var(--ui-vectorscope-trace)"
                  strokeWidth="var(--ui-vectorscope-stroke-width)"
                  opacity="var(--ui-vectorscope-axis-opacity)"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>
          ) : (
            <div
              data-testid="dock-vectorscope-polar-stage"
              className={
                showPairLabels
                  ? "absolute inset-x-0 top-0 bottom-[calc(var(--ui-dock-fs-label)_+_2px)]"
                  : "absolute inset-0"
              }
            >
              <VectorscopePolarPlot
                mode={mode}
                rows={polarRows}
                firstLabel={firstLabel}
                secondLabel={secondLabel}
                showLabels={false}
                peakHoldEnabled={normalizedControls.polarLevelPeakHold}
                peakHoldResetKey={peakHoldResetKey}
                resetEpoch={historyData?.vectorscopeResetEpoch ?? 0}
                identityKey={key}
              />
            </div>
          )}
          {showPairLabels ? (
            <div
              data-testid="dock-vectorscope-pair-labels"
              className={`pointer-events-none absolute inset-x-0 flex justify-between px-0.5 font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground ${
                isLissajous ? "top-0" : "bottom-0"
              }`}
            >
              <span className="max-w-[45%] truncate">{firstLabel}</span>
              <span className="max-w-[45%] truncate text-right">{secondLabel}</span>
            </div>
          ) : null}
        </div>

        {expanded ? (
          <div className="flex w-full min-w-0 flex-col gap-1">
            <div
              data-testid="dock-vectorscope-correlation-rail"
              className={`relative h-[4px] w-full rounded-sm bg-muted/40 ${
                displayCorrelation === null ? "opacity-30" : "opacity-100"
              }`}
            >
              <div className="absolute left-1/2 top-1/2 h-0.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground" />
              {displayCorrelation !== null ? (
                <div
                  data-testid="dock-vectorscope-correlation-marker"
                  className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,background-color] duration-100 ease-out"
                  style={{
                    left: `${((displayCorrelation + 1) / 2) * 100}%`,
                    background: markerColor(displayCorrelation),
                  }}
                />
              ) : null}
            </div>
            <div className="flex justify-between font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium leading-none text-muted-foreground">
              <span>-1</span>
              <span>0</span>
              <span>+1</span>
            </div>
            <div
              data-testid="dock-vectorscope-correlation-readout"
              className="flex items-baseline justify-center gap-[var(--ui-dock-gap-column)]"
            >
              <span className="font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
                {correlationLabel}
              </span>
              <span className="font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold leading-none tabular-nums text-foreground">
                {formatCorrelation(displayCorrelation)}
              </span>
            </div>
          </div>
        ) : (
          <div className="flex min-w-[72px] flex-1 flex-col items-stretch justify-center gap-[var(--ui-dock-gap-row)]">
            <div
              data-testid="dock-vectorscope-correlation-rail"
              className={`flex items-center gap-[var(--ui-dock-gap-column)] font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-caption)] font-medium leading-none text-muted-foreground ${displayCorrelation === null ? "opacity-30" : "opacity-100"}`}
            >
              <span className="shrink-0">-1</span>
              <div className="relative h-[4px] min-w-6 flex-1 rounded-sm bg-muted/40">
                <div className="absolute left-1/2 top-1/2 h-0.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground" />
                {displayCorrelation !== null ? (
                  <div
                    data-testid="dock-vectorscope-correlation-marker"
                    className="absolute top-1/2 h-2.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full transition-[left,background-color] duration-100 ease-out"
                    style={{
                      left: `${((displayCorrelation + 1) / 2) * 100}%`,
                      background: markerColor(displayCorrelation),
                    }}
                  />
                ) : null}
              </div>
              <span className="shrink-0">+1</span>
            </div>
            <div
              data-testid="dock-vectorscope-correlation-readout"
              className="flex items-baseline justify-center gap-[var(--ui-dock-gap-column)]"
            >
              <span className="font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
                {correlationLabel}
              </span>
              <span className="font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold leading-none tabular-nums text-foreground">
                {formatCorrelation(displayCorrelation)}
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
