import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { vectorscopeRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { cn } from "@/lib/utils";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM } from "@/lib/shellLayout";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import {
  PERSISTENCE_WINDOW_MS,
  selectPersistenceWindow,
  drawPersistenceWindow,
} from "../../math/vectorscopePersistence.js";
import { selectPolarWindow } from "../../math/vectorscopePolarMath.js";
import { VectorscopePolarPlot } from "./VectorscopePolarPlot.jsx";
import {
  SnapshotEmptyState,
  SNAPSHOT_NO_DATA_MESSAGE,
  ANALYSIS_OVER_CAP_MESSAGE,
} from "./SnapshotEmptyState.jsx";

const CORRELATION_SIGNAL_FLOOR_DB = -90;
const LIVE_CORRELATION_DISPLAY_ALPHA = 0.25;
// Only for the canvas persistence layer, which cannot resolve the token itself when unset.
const VECTOR_TRACE_STROKE_FALLBACK = 1;
const HOLD_SLOW_DELAY_MS = 300;
const HOLD_SLOW_CANCEL_PX = 4;
const HOLD_SLOW_SMOOTHING_ALPHA = 0.06;

function clampCorrelation(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

function correlationMarkerLeft(value) {
  const corr = clampCorrelation(value);
  if (corr === null) return "50%";
  return `${((corr + 1) / 2) * 100}%`;
}

function hasPairSignal(peakDb, x, y) {
  if (!Array.isArray(peakDb)) return false;
  const lx = Number.isFinite(peakDb[x]) ? peakDb[x] : -Infinity;
  const ly = Number.isFinite(peakDb[y]) ? peakDb[y] : -Infinity;
  return Math.max(lx, ly) > CORRELATION_SIGNAL_FLOOR_DB;
}

function correlationMarkerClass(value) {
  const corr = clampCorrelation(value);
  if (corr === null) return "bg-[color:var(--muted-foreground)]";
  if (corr < 0) return "bg-[color:var(--ui-signal-bad)]";
  if (corr < 0.35) return "bg-[color:var(--ui-signal-warn)]";
  return "bg-[color:var(--ui-signal-good)]";
}

function smoothCorrelation(previous, next) {
  if (previous === null || next === null) return next;
  return previous + (next - previous) * LIVE_CORRELATION_DISPLAY_ALPHA;
}

export function VectorscopePanel() {
  const {
    vsGridDiagInset,
    vsGridDiagFar,
    correlation,
    channelCount = 0,
    peakLabelContext,
    vectorscopePairX: pairX = 0,
    vectorscopePairY: pairY = 1,
    displayAudio,
  } = useFrameData();
  const {
    selectedOffset,
    resolveVectorscopeSnapshotForKey,
    historyChartInteractive,
    getVectorscopeHistoryForKey,
    vectorscopeResetEpoch = 0,
  } = useHistoryData();
  const { panelControls, analysisStatus } = usePanelInstanceData();
  const normalizedPanelControls = normalizePanelControls(panelControls);
  const vectorscopeMode = normalizedPanelControls.vectorscopeMode;
  const isLissajous = vectorscopeMode === "lissajous";
  const vectorscopeKey = vectorscopeRequestKeyFromControls(panelControls);
  const isOverCap = analysisStatus === "overCap";
  const isSnapshot = selectedOffset >= 0;
  const [holdSlowActive, setHoldSlowActive] = useState(false);
  const holdSlowTimerRef = useRef(null);
  const holdSlowPointerRef = useRef(null);
  const holdSlowActiveRef = useRef(false);
  const clearPendingHoldSlow = useCallback(() => {
    if (holdSlowTimerRef.current != null) {
      window.clearTimeout(holdSlowTimerRef.current);
      holdSlowTimerRef.current = null;
    }
    holdSlowPointerRef.current = null;
  }, []);
  const releaseHoldSlow = useCallback(() => {
    clearPendingHoldSlow();
    if (holdSlowActiveRef.current) {
      holdSlowActiveRef.current = false;
      setHoldSlowActive(false);
    }
  }, [clearPendingHoldSlow]);
  useEffect(() => releaseHoldSlow, [releaseHoldSlow]);
  const onTracePointerDown = useCallback(
    (e) => {
      if (
        !isLissajous ||
        isSnapshot ||
        !historyChartInteractive ||
        (e.button != null && e.button !== 0) ||
        e.ctrlKey
      ) {
        return;
      }
      clearPendingHoldSlow();
      holdSlowPointerRef.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY };
      holdSlowTimerRef.current = window.setTimeout(() => {
        holdSlowTimerRef.current = null;
        if (!holdSlowPointerRef.current) return;
        holdSlowActiveRef.current = true;
        setHoldSlowActive(true);
      }, HOLD_SLOW_DELAY_MS);
    },
    [clearPendingHoldSlow, historyChartInteractive, isLissajous, isSnapshot]
  );
  const onTracePointerMove = useCallback(
    (e) => {
      const pointer = holdSlowPointerRef.current;
      if (
        pointer &&
        !holdSlowActiveRef.current &&
        Math.hypot(e.clientX - pointer.startX, e.clientY - pointer.startY) > HOLD_SLOW_CANCEL_PX
      ) {
        clearPendingHoldSlow();
      }
    },
    [clearPendingHoldSlow]
  );
  const onTracePointerUp = useCallback(() => {
    releaseHoldSlow();
  }, [releaseHoldSlow]);
  const [peakHoldResetKey, setPeakHoldResetKey] = useState(0);
  const canResetPeakHold =
    !isSnapshot &&
    vectorscopeMode === "polarLevel" &&
    normalizedPanelControls.vectorscopePolarLevelPeakHold;
  const snapResolved = isSnapshot
    ? resolveVectorscopeSnapshotForKey?.(vectorscopeKey, {
        withPeakHold:
          vectorscopeMode === "polarLevel" && normalizedPanelControls.vectorscopePolarLevelPeakHold,
      })
    : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveVectorscopeResult = isSnapshot
    ? null
    : displayAudio?.vectorscopeResultsByKey?.[vectorscopeKey];
  // The panel's own pair (snapshot/pending fall back to its per-instance controls, not the global).
  const controlPair = normalizedPanelControls.vectorscopePair ?? {
    x: pairX,
    y: pairY,
  };
  let panelVectorPath;
  let panelCorrelation;
  let panelPairX;
  let panelPairY;
  if (isSnapshot) {
    panelVectorPath = snapResolved?.path ?? "";
    panelCorrelation = snapResolved?.correlation ?? correlation;
    panelPairX = controlPair.x;
    panelPairY = controlPair.y;
  } else if (liveVectorscopeResult) {
    panelVectorPath = liveVectorscopeResult.path;
    panelCorrelation = liveVectorscopeResult.correlation;
    panelPairX = liveVectorscopeResult.pairX;
    panelPairY = liveVectorscopeResult.pairY;
  } else {
    // Live but no per-key result yet: pending treatment (empty trace) until this request's first
    // frame arrives, rather than showing another request's trace.
    panelVectorPath = "";
    panelCorrelation = null;
    panelPairX = controlPair.x;
    panelPairY = controlPair.y;
  }
  // Hold slow mode: correlation low-pass (display-only).
  const holdCorrelationRef = useRef(null);
  const gatedCorrelation = useMemo(() => {
    if (isSnapshot || !holdSlowActive) {
      holdCorrelationRef.current = null;
      return panelCorrelation;
    }
    const previous = holdCorrelationRef.current;
    let correlation = panelCorrelation;
    if (Number.isFinite(previous) && Number.isFinite(panelCorrelation)) {
      correlation = previous + (panelCorrelation - previous) * HOLD_SLOW_SMOOTHING_ALPHA;
    }
    holdCorrelationRef.current = correlation;
    return correlation;
  }, [holdSlowActive, isSnapshot, panelCorrelation]);
  // Hold slow mode: phosphor persistence window — real samples from the recent history slab,
  // drawn with age-based fading. Falls back to the live path when history is unavailable.
  // Display-only — frame intake and history writes are unaffected.
  const needsHistorySlab = !isSnapshot && (holdSlowActive || !isLissajous);
  const persistenceSlab = needsHistorySlab
    ? (getVectorscopeHistoryForKey?.(vectorscopeKey) ?? null)
    : null;
  const persistenceRows = persistenceSlab
    ? selectPersistenceWindow(persistenceSlab, PERSISTENCE_WINDOW_MS)
    : [];
  const persistenceActive = isLissajous && persistenceRows.length > 0;
  const polarRows = !isLissajous && persistenceSlab ? selectPolarWindow(persistenceSlab) : [];
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const stripLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const px = Number.isFinite(panelPairX) ? Math.max(0, Math.floor(Number(panelPairX))) : 0;
  const py = Number.isFinite(panelPairY) ? Math.max(0, Math.floor(Number(panelPairY))) : 1;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  const hasCorrelationSignal = isSnapshot
    ? snapResolved?.hasSignal === true
    : hasPairSignal(displayAudio?.peakDb, px, py);
  const canPlaceCorrelationMarker =
    hasCorrelationSignal && clampCorrelation(gatedCorrelation) !== null;
  const liveCorrelationDisplayRef = useRef(null);
  const persistenceCanvasRef = useRef(null);
  // Intentionally no dependency array: a new history row arrives with each frame render, so
  // the canvas must redraw on every render while active. No-op when inactive or in jsdom
  // (getContext returns null there).
  useLayoutEffect(() => {
    if (!persistenceActive) return;
    const canvas = persistenceCanvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    const style = getComputedStyle(canvas);
    const stroke = style.getPropertyValue("--ui-vectorscope-trace").trim();
    if (stroke) ctx.strokeStyle = stroke;
    // Mirrors the SVG trace's non-scaling-stroke: the token is CSS pixels, not plot units.
    const strokeWidth =
      parseFloat(style.getPropertyValue("--ui-vectorscope-stroke-width")) ||
      VECTOR_TRACE_STROKE_FALLBACK;
    ctx.lineWidth = strokeWidth * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    drawPersistenceWindow(ctx, persistenceRows, {
      width,
      height,
      windowMs: PERSISTENCE_WINDOW_MS,
    });
  });
  const displayCorrelation = useMemo(() => {
    const rawCorrelation = canPlaceCorrelationMarker ? clampCorrelation(gatedCorrelation) : null;
    if (isSnapshot || rawCorrelation === null) {
      liveCorrelationDisplayRef.current = rawCorrelation;
      return rawCorrelation;
    }
    const smoothedCorrelation = smoothCorrelation(
      liveCorrelationDisplayRef.current,
      rawCorrelation
    );
    liveCorrelationDisplayRef.current = smoothedCorrelation;
    return smoothedCorrelation;
  }, [canPlaceCorrelationMarker, isSnapshot, gatedCorrelation]);

  if (isOverCap || snapshotMissing) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <SnapshotEmptyState
          message={isOverCap ? ANALYSIS_OVER_CAP_MESSAGE : SNAPSHOT_NO_DATA_MESSAGE}
        />
      </div>
    );
  }
  return (
    <div
      className={cn(
        PANEL_MIN_SPECTRUM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div
        data-vectorscope-plot-stage
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center gap-0",
          isLissajous ? "justify-start" : "justify-end"
        )}
      >
        <div
          data-vectorscope-plot
          data-peak-hold-reset={canResetPeakHold ? "true" : undefined}
          className={cn("relative w-full", canResetPeakHold && "cursor-pointer")}
          style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
          onPointerDown={onTracePointerDown}
          onPointerMove={onTracePointerMove}
          onPointerUp={onTracePointerUp}
          onPointerCancel={onTracePointerUp}
          onPointerLeave={onTracePointerUp}
          onClick={canResetPeakHold ? () => setPeakHoldResetKey((k) => k + 1) : undefined}
        >
          <div className="absolute inset-[var(--ui-vector-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
            {isLissajous ? (
              <>
                <svg
                  data-vectorscope-lissajous-grid
                  className="pointer-events-none absolute inset-0 z-0 block h-full w-full"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden
                >
                  <line
                    x1={vsGridDiagInset}
                    y1={vsGridDiagInset}
                    x2={vsGridDiagFar}
                    y2={vsGridDiagFar}
                    stroke="var(--ui-vectorscope-grid-stroke)"
                    strokeWidth="0.35"
                    strokeDasharray="var(--ui-vectorscope-grid-dash)"
                    vectorEffect="non-scaling-stroke"
                  />
                  <line
                    x1={vsGridDiagFar}
                    y1={vsGridDiagInset}
                    x2={vsGridDiagInset}
                    y2={vsGridDiagFar}
                    stroke="var(--ui-vectorscope-grid-stroke)"
                    strokeWidth="0.35"
                    strokeDasharray="var(--ui-vectorscope-grid-dash)"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
                <svg
                  viewBox="0 0 260 260"
                  preserveAspectRatio="none"
                  className="absolute inset-0 z-[1] block h-full w-full"
                >
                  {!persistenceActive && panelVectorPath && (
                    <path
                      d={panelVectorPath}
                      fill="none"
                      stroke={
                        selectedOffset >= 0
                          ? "var(--ui-vectorscope-trace-snap)"
                          : "var(--ui-vectorscope-trace)"
                      }
                      strokeWidth="var(--ui-vectorscope-stroke-width)"
                      vectorEffect="non-scaling-stroke"
                      opacity="var(--ui-vectorscope-axis-opacity)"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </>
            ) : null}
            {persistenceActive && (
              <canvas
                ref={persistenceCanvasRef}
                data-vectorscope-persistence
                className="pointer-events-none absolute inset-0 z-[1] block h-full w-full"
                aria-hidden
              />
            )}
            {!isLissajous ? (
              <div
                data-vectorscope-polar-stage
                className="absolute inset-x-0 top-0 bottom-[calc(var(--ui-fs-axis)_+_var(--ui-vector-corner-inset))]"
              >
                <VectorscopePolarPlot
                  mode={vectorscopeMode}
                  rows={polarRows}
                  snapshotPairs={isSnapshot ? snapResolved?.pairs : null}
                  snapshotPeakHold={isSnapshot ? snapResolved?.peakHold : null}
                  firstLabel={axisXLabel}
                  secondLabel={axisYLabel}
                  showLabels={false}
                  peakHoldEnabled={normalizedPanelControls.vectorscopePolarLevelPeakHold}
                  peakHoldResetKey={peakHoldResetKey}
                  resetEpoch={vectorscopeResetEpoch}
                  identityKey={`${vectorscopeKey}:${px}:${py}`}
                />
              </div>
            ) : null}
          </div>
          <div
            data-vectorscope-pair-labels
            className={cn(
              CAPTION_TEXT,
              "pointer-events-none absolute inset-x-0 flex justify-between px-[var(--ui-vector-corner-inset)]",
              isLissajous
                ? "top-[var(--ui-vector-corner-inset)]"
                : "bottom-[var(--ui-vector-corner-inset)]"
            )}
          >
            <span className="max-w-[42%] truncate">{axisXLabel}</span>
            <span className="max-w-[42%] truncate text-right">{axisYLabel}</span>
          </div>
        </div>
      </div>
      <div
        data-vectorscope-correlation-rail
        className="mt-[var(--ui-chart-axis-gap)] h-3 shrink-0 px-[var(--ui-vector-corner-inset)]"
      >
        <div
          className={cn(
            "relative h-full w-full",
            hasCorrelationSignal ? "opacity-100" : "opacity-30"
          )}
          aria-hidden
        >
          <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-[color:color-mix(in_srgb,var(--muted-foreground)_25%,transparent)]" />
            <div className="absolute left-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
            <div className="absolute right-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
          </div>
          {displayCorrelation !== null && (
            <div
              data-vectorscope-correlation-marker
              className={cn(
                "absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                !isSnapshot && "transition-[left,background-color] duration-100 ease-out",
                correlationMarkerClass(displayCorrelation)
              )}
              style={{ left: correlationMarkerLeft(displayCorrelation) }}
            />
          )}
        </div>
      </div>
      <div
        data-vectorscope-correlation-axis
        className={cn(
          CAPTION_TEXT,
          "mt-[var(--ui-chart-axis-gap)] h-[var(--ui-chart-x-axis-row-h)] w-full shrink-0 px-[var(--ui-vector-corner-inset)]"
        )}
      >
        <div className="relative h-full w-full" aria-hidden>
          <span className={axisLabelClass("x", "start")}>-1</span>
          <span className={axisLabelClass("x", "middle")} style={{ left: "50%" }}>
            0
          </span>
          <span className={axisLabelClass("x", "end")}>+1</span>
        </div>
      </div>
    </div>
  );
}
