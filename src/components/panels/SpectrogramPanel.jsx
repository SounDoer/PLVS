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
import { unprojectFloor } from "../../math/spectrogram3dProjection.js";
import { hzFromFrac } from "../../math/spectrogramMath.js";
import {
  spectrogramTimeWindow,
  spectrogramDataBoundaryMarkers,
  resolveSpectrogramSampleMs,
  resolveStableSpectrogramSampleMs,
} from "../../math/spectrogramTimeline";
import { useChartHover } from "../../hooks/useChartHover";
import { useCtrlHoverState } from "../../hooks/useCtrlHoverState";
import { computeSpectrogramHoverPoint } from "../../math/hoverMath";
import { TimelineLatestEdgeHint } from "./TimelineLatestEdgeHint.jsx";
import { HIST_SAMPLE_SEC, VISUAL_HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { buildSpectrogramLut } from "../../theme/spectrogramColormap.js";
import { selectSpectrogramCanvasTheme } from "../../theme/themeCanvasSelectors.js";
import { useResolvedTheme } from "../../theme/useResolvedTheme.js";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { SnapshotEmptyState, ANALYSIS_OVER_CAP_MESSAGE } from "./SnapshotEmptyState.jsx";
import { EMPTY_SPECTRUM_VIEW } from "../../lib/SpectrumHistorySlab.js";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../../lib/panelControls.js";

const CHART_ZOOM_IN_FACTOR = 0.85;
const CHART_ZOOM_OUT_FACTOR = 1.18;
// A right press already starts a rotation drag, so a right double-click has to be distinguished
// from "rotated out and came back". Both conditions are required: barely moved, and soon after the
// previous right release. The budget is spent within a single press, not between the two presses --
// unlike Win32, two stationary clicks anywhere on the canvas count. A reset is idempotent and
// visible, so the looser rule costs nothing.
const RIGHT_DOUBLE_CLICK_MS = 400;
const RIGHT_DOUBLE_CLICK_SLOP_PX = 4;
const ACTIVE_PULSE_MS = 160;
// Handed to whichever renderer is inactive. Must be a stable identity: both hooks depend on the
// canvas ref, so a fresh `{ current: null }` literal per render would tear down and restart their
// requestAnimationFrame loops on every panel render, which happens at spectrum-frame rate.
const NO_CANVAS = { current: null };

export function SpectrogramPanel({ compact = false }) {
  const spectrogramTheme = useResolvedTheme(selectSpectrogramCanvasTheme);
  const { channelCount, spectrumChannelOptions } = useFrameData();
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
  const rotateDragRef = useRef(null);
  const lastRightUpRef = useRef(null);
  // Published by useSpectrogram3dCanvas on every repaint; pointer handlers read it to unproject a
  // cursor position back onto the floor plane (see cursorToFloor below).
  const projectionRef = useRef(null);
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const spectrogramMode = normalizedPanelControls.spectrogramMode;
  const is3d = spectrogramMode !== "heatmap";
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
  // Turns a pointer event into the floor-plane coordinate it lands on. Every handler below was
  // written against the 2D projection, where the horizontal screen axis is time and the vertical
  // one is frequency; under the rotated 3D floor neither holds, so interaction has to go through
  // the exact unprojection instead. Returns null outside 3D, or before the first 3D repaint has
  // published a projection.
  //
  // The projection works in the canvas's coordinate system, which useCanvasSize sizes in DEVICE
  // pixels (canvas.width = clientWidth * devicePixelRatio), while pointer events arrive in CSS
  // pixels. Skipping this conversion leaves everything offset on any scaled display.
  const cursorToFloor = useCallback(
    (e) => {
      if (!is3d) return null;
      const proj = projectionRef.current;
      if (!proj) return null;
      const canvas = e.currentTarget;
      const rect = canvas.getBoundingClientRect();
      if (!(rect.width > 0) || !(rect.height > 0)) return null;
      const deviceX = (e.clientX - rect.left) * (canvas.width / rect.width);
      const deviceY = (e.clientY - rect.top) * (canvas.height / rect.height);
      return unprojectFloor(deviceX, deviceY, proj);
    },
    [is3d]
  );
  // useHistoryInteraction's handlers are shared with other panels and read time position straight
  // off clientX, i.e. the 2D-linear layout. In 3D, remap at this call site: translate the cursor
  // into the equivalent 2D horizontal position via the floor-plane tFrac before delegating, rather
  // than touching the shared hook. Object.create keeps currentTarget / button / ctrlKey /
  // preventDefault reachable through the prototype chain, which a shallow spread would drop.
  const toTimeProxyEvent = useCallback((e, floor) => {
    if (!floor) return e;
    const rect = e.currentTarget.getBoundingClientRect();
    const proxy = Object.create(e);
    proxy.clientX = rect.left + floor.tFrac * rect.width;
    return proxy;
  }, []);
  const onSpectrogramChartWheel = useCallback(
    (e) => {
      if (is3d && e.shiftKey && !e.ctrlKey) {
        e.preventDefault();
        // Chrome on Windows delivers a shifted wheel as deltaX, not deltaY -- the horizontal-scroll
        // convention. Reading only deltaY leaves this gesture dead in the shipped app while every
        // synthesised test still passes. Pick by magnitude rather than truthiness: a trackpad can
        // put a noise-scale value on the other axis, and `||` would let that decide the direction.
        const delta = Math.abs(e.deltaY) >= Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (!delta) return;
        // Inverted relative to the other two wheel gestures, and deliberately so. Those zoom a
        // *range*, where scrolling up shrinks the window and the content appears to grow. This
        // scales a *multiplier*, so the same sign would make scrolling up flatten the surface --
        // verified backwards in the real app before this was flipped. Scroll up grows, as it does
        // everywhere else; the constants' names read wrong here for exactly that reason.
        const factor = delta > 0 ? CHART_ZOOM_IN_FACTOR : CHART_ZOOM_OUT_FACTOR;
        onPanelControlsChange?.(
          normalizePanelControls({
            ...normalizedPanelControls,
            // The 0.3-3 clamp lives in normalizeSpectrogram3dHeightGain; do not repeat it here.
            spectrogram3dHeightGain: normalizedPanelControls.spectrogram3dHeightGain * factor,
          })
        );
        return;
      }
      if (!e.ctrlKey) {
        onHistoryWheel?.(e);
        return;
      }
      e.preventDefault();
      const floor = cursorToFloor(e);
      // buildYToBand puts maxHz at fFrac 0 and minHz at fFrac 1 (see useSpectrogram3dCanvas), so
      // the anchor's frac is the mirror of fFrac.
      let anchor;
      if (floor) {
        anchor = hzFromFrac(
          1 - floor.fFrac,
          normalizedPanelControls.spectrogramYMinFreq,
          normalizedPanelControls.spectrogramYMaxFreq
        );
      } else {
        const rect = e.currentTarget.getBoundingClientRect();
        const height = Math.max(1, rect.height);
        const px = Math.max(0, Math.min(height, e.clientY - rect.top));
        anchor = pixelToLogValue(
          px,
          height,
          normalizedPanelControls.spectrogramYMinFreq,
          normalizedPanelControls.spectrogramYMaxFreq
        );
      }
      const next = computeLogZoom({
        min: normalizedPanelControls.spectrogramYMinFreq,
        max: normalizedPanelControls.spectrogramYMaxFreq,
        absMin: 20,
        absMax: 20000,
        minOctaves: 1,
        anchor,
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
    [
      cursorToFloor,
      is3d,
      normalizedPanelControls,
      onHistoryWheel,
      onPanelControlsChange,
      pulseChartYAxis,
    ]
  );
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
    () => buildSpectrogramLut(spectrogramTheme.intensityStops),
    [spectrogramTheme.intensityStops]
  );
  const sampleMs = resolveSpectrogramSampleMs(spectrogramSnaps, VISUAL_HIST_SAMPLE_SEC * 1000);
  // The 3D waterfall quantises its decimation stride by this period, so it needs the cadence to hold
  // still between updates rather than the single freshest measurement of it -- see
  // resolveStableSpectrogramSampleMs. The 2D path keeps the plain one: gap detection wants the local
  // interval, and it is tolerant of the jitter that breaks quantisation.
  const stableSampleMs = resolveStableSpectrogramSampleMs(
    spectrogramSnaps,
    VISUAL_HIST_SAMPLE_SEC * 1000
  );
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
    dbFloor: normalizedPanelControls.spectrogramDbFloor,
  });
  useSpectrogram3dCanvas({
    canvasRef: is3d ? canvasRef : NO_CANVAS,
    snapRef,
    projectionRef,
    oldestMs,
    newestMs,
    sampleMs: stableSampleMs,
    selectedOffset,
    selectionXFrac: selLineX / 600,
    frozenSnaps: selectedOffset >= 0 ? spectrogramSnaps : null,
    colormapLut,
    minHz: normalizedPanelControls.spectrogramYMinFreq,
    maxHz: normalizedPanelControls.spectrogramYMaxFreq,
    dbFloor: normalizedPanelControls.spectrogramDbFloor,
    azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
    elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
    heightGain: normalizedPanelControls.spectrogram3dHeightGain,
    colorize: normalizedPanelControls.spectrogram3dColorize,
    floor: normalizedPanelControls.spectrogram3dFloor,
    mode: spectrogramMode,
    themeColors: spectrogramTheme,
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
          downX: e.clientX,
          downY: e.clientY,
          azimuthDeg: normalizedPanelControls.spectrogram3dAzimuthDeg,
          elevationDeg: normalizedPanelControls.spectrogram3dElevationDeg,
        };
        return;
      }
      const floor = cursorToFloor(e);
      if (e.ctrlKey && e.button === 0) {
        chartYDragRef.current = {
          startY: e.clientY,
          // In 3D, floor.fFrac at drag start anchors the pan (see the pointer-move branch below);
          // in 2D this stays null and the branch there falls back to the plain pixel delta.
          startFFrac: floor ? floor.fFrac : null,
          min: normalizedPanelControls.spectrogramYMinFreq,
          max: normalizedPanelControls.spectrogramYMaxFreq,
        };
        setChartDragging(true);
        if (chartActiveTimerRef.current != null) window.clearTimeout(chartActiveTimerRef.current);
        setChartYAxisActive(true);
      }
      onHistoryPointerDown?.(toTimeProxyEvent(e, floor));
    },
    [
      cursorToFloor,
      is3d,
      normalizedPanelControls.spectrogram3dAzimuthDeg,
      normalizedPanelControls.spectrogram3dElevationDeg,
      normalizedPanelControls.spectrogramYMaxFreq,
      normalizedPanelControls.spectrogramYMinFreq,
      onHistoryPointerDown,
      toTimeProxyEvent,
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
      const floor = cursorToFloor(e);
      onHistoryPointerMove?.(toTimeProxyEvent(e, floor));
      const drag = chartYDragRef.current;
      if (drag) {
        let next;
        if (drag.startFFrac != null && floor) {
          // Same pan math as the 2D branch below (a rigid shift of the log-frequency range), but
          // driven by the floor-plane fFrac delta instead of a screen-pixel delta: fFrac runs 0 at
          // maxHz to 1 at minHz, the same orientation pixelToLogValue's frac uses inverted, so the
          // two are equivalent once deltaPx/axisPx is replaced by (fFracNow - fFracStart)/1.
          next = computeLogPan({
            min: drag.min,
            max: drag.max,
            absMin: 20,
            absMax: 20000,
            deltaPx: floor.fFrac - drag.startFFrac,
            axisPx: 1,
          });
        } else {
          const rect = e.currentTarget.getBoundingClientRect();
          next = computeLogPan({
            min: drag.min,
            max: drag.max,
            absMin: 20,
            absMax: 20000,
            deltaPx: e.clientY - drag.startY,
            axisPx: Math.max(1, rect.height),
          });
        }
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
      cursorToFloor,
      is3d,
      normalizedPanelControls,
      onHistoryPointerMove,
      onPanelControlsChange,
      onSpectrogramHoverMove,
      toTimeProxyEvent,
    ]
  );
  const onSpectrogramChartPointerUp = useCallback(
    (e) => {
      const rotate = rotateDragRef.current;
      rotateDragRef.current = null;
      chartYDragRef.current = null;
      setChartDragging(false);
      setChartYAxisActive(false);

      if (is3d && e.button === 2) {
        const moved =
          rotate == null ||
          Math.abs(e.clientX - rotate.downX) > RIGHT_DOUBLE_CLICK_SLOP_PX ||
          Math.abs(e.clientY - rotate.downY) > RIGHT_DOUBLE_CLICK_SLOP_PX;
        const now = Date.now();
        const previous = lastRightUpRef.current;
        lastRightUpRef.current = moved ? null : now;
        if (!moved && previous != null && now - previous <= RIGHT_DOUBLE_CLICK_MS) {
          lastRightUpRef.current = null;
          onPanelControlsChange?.(
            normalizePanelControls({
              ...normalizedPanelControls,
              spectrogram3dAzimuthDeg: DEFAULT_PANEL_CONTROLS.spectrogram3dAzimuthDeg,
              spectrogram3dElevationDeg: DEFAULT_PANEL_CONTROLS.spectrogram3dElevationDeg,
            })
          );
        }
        // Skipping onHistoryPointerUp is safe, not an oversight: the shared handler is left-button
        // driven, and in 3D the right-button pointer-down returns before onHistoryPointerDown ever
        // runs, so there is no drag mode for it to clear. Implicit pointer capture releases itself
        // when the button state empties.
        return;
      }

      onHistoryPointerUp?.(e);
    },
    [is3d, normalizedPanelControls, onHistoryPointerUp, onPanelControlsChange]
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
          {/* Y-axis: frequency, in both view modes. In 3D the ticks state the range on screen and
              not a position -- the floor covers only part of the canvas height and sits at whatever
              azimuth the user has rotated to, so a tick's vertical position means nothing there.
              That is accepted, not an oversight; see the axes-and-gestures design. */}
          <div
            ref={spectrogramYAxis.axisRef}
            {...spectrogramYAxis.axisHandlers}
            style={{ cursor: spectrogramYAxis.cursorStyle }}
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              (spectrogramYAxis.isActive || chartYAxisActive) && "text-foreground"
            )}
          >
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
                  <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded-xs border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
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
