import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { buildSpectrumDataSnapshot } from "../../lib/FrameIntake.js";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { buildSpectrumSvgFromBandsAndDb } from "../../math/spectrumMath.js";
import {
  SnapshotEmptyState,
  SNAPSHOT_NO_DATA_MESSAGE,
  ANALYSIS_OVER_CAP_MESSAGE,
} from "./SnapshotEmptyState.jsx";
import { useChartHover } from "../../hooks/useChartHover";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import { computeSpectrumHoverIndex, formatSpectrumFreq, freqToNote } from "../../math/hoverMath";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import {
  buildAdaptiveDbTicks,
  buildAdaptiveFreqTicks,
  rangedFreqToXFrac,
  spectrumDbToTopFrac,
  spectrumDbToYViewBox,
} from "../../config/scales";
import {
  computeLinearPan,
  computeLinearZoom,
  computeLogPan,
  computeLogZoom,
  pixelToLinearValue,
  pixelToLogValue,
} from "../../math/axisInteractionMath.js";

const CHART_ZOOM_IN_FACTOR = 0.85;
const CHART_ZOOM_OUT_FACTOR = 1.18;
const CHART_WHEEL_PAN_SCALE = 0.5;
const ACTIVE_PULSE_MS = 160;
const HOLD_SMOOTHING_DELAY_MS = 300;
const HOLD_SMOOTHING_CANCEL_PX = 4;
const HOLD_DISPLAY_SMOOTHING_ALPHA = 0.06;

function buildSpectrumAreaPath(path) {
  if (!path) return "";
  return `${path} L 1000 260 L 0 260 Z`;
}

function buildSpectrumPathFromData(data, dbList, range) {
  const centers = data?.bands?.map((band) => band.fCenter) ?? [];
  return buildSpectrumSvgFromBandsAndDb(centers, dbList ?? [], range);
}

function canSmoothSpectrumResult(result) {
  return Boolean(result?.bandCentersHz?.length && result?.smoothDb?.length);
}

function bandsMatch(a, b) {
  return (
    a?.length === b?.length &&
    (!a?.length || (Object.is(a[0], b[0]) && Object.is(a[a.length - 1], b[b.length - 1])))
  );
}

function smoothDbList(previous, next, alpha) {
  if (!previous || previous.length !== next?.length) return next;
  return next.map((value, idx) => previous[idx] + (value - previous[idx]) * alpha);
}

function smoothSpectrumResult(previous, next) {
  if (!previous || !bandsMatch(previous.bandCentersHz, next.bandCentersHz)) return next;
  return {
    ...next,
    smoothDb: smoothDbList(previous.smoothDb, next.smoothDb, HOLD_DISPLAY_SMOOTHING_ALPHA),
    smoothDbB: smoothDbList(previous.smoothDbB, next.smoothDbB, HOLD_DISPLAY_SMOOTHING_ALPHA),
    peakDb: smoothDbList(previous.peakDb, next.peakDb, HOLD_DISPLAY_SMOOTHING_ALPHA),
    peakDbB: smoothDbList(previous.peakDbB, next.peakDbB, HOLD_DISPLAY_SMOOTHING_ALPHA),
  };
}

export function SpectrumPanel({ compact = false }) {
  const {
    selectedOffset,
    displayAudio,
    panelControls,
    resolveSpectrumSnapshotForKey,
    analysisStatus,
    historyChartInteractive,
    totalSamples,
    setSelectedOffset,
    captureCurrentSnapshot,
    onPanelControlsChange,
  } = useAudioData();
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const [holdSmoothingActive, setHoldSmoothingActive] = useState(false);
  const spectrumPeakHold = normalizedPanelControls.spectrumPeakHold;
  const spectrumRange = {
    minHz: normalizedPanelControls.spectrumXMinFreq,
    maxHz: normalizedPanelControls.spectrumXMaxFreq,
    yMaxDb: normalizedPanelControls.spectrumYMaxDb,
    yMinDb: normalizedPanelControls.spectrumYMinDb,
  };
  const updatePanelControlsRange = useCallback(
    (next) => {
      onPanelControlsChange?.(normalizePanelControls({ ...normalizedPanelControls, ...next }));
    },
    [normalizedPanelControls, onPanelControlsChange]
  );
  const spectrumYAxis = useAxisInteraction({
    axis: "y",
    min: normalizedPanelControls.spectrumYMinDb,
    max: normalizedPanelControls.spectrumYMaxDb,
    absMin: -120,
    absMax: 0,
    defaultMin: -96,
    defaultMax: 0,
    minSpan: 12,
    scale: "linear",
    onRangeChange: useCallback(
      (newMin, newMax) =>
        updatePanelControlsRange({ spectrumYMinDb: newMin, spectrumYMaxDb: newMax }),
      [updatePanelControlsRange]
    ),
  });
  const spectrumXAxis = useAxisInteraction({
    axis: "x",
    min: normalizedPanelControls.spectrumXMinFreq,
    max: normalizedPanelControls.spectrumXMaxFreq,
    absMin: 20,
    absMax: 20000,
    defaultMin: 20,
    defaultMax: 20000,
    minSpan: 1,
    scale: "log",
    onRangeChange: useCallback(
      (newMin, newMax) =>
        updatePanelControlsRange({ spectrumXMinFreq: newMin, spectrumXMaxFreq: newMax }),
      [updatePanelControlsRange]
    ),
  });
  const spectrumYTicks = buildAdaptiveDbTicks(
    normalizedPanelControls.spectrumYMinDb,
    normalizedPanelControls.spectrumYMaxDb,
    spectrumYAxis.axisPx
  );
  const spectrumFreqTicks = buildAdaptiveFreqTicks(
    normalizedPanelControls.spectrumXMinFreq,
    normalizedPanelControls.spectrumXMaxFreq,
    spectrumXAxis.axisPx
  );
  const holdDisplaySpectrumResultRef = useRef(null);
  const spectrumKey = spectrumRequestKeyFromControls(panelControls);
  const isOverCap = analysisStatus === "overCap";
  const isSnapshot = selectedOffset >= 0;
  // In snapshot mode each panel reads history for its own request key; in live mode it reads the
  // request-keyed live result.
  const snapResolved = isSnapshot ? resolveSpectrumSnapshotForKey?.(spectrumKey) : null;
  const snapshotMissing = snapResolved?.missing === true;
  const rawLiveSpectrumResult = isSnapshot
    ? null
    : displayAudio?.spectrumResultsByKey?.[spectrumKey];
  const liveSpectrumResult = useMemo(() => {
    if (isSnapshot || !canSmoothSpectrumResult(rawLiveSpectrumResult)) {
      holdDisplaySpectrumResultRef.current = null;
      return rawLiveSpectrumResult;
    }
    if (!holdSmoothingActive) {
      holdDisplaySpectrumResultRef.current = rawLiveSpectrumResult;
      return rawLiveSpectrumResult;
    }
    const smoothed = smoothSpectrumResult(
      holdDisplaySpectrumResultRef.current,
      rawLiveSpectrumResult
    );
    holdDisplaySpectrumResultRef.current = smoothed;
    return smoothed;
  }, [holdSmoothingActive, isSnapshot, rawLiveSpectrumResult]);
  let panelSpectrumPath;
  let panelSpectrumPeakPath;
  let panelSpectrumPathB;
  let panelSpectrumPeakPathB;
  let panelSpectrumData;
  let panelSpectrumPeakDb;
  let panelSpectrumPeakDbB;
  if (isSnapshot) {
    panelSpectrumPath = snapResolved?.path ?? "";
    panelSpectrumPeakPath = "";
    panelSpectrumPathB = snapResolved?.pathB ?? "";
    panelSpectrumPeakPathB = "";
    panelSpectrumData = snapResolved?.data ?? null;
    panelSpectrumPeakDb = [];
    panelSpectrumPeakDbB = [];
  } else if (liveSpectrumResult) {
    panelSpectrumPath = liveSpectrumResult.path;
    panelSpectrumPeakPath = liveSpectrumResult.peakPath;
    panelSpectrumPathB = liveSpectrumResult.pathB;
    panelSpectrumPeakPathB = liveSpectrumResult.peakPathB;
    panelSpectrumPeakDb = liveSpectrumResult.peakDb;
    panelSpectrumPeakDbB = liveSpectrumResult.peakDbB;
    panelSpectrumData = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: liveSpectrumResult.bandCentersHz,
      spectrumSmoothDb: liveSpectrumResult.smoothDb,
      spectrumSmoothDbB: liveSpectrumResult.smoothDbB,
    });
  } else {
    // Live but no per-key result yet: pending treatment (empty chart) until this request's first
    // frame arrives. Showing another request's curve here would be wrong for this panel's key.
    panelSpectrumPath = "";
    panelSpectrumPeakPath = "";
    panelSpectrumPathB = "";
    panelSpectrumPeakPathB = "";
    panelSpectrumData = null;
    panelSpectrumPeakDb = [];
    panelSpectrumPeakDbB = [];
  }
  const spectrumSvgRef = useRef(null);
  const chartDragRef = useRef(null);
  const holdSmoothingTimerRef = useRef(null);
  const holdSmoothingPointerRef = useRef(null);
  const holdSmoothingActiveRef = useRef(false);
  const chartHoverRef = useRef(false);
  const chartActiveTimerRef = useRef(null);
  const suppressChartClickRef = useRef(false);
  const [chartAxisActive, setChartAxisActive] = useState({ x: false, y: false });
  const [chartCtrlHover, setChartCtrlHover] = useState(false);
  const [chartDragging, setChartDragging] = useState(false);
  useEffect(() => {
    const updateCtrlHover = (e) => {
      if (!chartHoverRef.current) return;
      setChartCtrlHover(e.ctrlKey);
    };
    const clearCtrlHover = () => setChartCtrlHover(false);
    window.addEventListener("keydown", updateCtrlHover);
    window.addEventListener("keyup", updateCtrlHover);
    window.addEventListener("blur", clearCtrlHover);
    return () => {
      window.removeEventListener("keydown", updateCtrlHover);
      window.removeEventListener("keyup", updateCtrlHover);
      window.removeEventListener("blur", clearCtrlHover);
    };
  }, []);
  useEffect(
    () => () => {
      if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
    },
    []
  );
  const clearPendingHoldSmoothing = useCallback(() => {
    if (holdSmoothingTimerRef.current != null) {
      window.clearTimeout(holdSmoothingTimerRef.current);
      holdSmoothingTimerRef.current = null;
    }
    holdSmoothingPointerRef.current = null;
  }, []);
  const releaseHoldSmoothing = useCallback(() => {
    clearPendingHoldSmoothing();
    if (holdSmoothingActiveRef.current) {
      holdSmoothingActiveRef.current = false;
      setHoldSmoothingActive(false);
    }
  }, [clearPendingHoldSmoothing]);
  useEffect(() => releaseHoldSmoothing, [releaseHoldSmoothing]);
  const scheduleHoldSmoothing = useCallback(
    (e) => {
      if (
        selectedOffset >= 0 ||
        !historyChartInteractive ||
        (e.button != null && e.button !== 0) ||
        e.ctrlKey
      ) {
        return;
      }
      clearPendingHoldSmoothing();
      holdSmoothingPointerRef.current = {
        id: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
      };
      holdSmoothingTimerRef.current = window.setTimeout(() => {
        holdSmoothingTimerRef.current = null;
        if (!holdSmoothingPointerRef.current) return;
        holdSmoothingActiveRef.current = true;
        setHoldSmoothingActive(true);
        suppressChartClickRef.current = true;
      }, HOLD_SMOOTHING_DELAY_MS);
    },
    [clearPendingHoldSmoothing, historyChartInteractive, selectedOffset]
  );
  const pulseChartAxis = useCallback((axes) => {
    setChartAxisActive({
      x: Boolean(axes?.x),
      y: Boolean(axes?.y),
    });
    if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
    chartActiveTimerRef.current = window.setTimeout(() => {
      chartActiveTimerRef.current = null;
      setChartAxisActive({ x: false, y: false });
    }, ACTIVE_PULSE_MS);
  }, []);
  const zoomSpectrumXFromChart = useCallback(
    (e, factor) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const px = width - Math.max(0, Math.min(width, e.clientX - rect.left));
      const next = computeLogZoom({
        min: normalizedPanelControls.spectrumXMinFreq,
        max: normalizedPanelControls.spectrumXMaxFreq,
        absMin: 20,
        absMax: 20000,
        minOctaves: 1,
        anchor: pixelToLogValue(
          px,
          width,
          normalizedPanelControls.spectrumXMinFreq,
          normalizedPanelControls.spectrumXMaxFreq
        ),
        factor,
      });
      updatePanelControlsRange({ spectrumXMinFreq: next.min, spectrumXMaxFreq: next.max });
      pulseChartAxis({ x: true });
    },
    [
      normalizedPanelControls.spectrumXMaxFreq,
      normalizedPanelControls.spectrumXMinFreq,
      pulseChartAxis,
      updatePanelControlsRange,
    ]
  );
  const zoomSpectrumYFromChart = useCallback(
    (e, factor) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const height = Math.max(1, rect.height);
      const px = Math.max(0, Math.min(height, e.clientY - rect.top));
      const next = computeLinearZoom({
        min: normalizedPanelControls.spectrumYMinDb,
        max: normalizedPanelControls.spectrumYMaxDb,
        absMin: -120,
        absMax: 0,
        minSpan: 12,
        anchor: pixelToLinearValue(
          px,
          height,
          normalizedPanelControls.spectrumYMinDb,
          normalizedPanelControls.spectrumYMaxDb
        ),
        factor,
      });
      updatePanelControlsRange({ spectrumYMinDb: next.min, spectrumYMaxDb: next.max });
      pulseChartAxis({ y: true });
    },
    [
      normalizedPanelControls.spectrumYMaxDb,
      normalizedPanelControls.spectrumYMinDb,
      pulseChartAxis,
      updatePanelControlsRange,
    ]
  );
  const panSpectrumXFromChart = useCallback(
    (rect, deltaPx, startRange = normalizedPanelControls) => {
      const next = computeLogPan({
        min: startRange.spectrumXMinFreq,
        max: startRange.spectrumXMaxFreq,
        absMin: 20,
        absMax: 20000,
        deltaPx,
        axisPx: Math.max(1, rect.width),
      });
      return { spectrumXMinFreq: next.min, spectrumXMaxFreq: next.max };
    },
    [normalizedPanelControls]
  );
  const panSpectrumYFromChart = useCallback(
    (rect, deltaPx, startRange = normalizedPanelControls) => {
      const next = computeLinearPan({
        min: startRange.spectrumYMinDb,
        max: startRange.spectrumYMaxDb,
        absMin: -120,
        absMax: 0,
        deltaPx,
        axisPx: Math.max(1, rect.height),
      });
      return { spectrumYMinDb: next.min, spectrumYMaxDb: next.max };
    },
    [normalizedPanelControls]
  );
  const onSpectrumChartWheel = useCallback(
    (e) => {
      if (!historyChartInteractive) return;
      e.preventDefault();
      if (e.ctrlKey) {
        zoomSpectrumYFromChart(e, e.deltaY > 0 ? CHART_ZOOM_OUT_FACTOR : CHART_ZOOM_IN_FACTOR);
        return;
      }
      if (Number.isFinite(e.deltaX) && Math.abs(e.deltaX) > Math.abs(e.deltaY ?? 0)) {
        const rect = e.currentTarget.getBoundingClientRect();
        updatePanelControlsRange(panSpectrumXFromChart(rect, e.deltaX * CHART_WHEEL_PAN_SCALE));
        pulseChartAxis({ x: true });
        return;
      }
      zoomSpectrumXFromChart(e, e.deltaY > 0 ? CHART_ZOOM_OUT_FACTOR : CHART_ZOOM_IN_FACTOR);
    },
    [
      historyChartInteractive,
      panSpectrumXFromChart,
      pulseChartAxis,
      updatePanelControlsRange,
      zoomSpectrumXFromChart,
      zoomSpectrumYFromChart,
    ]
  );
  const onSpectrumChartPointerDown = useCallback(
    (e) => {
      chartHoverRef.current = true;
      setChartCtrlHover(e.ctrlKey);
      scheduleHoldSmoothing(e);
      if (!historyChartInteractive || !e.ctrlKey || (e.button != null && e.button !== 0)) return;
      e.preventDefault();
      suppressChartClickRef.current = true;
      chartDragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startRange: {
          spectrumXMinFreq: normalizedPanelControls.spectrumXMinFreq,
          spectrumXMaxFreq: normalizedPanelControls.spectrumXMaxFreq,
          spectrumYMinDb: normalizedPanelControls.spectrumYMinDb,
          spectrumYMaxDb: normalizedPanelControls.spectrumYMaxDb,
        },
      };
      setChartDragging(true);
      pulseChartAxis({ x: true, y: true });
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    [
      historyChartInteractive,
      normalizedPanelControls.spectrumXMaxFreq,
      normalizedPanelControls.spectrumXMinFreq,
      normalizedPanelControls.spectrumYMaxDb,
      normalizedPanelControls.spectrumYMinDb,
      pulseChartAxis,
      scheduleHoldSmoothing,
    ]
  );
  const onSpectrumChartPointerMove = useCallback(
    (e) => {
      chartHoverRef.current = true;
      setChartCtrlHover(e.ctrlKey);
      const holdPointer = holdSmoothingPointerRef.current;
      if (
        holdPointer &&
        !holdSmoothingActiveRef.current &&
        Math.hypot(e.clientX - holdPointer.startX, e.clientY - holdPointer.startY) >
          HOLD_SMOOTHING_CANCEL_PX
      ) {
        clearPendingHoldSmoothing();
      }
      const drag = chartDragRef.current;
      if (!drag) return false;
      const rect = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const next = {
        ...panSpectrumXFromChart(rect, -dx, drag.startRange),
        ...panSpectrumYFromChart(rect, dy, drag.startRange),
      };
      updatePanelControlsRange(next);
      pulseChartAxis({ x: Math.abs(dx) >= 2, y: Math.abs(dy) >= 2 });
      return true;
    },
    [
      clearPendingHoldSmoothing,
      panSpectrumXFromChart,
      panSpectrumYFromChart,
      pulseChartAxis,
      updatePanelControlsRange,
    ]
  );
  const onSpectrumChartPointerUp = useCallback(
    (e) => {
      const wasDragging = !!chartDragRef.current;
      const wasHoldSmoothingActive = holdSmoothingActiveRef.current;
      chartDragRef.current = null;
      setChartDragging(false);
      releaseHoldSmoothing();
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch (_) {}
      if (wasDragging || wasHoldSmoothingActive) {
        window.setTimeout(() => {
          suppressChartClickRef.current = false;
        }, 0);
      }
    },
    [releaseHoldSmoothing]
  );
  const {
    hover: spectrumHover,
    onMove,
    onLeave: onSpectrumHoverLeave,
  } = useChartHover((xFrac) => {
    const data = panelSpectrumData;
    if (!data?.bands?.length || !data?.dbList?.length) return null;
    const nearestIdx = computeSpectrumHoverIndex(
      xFrac,
      data.bands,
      spectrumRange.minHz,
      spectrumRange.maxHz
    );
    const band = data.bands[nearestIdx];
    const db = data.dbList[nearestIdx];
    if (!band || !Number.isFinite(db)) return null;
    const dbB = data.dbListB?.[nearestIdx];
    return {
      leftPct: rangedFreqToXFrac(band.fCenter, spectrumRange.minHz, spectrumRange.maxHz) * 100,
      topPct: spectrumDbToTopFrac(db, spectrumRange) * 100,
      freqLabel: formatSpectrumFreq(band.fCenter),
      dbLabel: `${db.toFixed(1)} dB`,
      dbLabelB: Number.isFinite(dbB) ? `${dbB.toFixed(1)} dB` : null,
      noteLabel: freqToNote(band.fCenter),
    };
  });
  const reduceMotion = useReducedMotion();
  const displayPanelSpectrumPath =
    buildSpectrumPathFromData(panelSpectrumData, panelSpectrumData?.dbList, spectrumRange) ||
    panelSpectrumPath;
  const displayPanelSpectrumPathB =
    buildSpectrumPathFromData(panelSpectrumData, panelSpectrumData?.dbListB, spectrumRange) ||
    panelSpectrumPathB;
  const displayPanelSpectrumPeakPath =
    buildSpectrumPathFromData(panelSpectrumData, panelSpectrumPeakDb, spectrumRange) ||
    panelSpectrumPeakPath;
  const displayPanelSpectrumPeakPathB =
    buildSpectrumPathFromData(panelSpectrumData, panelSpectrumPeakDbB, spectrumRange) ||
    panelSpectrumPeakPathB;
  // Peak-hold renders as a filled area up to the peak contour (the live curve stays a solid line
  // on top). When peak hold is off, the fill follows the live curve as before.
  const peakFillActive = spectrumPeakHold && !!displayPanelSpectrumPeakPath;
  const displaySpectrumAreaPath = buildSpectrumAreaPath(
    peakFillActive ? displayPanelSpectrumPeakPath : displayPanelSpectrumPath
  );
  const displaySpectrumAreaPathB =
    spectrumPeakHold && displayPanelSpectrumPeakPathB
      ? buildSpectrumAreaPath(displayPanelSpectrumPeakPathB)
      : "";
  const spectrumPaletteKey = selectedOffset >= 0 ? "snap" : "live";
  const canCaptureCurrentSnapshot = historyChartInteractive && totalSamples > 0;

  if (isOverCap || snapshotMissing) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
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
        "relative flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[var(--ui-w-axis-rail)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch"
          )}
        >
          <div
            ref={spectrumYAxis.axisRef}
            {...spectrumYAxis.axisHandlers}
            style={{ cursor: spectrumYAxis.cursorStyle }}
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              (spectrumYAxis.isActive || chartAxisActive.y) && "text-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
              {spectrumYTicks.map(({ v, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={v} className={axisLabelClass("y", "start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === spectrumYTicks.length - 1) {
                  return (
                    <span key={v} className={axisLabelClass("y", "end")}>
                      {lb}
                    </span>
                  );
                }
                return (
                  <span
                    key={v}
                    className={axisLabelClass("y", "middle")}
                    style={{ top: `${spectrumDbToTopFrac(v, spectrumRange) * 100}%` }}
                  >
                    {lb}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="relative min-h-0 min-w-0">
            <div
              data-testid="spectrum-chart"
              className="relative min-h-0 h-full"
              style={{
                cursor: chartDragging ? "grabbing" : chartCtrlHover ? "grab" : "crosshair",
              }}
              onPointerLeave={() => {
                chartHoverRef.current = false;
                setChartCtrlHover(false);
                releaseHoldSmoothing();
                onSpectrumHoverLeave();
              }}
              onClick={() => {
                if (suppressChartClickRef.current) {
                  suppressChartClickRef.current = false;
                  return;
                }
                if (!canCaptureCurrentSnapshot) return;
                captureCurrentSnapshot?.();
              }}
              onDoubleClick={() => {
                if (!historyChartInteractive) return;
                setSelectedOffset?.(-1);
              }}
              onWheel={onSpectrumChartWheel}
              onPointerDown={onSpectrumChartPointerDown}
              onPointerMove={(e) => {
                if (onSpectrumChartPointerMove(e)) return;
                const r = spectrumSvgRef.current?.getBoundingClientRect();
                if (r) onMove(e.clientX, e.clientY, r);
              }}
              onPointerUp={onSpectrumChartPointerUp}
              onPointerCancel={onSpectrumChartPointerUp}
            >
              <div className="absolute inset-0 min-h-0 min-w-0 pt-[var(--ui-chart-inset-top)] pb-[var(--ui-chart-inset-bottom)]">
                <svg
                  ref={spectrumSvgRef}
                  viewBox="0 0 1000 260"
                  preserveAspectRatio="none"
                  className="block h-full w-full min-h-0 min-w-0"
                >
                  <defs>
                    <linearGradient id="spectrumFillLive" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-primary)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-primary)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                    <linearGradient id="spectrumFillSnap" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-primary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-primary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                    <linearGradient id="spectrumFillLiveB" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-secondary)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-secondary)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                    <linearGradient id="spectrumFillSnapB" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-secondary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-secondary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                  </defs>
                  <g pointerEvents="none" aria-hidden>
                    {spectrumYTicks.map(({ v }) => (
                      <line
                        key={`sp-grid-h-${v}`}
                        x1={0}
                        x2={1000}
                        y1={spectrumDbToYViewBox(v, spectrumRange)}
                        y2={spectrumDbToYViewBox(v, spectrumRange)}
                        stroke="var(--border)"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        style={{ strokeOpacity: "var(--ui-spectrum-grid-opacity)" }}
                      />
                    ))}
                    {spectrumFreqTicks.map(({ v: f }) => {
                      const x =
                        rangedFreqToXFrac(f, spectrumRange.minHz, spectrumRange.maxHz) * 1000;
                      return (
                        <line
                          key={`sp-grid-v-${f}`}
                          x1={x}
                          x2={x}
                          y1={0}
                          y2={260}
                          stroke="var(--border)"
                          strokeWidth={1}
                          vectorEffect="non-scaling-stroke"
                          style={{ strokeOpacity: "var(--ui-spectrum-grid-opacity)" }}
                        />
                      );
                    })}
                  </g>
                  {displayPanelSpectrumPath ? (
                    <AnimatePresence mode="sync">
                      <motion.g
                        key={spectrumPaletteKey}
                        initial={reduceMotion ? false : { opacity: 0.88 }}
                        animate={{ opacity: 1 }}
                        exit={reduceMotion ? { opacity: 1 } : { opacity: 0.82 }}
                        transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
                      >
                        <path
                          d={displaySpectrumAreaPath}
                          fill={
                            selectedOffset >= 0
                              ? "url(#spectrumFillSnap)"
                              : "url(#spectrumFillLive)"
                          }
                        />
                        {displaySpectrumAreaPathB ? (
                          <path
                            d={displaySpectrumAreaPathB}
                            fill={
                              selectedOffset >= 0
                                ? "url(#spectrumFillSnapB)"
                                : "url(#spectrumFillLiveB)"
                            }
                          />
                        ) : null}
                        <path
                          d={displayPanelSpectrumPath}
                          fill="none"
                          stroke={
                            selectedOffset >= 0
                              ? "var(--ui-spectrum-primary-snap)"
                              : "var(--ui-spectrum-primary)"
                          }
                          strokeWidth="var(--ui-spectrum-stroke-width)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {displayPanelSpectrumPathB ? (
                          <path
                            d={displayPanelSpectrumPathB}
                            fill="none"
                            stroke={
                              selectedOffset >= 0
                                ? "var(--ui-spectrum-secondary-snap)"
                                : "var(--ui-spectrum-secondary)"
                            }
                            strokeWidth="var(--ui-spectrum-stroke-width)"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        ) : null}
                      </motion.g>
                    </AnimatePresence>
                  ) : null}
                </svg>
              </div>
              {spectrumHover && !chartDragging ? (
                <div className="pointer-events-none absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)] z-10">
                  <div
                    className="absolute bottom-0 top-0 border-l border-dashed border-muted-foreground/55"
                    style={{ left: `${spectrumHover.leftPct}%` }}
                  />
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/40"
                    style={{ top: `${spectrumHover.topPct}%` }}
                  />
                  <div
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-[color:var(--ui-spectrum-primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ui-spectrum-primary)_22%,transparent)]"
                    style={{
                      left: `${spectrumHover.leftPct}%`,
                      top: `${spectrumHover.topPct}%`,
                      backgroundColor:
                        selectedOffset >= 0
                          ? "var(--ui-spectrum-primary-snap)"
                          : "var(--ui-spectrum-primary)",
                    }}
                  />
                  <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.freqLabel}
                    </div>
                    <div
                      className="font-[family-name:var(--ui-font-mono)] tabular-nums"
                      style={
                        spectrumHover.dbLabelB
                          ? {
                              color:
                                selectedOffset >= 0
                                  ? "var(--ui-spectrum-primary-snap)"
                                  : "var(--ui-spectrum-primary)",
                            }
                          : undefined
                      }
                    >
                      {spectrumHover.dbLabel}
                    </div>
                    {spectrumHover.dbLabelB ? (
                      <div
                        className="font-[family-name:var(--ui-font-mono)] tabular-nums"
                        style={{
                          color:
                            selectedOffset >= 0
                              ? "var(--ui-spectrum-secondary-snap)"
                              : "var(--ui-spectrum-secondary)",
                        }}
                      >
                        {spectrumHover.dbLabelB}
                      </div>
                    ) : null}
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.noteLabel}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div />
          <div
            ref={spectrumXAxis.axisRef}
            {...spectrumXAxis.axisHandlers}
            style={{ cursor: spectrumXAxis.cursorStyle }}
            className={cn(
              CAPTION_TEXT,
              "relative h-[var(--ui-chart-x-axis-row-h)] w-full transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              (spectrumXAxis.isActive || chartAxisActive.x) && "text-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-0 h-full">
              {spectrumFreqTicks.map(({ v: f, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={f} className={axisLabelClass("x", "start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === spectrumFreqTicks.length - 1) {
                  return (
                    <span key={f} className={axisLabelClass("x", "end")}>
                      {lb}
                    </span>
                  );
                }
                return (
                  <span
                    key={f}
                    className={axisLabelClass("x", "middle")}
                    style={{
                      left: `${rangedFreqToXFrac(f, spectrumRange.minHz, spectrumRange.maxHz) * 100}%`,
                    }}
                  >
                    {lb}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
