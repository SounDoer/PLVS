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
  SnapshotEmptyState,
  SNAPSHOT_NO_DATA_MESSAGE,
  ANALYSIS_OVER_CAP_MESSAGE,
} from "./SnapshotEmptyState.jsx";

const CORRELATION_SIGNAL_FLOOR_DB = -90;
const LIVE_CORRELATION_DISPLAY_ALPHA = 0.25;
const VECTOR_TRACE_STROKE_MIN = 0.45;
const VECTOR_TRACE_STROKE_MAX = 1;
const VECTOR_TRACE_STROKE_FULL_SIZE_PX = 720;
const VECTOR_TRACE_STROKE_COMPACT_SIZE_PX = 280;
const HOLD_SLOW_DELAY_MS = 300;
const HOLD_SLOW_CANCEL_PX = 4;
const HOLD_SLOW_SMOOTHING_ALPHA = 0.06;
const VS_TRACE_CENTER = 130;
const VS_TRACE_MIN_MEAN_SQUARE_RADIUS = 1e-9;

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

function parseTracePathPoints(d) {
  if (!d) return null;
  const nums = d.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2 || nums.length % 2 !== 0) return null;
  return nums.map(Number);
}

function traceMeanSquareRadius(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] - VS_TRACE_CENTER;
    const dy = points[i + 1] - VS_TRACE_CENTER;
    sum += dx * dx + dy * dy;
  }
  return sum / (points.length / 2);
}

function buildTracePathFromPoints(points) {
  if (!points?.length) return "";
  const segments = [];
  for (let i = 0; i < points.length; i += 2) {
    segments.push(`${points[i].toFixed(2)} ${points[i + 1].toFixed(2)}`);
  }
  return `M ${segments.join(" L ")}`;
}

export function computeVectorscopeTraceStrokeWidth(plotSizePx) {
  if (!Number.isFinite(plotSizePx) || plotSizePx <= 0) return VECTOR_TRACE_STROKE_MAX;
  const t =
    (Math.max(
      VECTOR_TRACE_STROKE_COMPACT_SIZE_PX,
      Math.min(VECTOR_TRACE_STROKE_FULL_SIZE_PX, plotSizePx)
    ) -
      VECTOR_TRACE_STROKE_COMPACT_SIZE_PX) /
    (VECTOR_TRACE_STROKE_FULL_SIZE_PX - VECTOR_TRACE_STROKE_COMPACT_SIZE_PX);
  return VECTOR_TRACE_STROKE_MAX - (VECTOR_TRACE_STROKE_MAX - VECTOR_TRACE_STROKE_MIN) * t;
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
  const { selectedOffset, resolveVectorscopeSnapshotForKey, historyChartInteractive } =
    useHistoryData();
  const { panelControls, analysisStatus } = usePanelInstanceData();
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
    [clearPendingHoldSlow, historyChartInteractive, isSnapshot]
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
  const snapResolved = isSnapshot ? resolveVectorscopeSnapshotForKey?.(vectorscopeKey) : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveVectorscopeResult = isSnapshot
    ? null
    : displayAudio?.vectorscopeResultsByKey?.[vectorscopeKey];
  const normalizedPanelControls = normalizePanelControls(panelControls);
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
  // Hold slow mode: while active, low-pass the displayed trace points and correlation toward
  // the incoming live values (spectrum-style display smoothing). Point index has no stable
  // physical meaning across frames, so this draws a smoothly morphing average stereo image
  // rather than a true instantaneous trajectory — intentional for the hold reading mode.
  // Display-only — frame intake and history writes are unaffected.
  const holdSmoothingRef = useRef(null);
  const { gatedVectorPath, gatedCorrelation } = useMemo(() => {
    if (isSnapshot || !holdSlowActive) {
      holdSmoothingRef.current = null;
      return { gatedVectorPath: panelVectorPath, gatedCorrelation: panelCorrelation };
    }
    const nextPoints = parseTracePathPoints(panelVectorPath);
    if (!nextPoints) {
      holdSmoothingRef.current = null;
      return { gatedVectorPath: panelVectorPath, gatedCorrelation: panelCorrelation };
    }
    const previous = holdSmoothingRef.current;
    const targetMeanSquareRadius = traceMeanSquareRadius(nextPoints);
    let points = nextPoints;
    let meanSquareRadius = targetMeanSquareRadius;
    if (previous?.points && previous.points.length === nextPoints.length) {
      points = nextPoints.map(
        (value, idx) =>
          previous.points[idx] + (value - previous.points[idx]) * HOLD_SLOW_SMOOTHING_ALPHA
      );
      // Per-point EMA of index-shuffled targets contracts the cloud toward its centroid, so
      // renormalize the blended figure back to the (smoothed) live size.
      meanSquareRadius =
        previous.meanSquareRadius +
        (targetMeanSquareRadius - previous.meanSquareRadius) * HOLD_SLOW_SMOOTHING_ALPHA;
      const blendedMeanSquareRadius = traceMeanSquareRadius(points);
      if (blendedMeanSquareRadius > VS_TRACE_MIN_MEAN_SQUARE_RADIUS) {
        const scale = Math.sqrt(meanSquareRadius / blendedMeanSquareRadius);
        points = points.map((value) => VS_TRACE_CENTER + (value - VS_TRACE_CENTER) * scale);
      }
    }
    let correlation = panelCorrelation;
    if (Number.isFinite(previous?.correlation) && Number.isFinite(panelCorrelation)) {
      correlation =
        previous.correlation +
        (panelCorrelation - previous.correlation) * HOLD_SLOW_SMOOTHING_ALPHA;
    }
    holdSmoothingRef.current = { points, correlation, meanSquareRadius };
    return { gatedVectorPath: buildTracePathFromPoints(points), gatedCorrelation: correlation };
  }, [holdSlowActive, isSnapshot, panelCorrelation, panelVectorPath]);
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
  const traceFrameRef = useRef(null);
  const [traceStrokeWidth, setTraceStrokeWidth] = useState(VECTOR_TRACE_STROKE_MAX);
  useLayoutEffect(() => {
    const el = traceFrameRef.current;
    if (!el) return undefined;
    let rafId = 0;
    const measure = () => {
      rafId = 0;
      const rect = el.getBoundingClientRect();
      const plotSizePx = Math.min(rect.width, rect.height);
      setTraceStrokeWidth(computeVectorscopeTraceStrokeWidth(plotSizePx));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(measure);
    });
    ro.observe(el);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);
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
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0">
        <div
          data-vectorscope-plot
          className="relative w-full"
          style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
          onPointerDown={onTracePointerDown}
          onPointerMove={onTracePointerMove}
          onPointerUp={onTracePointerUp}
          onPointerCancel={onTracePointerUp}
          onPointerLeave={onTracePointerUp}
        >
          <div className="absolute inset-[var(--ui-vector-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
            <svg
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
              ref={traceFrameRef}
              viewBox="0 0 260 260"
              preserveAspectRatio="none"
              className="absolute inset-0 z-[1] block h-full w-full"
            >
              {gatedVectorPath && (
                <path
                  d={gatedVectorPath}
                  fill="none"
                  stroke={
                    selectedOffset >= 0
                      ? "var(--ui-vectorscope-trace-snap)"
                      : "var(--ui-vectorscope-trace)"
                  }
                  strokeWidth={traceStrokeWidth}
                  opacity="var(--ui-vectorscope-axis-opacity)"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </div>
          <span
            className={cn(
              CAPTION_TEXT,
              "absolute left-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]"
            )}
          >
            {axisXLabel}
          </span>
          <span
            className={cn(
              CAPTION_TEXT,
              "absolute right-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]"
            )}
          >
            {axisYLabel}
          </span>
        </div>
      </div>
      <div
        data-vectorscope-correlation-rail
        className="mt-[var(--ui-chart-axis-gap)] h-3 shrink-0 px-[calc(var(--ui-vector-corner-inset)*0.5)]"
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
          "mt-[var(--ui-chart-axis-gap)] h-[var(--ui-chart-x-axis-row-h)] w-full shrink-0 px-[calc(var(--ui-vector-corner-inset)*0.5)]"
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
