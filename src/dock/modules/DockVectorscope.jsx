import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { useFrameData } from "../../workspace/AudioDataContext.jsx";
import { dockVectorscopeKey } from "../dockAnalysisRequest.js";

const CORRELATION_SIGNAL_FLOOR_DB = -90;
const LIVE_CORRELATION_DISPLAY_ALPHA = 0.25;
const CORRELATION_MIN_WIDTH_PX = 72;
const CONTENT_GAP_PX = 8;
const EXPANDED_CORRELATION_HEIGHT_PX = 44;

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

function computePlotSize(width, height, expanded = false) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 48;
  if (expanded) {
    return Math.max(32, Math.floor(Math.min(width, height - EXPANDED_CORRELATION_HEIGHT_PX)));
  }
  return Math.max(
    32,
    Math.floor(Math.min(height, width - CONTENT_GAP_PX - CORRELATION_MIN_WIDTH_PX))
  );
}

/** Compact live Vectorscope with a dedicated correlation readout. */
export function DockVectorscope({ controls = {}, heightMode = "standard" }) {
  const { displayAudio, channelCount = 0, peakLabelContext } = useFrameData();
  const contentRef = useRef(null);
  const displayCorrelationRef = useRef(null);
  const [plotSize, setPlotSize] = useState(48);
  const pair = controls.pair ?? { x: 0, y: 1 };
  const key = dockVectorscopeKey({ pair });
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
  const expanded = heightMode === "expanded";

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content) return undefined;
    const measure = () => {
      const rect = content.getBoundingClientRect();
      setPlotSize(computePlotSize(rect.width, rect.height, expanded));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, [expanded]);

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
          className="relative shrink-0 overflow-hidden"
          style={{ width: plotSize, height: plotSize }}
        >
          <svg
            className="pointer-events-none absolute inset-0 block h-full w-full"
            viewBox="0 0 260 260"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1="0"
              y1="0"
              x2="260"
              y2="260"
              stroke="var(--ui-vectorscope-grid-stroke)"
              strokeWidth="0.35"
              strokeDasharray="var(--ui-vectorscope-grid-dash)"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="260"
              y1="0"
              x2="0"
              y2="260"
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
                strokeWidth="1"
                opacity="var(--ui-vectorscope-axis-opacity)"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ) : null}
          </svg>
          {plotSize >= 44 ? (
            <>
              <span className="absolute left-0.5 top-0 max-w-[45%] truncate font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
                {firstLabel}
              </span>
              <span className="absolute right-0.5 top-0 max-w-[45%] truncate text-right font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
                {secondLabel}
              </span>
            </>
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
            <div className="flex items-baseline justify-between">
              <span className="font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground">
                Correlation
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
            <span className="text-center font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-dock-fs-value)] font-semibold leading-none tabular-nums text-foreground">
              {formatCorrelation(displayCorrelation)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
