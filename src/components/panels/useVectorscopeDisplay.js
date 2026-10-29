import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { vectorscopeRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import {
  PERSISTENCE_WINDOW_MS,
  selectPersistenceWindow,
  drawPersistenceWindow,
} from "../../math/vectorscopePersistence.js";
import { POLAR_LEVEL_WINDOW_MS, selectPolarWindow } from "../../math/vectorscopePolarMath.js";
import { useResolvedTheme } from "../../theme/useResolvedTheme.js";
import { readCssNumber } from "../../theme/cssTokens.js";
import { useCanvasBackingStoreSize } from "../../hooks/useCanvasBackingStore.js";
import { useEffectiveChannelControls } from "./useEffectiveChannelControls.js";
import { vectorscopeGestureAvailability } from "./panelGestureAvailability.js";

const CORRELATION_SIGNAL_FLOOR_DB = -90;
const LIVE_CORRELATION_DISPLAY_ALPHA = 0.25;
// Only for the canvas persistence layer, which cannot resolve the token itself when unset.
const VECTOR_TRACE_STROKE_FALLBACK = 1;
const HOLD_SLOW_DELAY_MS = 300;
const HOLD_SLOW_CANCEL_PX = 4;
const HOLD_SLOW_SMOOTHING_ALPHA = 0.06;

function selectVectorscopeColors(resolved) {
  return {
    trace: resolved.canvas["vectorscope.trace"],
    snapshot: resolved.canvas["vectorscope.snapshot"],
    guides: resolved.canvas["vectorscope.guides"],
  };
}

function clampCorrelation(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

/**
 * @param {number} x
 * @param {number} y
 */
function hasPairSignal(peakDb, x, y) {
  if (!Array.isArray(peakDb)) return false;
  const lx = Number.isFinite(peakDb[x]) ? peakDb[x] : -Infinity;
  const ly = Number.isFinite(peakDb[y]) ? peakDb[y] : -Infinity;
  return Math.max(lx, ly) > CORRELATION_SIGNAL_FLOOR_DB;
}

// Advance the display filter only when its input changes. Render-state adjustment keeps the
// result synchronous with the current frame without mutating a ref from a memo callback.
function useSmoothedCorrelation(value, reset, alpha) {
  const [sample, setSample] = useState({ value, reset, display: value });
  if (!Object.is(sample.value, value) || sample.reset !== reset) {
    const display =
      reset || value == null || sample.display == null
        ? value
        : sample.display + (value - sample.display) * alpha;
    setSample({ value, reset, display });
    return display;
  }
  return sample.display;
}

export function useVectorscopeDisplay() {
  const vectorscopeColors = useResolvedTheme(selectVectorscopeColors);
  const {
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
  const { panelControls, panelVisible } = usePanelInstanceData();
  const panelActive = panelVisible !== false;
  const normalizedPanelControls = normalizePanelControls(panelControls);
  const vectorscopeMode = normalizedPanelControls.vectorscopeMode;
  const isLissajous = vectorscopeMode === "lissajous";
  // What this panel analyses: the requested pair, or the fallback while the source lacks it.
  const effectivePanelControls = useEffectiveChannelControls("vectorscope", panelControls);
  const vectorscopeKey = vectorscopeRequestKeyFromControls(effectivePanelControls);
  const isSnapshot = selectedOffset >= 0;
  const gestureAvailability = vectorscopeGestureAvailability(normalizedPanelControls, isSnapshot);
  const canHoldSlow = gestureAvailability.holdSlow === true;
  const canResetMaxHold = gestureAvailability.resetMaxHold === true;
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
        !canHoldSlow ||
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
    [canHoldSlow, clearPendingHoldSlow, historyChartInteractive]
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
  const [maxHoldResetKey, setMaxHoldResetKey] = useState(0);
  const snapResolved = isSnapshot
    ? resolveVectorscopeSnapshotForKey?.(vectorscopeKey, {
        withMaxHold:
          vectorscopeMode === "polarLevel" && normalizedPanelControls.vectorscopePolarLevelMaxHold,
      })
    : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveVectorscopeResult = isSnapshot
    ? null
    : displayAudio?.vectorscopeResultsByKey?.[vectorscopeKey];
  // The panel's own pair (snapshot/pending fall back to its per-instance controls, not the global).
  const controlPair = normalizePanelControls(effectivePanelControls).vectorscopePair ?? {
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
  const gatedCorrelation = useSmoothedCorrelation(
    panelCorrelation,
    isSnapshot || !holdSlowActive,
    HOLD_SLOW_SMOOTHING_ALPHA
  );
  // Hold slow mode: phosphor persistence window — real samples from the recent history slab,
  // drawn with age-based fading. Falls back to the live path when history is unavailable.
  // Display-only — frame intake and history writes are unaffected.
  const needsHistorySlab = panelActive && !isSnapshot && (holdSlowActive || !isLissajous);
  const persistenceSlab = needsHistorySlab
    ? (getVectorscopeHistoryForKey?.(vectorscopeKey) ?? null)
    : null;
  const persistenceVersion = persistenceSlab?.version ?? 0;
  const persistenceRows = useMemo(
    () =>
      isLissajous && persistenceSlab
        ? selectPersistenceWindow(persistenceSlab, PERSISTENCE_WINDOW_MS)
        : [],
    // The slab mutates in place; version is the intentional invalidation key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLissajous, persistenceSlab, persistenceVersion]
  );
  const persistenceActive = isLissajous && persistenceRows.length > 0;
  const polarWindowMs =
    vectorscopeMode === "polarLevel"
      ? POLAR_LEVEL_WINDOW_MS
      : normalizedPanelControls.vectorscopePolarSamplePersistenceMs;
  const polarRows = useMemo(
    () =>
      !isLissajous && persistenceSlab ? selectPolarWindow(persistenceSlab, polarWindowMs) : [],
    // The slab mutates in place; version is the intentional invalidation key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isLissajous, persistenceSlab, persistenceVersion, polarWindowMs]
  );
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
  const persistenceCanvasRef = useRef(null);
  const persistenceCanvasSize = useCanvasBackingStoreSize(
    persistenceCanvasRef,
    panelActive && persistenceActive
  );
  useLayoutEffect(() => {
    if (!panelActive || !persistenceActive) return;
    const canvas = persistenceCanvasRef.current;
    const ctx = canvas?.getContext?.("2d");
    if (!ctx) return;
    const { dpr, width, height } = persistenceCanvasSize;
    if (width <= 0 || height <= 0) return;
    ctx.strokeStyle = vectorscopeColors.trace;
    // Mirrors the SVG trace's non-scaling-stroke: the token is CSS pixels, not plot units.
    const strokeWidth =
      readCssNumber(canvas, "--ui-vectorscope-stroke-width", VECTOR_TRACE_STROKE_FALLBACK) ||
      VECTOR_TRACE_STROKE_FALLBACK;
    ctx.lineWidth = strokeWidth * dpr;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    drawPersistenceWindow(ctx, persistenceRows, {
      width,
      height,
      windowMs: PERSISTENCE_WINDOW_MS,
    });
  }, [panelActive, persistenceActive, persistenceCanvasSize, persistenceRows, vectorscopeColors]);
  const displayCorrelation = useSmoothedCorrelation(
    canPlaceCorrelationMarker ? clampCorrelation(gatedCorrelation) : null,
    isSnapshot,
    LIVE_CORRELATION_DISPLAY_ALPHA
  );

  return {
    snapshotMissing,
    isLissajous,
    canResetMaxHold,
    onTracePointerDown,
    onTracePointerMove,
    onTracePointerUp,
    setMaxHoldResetKey,
    axisXLabel,
    axisYLabel,
    persistenceActive,
    panelVectorPath,
    selectedOffset,
    persistenceCanvasRef,
    vectorscopeMode,
    polarRows,
    isSnapshot,
    snapResolved,
    liveVectorscopeResult,
    normalizedPanelControls,
    maxHoldResetKey,
    vectorscopeResetEpoch,
    vectorscopeKey,
    px,
    py,
    vectorscopeColors,
    panelActive,
    displayCorrelation,
  };
}
