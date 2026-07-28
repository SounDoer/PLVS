import { useCallback, useEffect, useRef, useMemo, useState } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTROGRAM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import { buildAdaptiveFreqTicks, rangedFreqToYFrac } from "../../config/scales";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas";
import { useSpectrogram3dCanvas } from "../../hooks/useSpectrogram3dCanvas";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import { useCanvasSize } from "../../hooks/useCanvasSize";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { computeLogPan, computeLogZoom, pixelToLogValue } from "../../math/axisInteractionMath.js";
import {
  spectrogramTimeWindow,
  spectrogramDataBoundaryMarkers,
  resolveSpectrogramSampleMs,
} from "../../math/spectrogramTimeline";
import { useChartHover } from "../../hooks/useChartHover";
import { useCtrlHoverState } from "../../hooks/useCtrlHoverState";
import { computeSpectrogramHoverPoint } from "../../math/hoverMath";
import { TimelineLatestEdgeHint } from "./TimelineLatestEdgeHint.jsx";
import { HIST_SAMPLE_SEC, VISUAL_HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { getTheme } from "../../theme/themeRegistry.js";
import { listCustomThemes } from "../../theme/customThemesRepo.js";
import { buildSpectrogramLut } from "../../theme/spectrogramColormap.js";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { SnapshotEmptyState, ANALYSIS_OVER_CAP_MESSAGE } from "./SnapshotEmptyState.jsx";
import { EMPTY_SPECTRUM_VIEW } from "../../lib/SpectrumHistorySlab.js";
import { normalizePanelControls } from "../../lib/panelControls.js";

const CHART_ZOOM_IN_FACTOR = 0.85;
const CHART_ZOOM_OUT_FACTOR = 1.18;
const ACTIVE_PULSE_MS = 160;
// Handed to whichever renderer is inactive. Must be a stable identity: both hooks depend on the
// canvas ref, so a fresh `{ current: null }` literal per render would tear down and restart their
// requestAnimationFrame loops on every panel render, which happens at spectrum-frame rate.
const NO_CANVAS = { current: null };

export function SpectrogramPanel({ compact = false }) {
  const { channelCount, spectrumChannelOptions, resolvedThemeId } = useFrameData();
  const {
    frequencyMarkerRef,
    frequencyMarkerIndex,
    effectiveOffsetSamples,
    visibleSamples,
    selectedOffset,
    setSelectedOffset,
    showSelLine,
    selLineX,
    totalSamples,
    histSourceList,
    historyChartInteractive,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
    historyTimeAxisHandlers,
    historyTimeAxisActive,
    historyTimeTicks,
    getSpectrogramSnapsForKey,
    snapshotSpectrumByKey,
  } = useHistoryData();
  const { panelControls, analysisStatus, onPanelControlsChange } = usePanelInstanceData();
  const chartYDragRef = useRef(null);
  const heightGainDragRef = useRef(null);
  const rotateDragRef = useRef(null);
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const is3d = normalizedPanelControls.spectrogram3d === true;
  const spectrogramYAxis = useAxisInteraction({
    axis: "y",
    min: normalizedPanelControls.spectrogramYMinFreq,
    max: normalizedPanelControls.spectrogramYMaxFreq,
    absMin: 20,
    absMax: 20000,
    defaultMin: 20,
    defaultMax: 20000,
    minSpan: 1,
    scale: "log",
    onRangeChange: useCallback(
      (newMin, newMax) => {
        onPanelControlsChange?.(
          normalizePanelControls({
            ...normalizedPanelControls,
            spectrogramYMinFreq: newMin,
            spectrogramYMaxFreq: newMax,
          })
        );
      },
      [normalizedPanelControls, onPanelControlsChange]
    ),
  });
  const chartActiveTimerRef = useRef(null);
  const [chartYAxisActive, setChartYAxisActive] = useState(false);
  const pulseChartYAxis = useCallback(() => {
    setChartYAxisActive(true);
    if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
    chartActiveTimerRef.current = window.setTimeout(() => {
      chartActiveTimerRef.current = null;
      setChartYAxisActive(false);
    }, ACTIVE_PULSE_MS);
  }, []);
  useEffect(
    () => () => {
      if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
    },
    []
  );
  const onSpectrogramChartWheel = useCallback(
    (e) => {
      if (!e.ctrlKey) {
        onHistoryWheel?.(e);
        return;
      }
      e.preventDefault();
      const rect = e.currentTarget.getBoundingClientRect();
      const height = Math.max(1, rect.height);
      const px = Math.max(0, Math.min(height, e.clientY - rect.top));
      const next = computeLogZoom({
        min: normalizedPanelControls.spectrogramYMinFreq,
        max: normalizedPanelControls.spectrogramYMaxFreq,
        absMin: 20,
        absMax: 20000,
        minOctaves: 1,
        anchor: pixelToLogValue(
          px,
          height,
          normalizedPanelControls.spectrogramYMinFreq,
          normalizedPanelControls.spectrogramYMaxFreq
        ),
        factor: e.deltaY > 0 ? CHART_ZOOM_OUT_FACTOR : CHART_ZOOM_IN_FACTOR,
      });
      onPanelControlsChange?.(
        normalizePanelControls({
          ...normalizedPanelControls,
          spectrogramYMinFreq: next.min,
          spectrogramYMaxFreq: next.max,
        })
      );
      pulseChartYAxis();
    },
    [normalizedPanelControls, onHistoryWheel, onPanelControlsChange, pulseChartYAxis]
  );
  // In 3D the vertical screen direction is always the dB axis (frequency and time swap visual
  // direction as azimuth turns), so the Y rail drags height gain instead of the frequency range.
  const onHeightGainDrag = useCallback(
    (deltaPx, axisPx) => {
      const next = normalizedPanelControls.spectrogram3dHeightGain * (1 - deltaPx / axisPx);
      onPanelControlsChange?.(
        normalizePanelControls({
          ...normalizedPanelControls,
          spectrogram3dHeightGain: next,
        })
      );
    },
    [normalizedPanelControls, onPanelControlsChange]
  );
  const onHeightGainPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    heightGainDragRef.current = { lastY: e.clientY, axisPx: Math.max(1, rect.height) };
  }, []);
  const onHeightGainPointerMove = useCallback(
    (e) => {
      const drag = heightGainDragRef.current;
      if (!drag) return;
      const deltaPx = e.clientY - drag.lastY;
      drag.lastY = e.clientY;
      onHeightGainDrag(deltaPx, drag.axisPx);
    },
    [onHeightGainDrag]
  );
  const onHeightGainPointerUp = useCallback(() => {
    heightGainDragRef.current = null;
  }, []);
  const spectrogramFreqTicks = buildAdaptiveFreqTicks(
    normalizedPanelControls.spectrogramYMinFreq,
    normalizedPanelControls.spectrogramYMaxFreq,
    spectrogramYAxis.axisPx
  );
  const isOverCap = analysisStatus === "overCap";
  // A right-drag rotation is only valid while 3D mode owns the canvas. If 3D View is switched off
  // (or the panel drops into the over-cap empty state, which unmounts the canvas) mid-drag, the
  // held button never delivers a pointerup to this component, so the ref would otherwise strand
  // itself set and keep gating pointer-move away from ordinary 2D handling. Clearing it here -- on
  // unmount too -- guarantees the very next pointer move behaves like a normal 2D move.
  useEffect(() => {
    if (!is3d || isOverCap) rotateDragRef.current = null;
    return () => {
      rotateDragRef.current = null;
    };
  }, [is3d, isOverCap]);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [chartDragging, setChartDragging] = useState(false);
  const { isCtrlHover, notePointerMove, notePointerLeave } = useCtrlHoverState();
  useCanvasSize(canvasRef, containerRef);

  // Spectrograms are request-keyed: resolve this panel's key once and read both the live rolling
  // history and the frozen snapshot history for that key only.
  const spectrogramKey = spectrumRequestKeyFromControls(panelControls);
  const snapRef = useMemo(
    () => ({
      get current() {
        return getSpectrogramSnapsForKey?.(spectrogramKey) ?? EMPTY_SPECTRUM_VIEW;
      },
    }),
    [getSpectrogramSnapsForKey, spectrogramKey]
  );

  const selLineSvgX = (selLineX / 600) * 1000;

  const markers = frequencyMarkerRef?.current ?? [];
  let visibleFrequencyMarkers = [];
  const showFrequencyMarkers = channelCount > 2 && (spectrumChannelOptions?.length ?? 0) > 0;
  if (showFrequencyMarkers && visibleSamples > 0 && totalSamples > 0) {
    const newestVisible = totalSamples - 1 - effectiveOffsetSamples;
    const oldestVisible = newestVisible - visibleSamples + 1;
    const visibleMarkers =
      typeof frequencyMarkerIndex?.query === "function"
        ? frequencyMarkerIndex
            .query(oldestVisible, newestVisible)
            .map(({ marker, logicalIndex }) => ({ marker, idx: logicalIndex }))
        : markers
            .map((marker, idx) => ({ marker, idx }))
            .filter(({ marker, idx }) => marker && idx >= oldestVisible && idx <= newestVisible);
    visibleFrequencyMarkers = visibleMarkers.map(({ marker, idx }) => ({
      marker,
      x: ((idx - oldestVisible) / Math.max(1, visibleSamples - 1)) * 1000,
    }));
  }

  const spectrogramSnaps =
    selectedOffset >= 0
      ? (snapshotSpectrumByKey?.[spectrogramKey] ?? EMPTY_SPECTRUM_VIEW)
      : (snapRef.current ?? EMPTY_SPECTRUM_VIEW);
  const colormapLut = useMemo(
    () => buildSpectrogramLut(getTheme(resolvedThemeId, listCustomThemes()).colormap),
    [resolvedThemeId]
  );
  const sampleMs = resolveSpectrogramSampleMs(spectrogramSnaps, VISUAL_HIST_SAMPLE_SEC * 1000);
  // Visible time window from the master (loudness history) timeline; frames are placed by timestamp.
  // Computed inline (not memoized): histSourceList is a stable, mutated-in-place ring reference in
  // live mode, so a useMemo keyed on it never recomputes as data arrives and would freeze the
  // window at its first (empty -> NaN) value. spectrogramTimeWindow is O(1), so recomputing each
  // render is free and keeps the window advancing with live capture.
  const timeWindow = spectrogramTimeWindow(
    histSourceList ?? [],
    effectiveOffsetSamples,
    visibleSamples,
    HIST_SAMPLE_SEC * 1000
  );
  const oldestMs = timeWindow?.oldestMs ?? NaN;
  const newestMs = timeWindow?.newestMs ?? NaN;
  // Marker lines where this request key's data appears/disappears inside the window (memoized so the
  // O(window) gap scan does not run on every ~60Hz panel re-render).
  const dataBoundaryMarkers = useMemo(
    () =>
      showFrequencyMarkers
        ? spectrogramDataBoundaryMarkers(spectrogramSnaps, oldestMs, newestMs, sampleMs)
        : [],
    [showFrequencyMarkers, spectrogramSnaps, spectrogramSnaps.version, oldestMs, newestMs, sampleMs]
  );
  useSpectrogramCanvas({
    canvasRef: is3d ? NO_CANVAS : canvasRef,
    snapRef,
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    frozenSnaps: selectedOffset >= 0 ? spectrogramSnaps : null,
    colormapLut,
    minHz: normalizedPanelControls.spectrogramYMinFreq,
    maxHz: normalizedPanelControls.spectrogramYMaxFreq,
  });
  useSpectrogram3dCanvas({
    canvasRef: is3d ? canvasRef : NO_CANVAS,
    snapRef,
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    selectionXFrac: selLineX / 600,
    frozenSnaps: selectedOffset >= 0 ? spectrogramSnaps : null,
    colormapLut,
    minHz: normalizedPanelControls.spectrogramYMinFreq,
    maxHz: normalizedPanelControls.spectrogramYMaxFreq,
    azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
    elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
    heightGain: normalizedPanelControls.spectrogram3dHeightGain,
    colorize: normalizedPanelControls.spectrogram3dColorize,
  });
  const boundarySpan = newestMs - oldestMs;
  const {
    hover: spectrogramHover,
    onMove: onSpectrogramHoverMove,
    onLeave: onSpectrogramHoverLeave,
  } = useChartHover(
    (xFrac, yFrac) => {
      if (is3d) return null;
      if (!historyChartInteractive) return null;
      const markerNotes = [
        ...visibleFrequencyMarkers.map(({ marker, x }) => ({
          xFrac: x / 1000,
          label: `${marker.from} -> ${marker.to}`,
        })),
        ...(boundarySpan > 0
          ? dataBoundaryMarkers.map(({ ts, label }) => ({
              xFrac: (ts - oldestMs) / boundarySpan,
              label,
            }))
          : []),
      ];
      return computeSpectrogramHoverPoint(
        xFrac,
        yFrac,
        spectrogramSnaps,
        oldestMs,
        newestMs,
        sampleMs,
        markerNotes,
        normalizedPanelControls.spectrogramYMinFreq,
        normalizedPanelControls.spectrogramYMaxFreq
      );
    },
    selectedOffset < 0
      ? `${is3d}:${spectrogramSnaps.version}:${oldestMs}:${newestMs}:${sampleMs}:${normalizedPanelControls.spectrogramYMinFreq}:${normalizedPanelControls.spectrogramYMaxFreq}:${dataBoundaryMarkers.length}:${visibleFrequencyMarkers.length}`
      : null
  );
  const onSpectrogramChartPointerDown = useCallback(
    (e) => {
      if (is3d && e.button === 2) {
        e.currentTarget.setPointerCapture(e.pointerId);
        rotateDragRef.current = {
          x: e.clientX,
          y: e.clientY,
          azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
          elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
        };
        return;
      }
      if (e.ctrlKey && e.button === 0) {
        chartYDragRef.current = {
          startY: e.clientY,
          min: normalizedPanelControls.spectrogramYMinFreq,
          max: normalizedPanelControls.spectrogramYMaxFreq,
        };
        setChartDragging(true);
        if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
        setChartYAxisActive(true);
      }
      onHistoryPointerDown?.(e);
    },
    [
      is3d,
      normalizedPanelControls.spectrogram3dAzimuthDeg,
      normalizedPanelControls.spectrogram3dElevationDeg,
      normalizedPanelControls.spectrogramYMaxFreq,
      normalizedPanelControls.spectrogramYMinFreq,
      onHistoryPointerDown,
    ]
  );
  const onSpectrogramChartPointerMove = useCallback(
    (e) => {
      const rotate = rotateDragRef.current;
      if (rotate && is3d) {
        onPanelControlsChange?.(
          normalizePanelControls({
            ...normalizedPanelControls,
            spectrogram3dAzimuthDeg: rotate.azimuthDeg + (e.clientX - rotate.x) * 0.4,
            spectrogram3dElevationDeg: rotate.elevationDeg - (e.clientY - rotate.y) * 0.3,
          })
        );
        return;
      }
      notePointerMove(e);
      onHistoryPointerMove?.(e);
      const drag = chartYDragRef.current;
      if (drag) {
        const rect = e.currentTarget.getBoundingClientRect();
        const next = computeLogPan({
          min: drag.min,
          max: drag.max,
          absMin: 20,
          absMax: 20000,
          deltaPx: e.clientY - drag.startY,
          axisPx: Math.max(1, rect.height),
        });
        onPanelControlsChange?.(
          normalizePanelControls({
            ...normalizedPanelControls,
            spectrogramYMinFreq: next.min,
            spectrogramYMaxFreq: next.max,
          })
        );
        setChartYAxisActive(true);
        return;
      }
      onSpectrogramHoverMove(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
    },
    [
      is3d,
      normalizedPanelControls,
      onHistoryPointerMove,
      onPanelControlsChange,
      onSpectrogramHoverMove,
    ]
  );
  const onSpectrogramChartPointerUp = useCallback(
    (e) => {
      rotateDragRef.current = null;
      chartYDragRef.current = null;
      setChartDragging(false);
      setChartYAxisActive(false);
      onHistoryPointerUp?.(e);
    },
    [onHistoryPointerUp]
  );

  if (isOverCap) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTROGRAM,
          "relative flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <SnapshotEmptyState message={ANALYSIS_OVER_CAP_MESSAGE} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        PANEL_MIN_SPECTROGRAM,
        "relative flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[var(--ui-chart-y-axis-rail-w)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch"
          )}
        >
          {/* Y-axis: frequency labels in 2D, height-gain drag rail in 3D */}
          <div
            ref={spectrogramYAxis.axisRef}
            {...(is3d
              ? {
                  onPointerDown: onHeightGainPointerDown,
                  onPointerMove: onHeightGainPointerMove,
                  onPointerUp: onHeightGainPointerUp,
                  onPointerCancel: onHeightGainPointerUp,
                }
              : spectrogramYAxis.axisHandlers)}
            style={{ cursor: is3d ? "ns-resize" : spectrogramYAxis.cursorStyle }}
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              (spectrogramYAxis.isActive || chartYAxisActive) && "text-foreground"
            )}
          >
            {is3d ? (
              <span className={axisLabelClass("y", "middle")} style={{ top: "50%" }}>
                dB
              </span>
            ) : (
              <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
                {spectrogramFreqTicks.map(({ v: hz, lb: label }, i) => {
                  if (i === 0) {
                    return (
                      <span key={hz} className={axisLabelClass("y", "end")}>
                        {label}
                      </span>
                    );
                  }
                  if (i === spectrogramFreqTicks.length - 1) {
                    return (
                      <span key={hz} className={axisLabelClass("y", "start")}>
                        {label}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={hz}
                      className={axisLabelClass("y", "middle")}
                      style={{
                        top: `${
                          rangedFreqToYFrac(
                            hz,
                            normalizedPanelControls.spectrogramYMinFreq,
                            normalizedPanelControls.spectrogramYMaxFreq
                          ) * 100
                        }%`,
                      }}
                    >
                      {label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* Canvas chart */}
          <div className="relative min-h-0 min-w-0">
            <div ref={containerRef} className="relative min-h-0 h-full">
              <canvas
                ref={canvasRef}
                style={{
                  opacity: "var(--panel-opacity-meter, 1)",
                  cursor: historyChartInteractive
                    ? chartDragging
                      ? "grabbing"
                      : isCtrlHover
                        ? "grab"
                        : "crosshair"
                    : "default",
                }}
                className={cn(
                  "absolute inset-0 h-full w-full",
                  !historyChartInteractive && "pointer-events-none"
                )}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={onSpectrogramChartPointerDown}
                onPointerMove={onSpectrogramChartPointerMove}
                onPointerLeave={(e) => {
                  notePointerLeave(e);
                  onSpectrogramHoverLeave?.(e);
                }}
                onPointerUp={onSpectrogramChartPointerUp}
                onPointerCancel={onSpectrogramChartPointerUp}
                onWheel={onSpectrogramChartWheel}
                onDoubleClick={() => {
                  if (!historyChartInteractive) return;
                  setSelectedOffset(-1);
                }}
              />
              {!is3d &&
              ((selectedOffset >= 0 && showSelLine) ||
                visibleFrequencyMarkers.length > 0 ||
                (dataBoundaryMarkers.length > 0 && boundarySpan > 0)) ? (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  {boundarySpan > 0
                    ? dataBoundaryMarkers.map(({ ts, label }) => {
                        const bx = ((ts - oldestMs) / boundarySpan) * 1000;
                        return (
                          <line
                            key={`data-boundary-${ts}`}
                            x1={bx}
                            x2={bx}
                            y1={0}
                            y2={1000}
                            stroke="var(--muted-foreground)"
                            strokeWidth="1"
                            strokeDasharray="1 5"
                            opacity="0.5"
                            vectorEffect="non-scaling-stroke"
                          >
                            <title>{label}</title>
                          </line>
                        );
                      })
                    : null}
                  {visibleFrequencyMarkers.map(({ marker, x }) => (
                    <line
                      key={`${x}-${marker.from}-${marker.to}`}
                      x1={x}
                      x2={x}
                      y1={0}
                      y2={1000}
                      stroke="var(--muted-foreground)"
                      strokeWidth="1"
                      strokeDasharray="2 4"
                      opacity="0.55"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`Frequency channel changed: ${marker.from} -> ${marker.to}`}</title>
                    </line>
                  ))}
                  {selectedOffset >= 0 && showSelLine ? (
                    <line
                      x1={selLineSvgX}
                      x2={selLineSvgX}
                      y1={0}
                      y2={1000}
                      stroke="var(--ui-loudness-selection)"
                      strokeWidth="var(--ui-loudness-selection-stroke-width)"
                      strokeDasharray="5 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </svg>
              ) : null}
              <TimelineLatestEdgeHint active={(effectiveOffsetSamples ?? 0) > 0} />
              {spectrogramHover && (
                <div className="pointer-events-none absolute inset-0">
                  {/* Vertical crosshair */}
                  <div
                    className="absolute bottom-0 top-0 border-l border-dashed border-muted-foreground/55"
                    style={{ left: `${spectrogramHover.leftPct}%` }}
                  />
                  {/* Horizontal crosshair */}
                  <div
                    className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/40"
                    style={{ top: `${spectrogramHover.topPct}%` }}
                  />
                  {/* Popover */}
                  <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrogramHover.timeLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrogramHover.freqLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrogramHover.dbLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrogramHover.noteLabel}
                    </div>
                    {spectrogramHover.markerNoteLabel ? (
                      <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                        {spectrogramHover.markerNoteLabel}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          </div>

          <div />
          <div
            {...(historyTimeAxisHandlers ?? {})}
            style={{ cursor: historyTimeAxisHandlers ? "ew-resize" : undefined }}
            className={cn(
              CAPTION_TEXT,
              "relative h-[var(--ui-chart-x-axis-row-h)] w-full transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              historyTimeAxisActive && "text-foreground"
            )}
          >
            <div className="absolute inset-0">
              {(historyTimeTicks ?? []).map((tick, i) => {
                if (i === 0) {
                  return (
                    <span key={`${i}-${tick}`} className={axisLabelClass("x", "start")}>
                      {tick}
                    </span>
                  );
                }
                if (i === HISTORY_TIME_TICK_STEPS) {
                  return (
                    <span key={`${i}-${tick}`} className={axisLabelClass("x", "end")}>
                      {tick}
                    </span>
                  );
                }
                return (
                  <span
                    key={`${i}-${tick}`}
                    className={axisLabelClass("x", "middle")}
                    style={{ left: `${(i / HISTORY_TIME_TICK_STEPS) * 100}%` }}
                  >
                    {tick}
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
