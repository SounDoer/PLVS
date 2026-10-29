import { ChartHoverHud } from "./ChartHoverHud.jsx";
import { panelOrientation, orientationSvgTransform } from "../../math/panelOrientation.js";
import { usePanelPresentation } from "../../workspace/AudioDataContext.jsx";
import { WAVEFORM_FILL_OPACITY } from "@/lib/chartFill.js";
import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { PANEL_MIN_WAVEFORM, W_LOUDNESS_Y_AXIS } from "@/lib/shellLayout";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { TimeAxisRail, timeAxisInteraction } from "./AxisRail.jsx";
import { ChartCrosshair } from "./ChartCrosshair.jsx";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import {
  sliceWaveformSubHistory,
  sliceWaveformSubHistoryFromIndex,
} from "../../math/waveformMath.js";
import { useChartHover } from "../../hooks/useChartHover";
import { useCanvasBackingStore } from "../../hooks/useCanvasBackingStore.js";
import { canvasCssScale, strokeCssWidth } from "../../lib/canvasCssScale.js";
import { useCtrlHoverState } from "../../hooks/useCtrlHoverState";
import { computeWaveformHoverPoint } from "../../math/hoverMath";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { TimelineLatestEdgeHint } from "./TimelineLatestEdgeHint.jsx";
import { TimelineSelectionEdgeHint } from "./TimelineSelectionEdgeHint.jsx";
import { normalizePanelControls } from "../../lib/panelControls.js";
import {
  centroidYFraction,
  EMPTY_SPECTRAL_WAVEFORM_METRICS,
  parseCssRgb,
  sliceSpectralWaveformMetrics,
  waveformFrequencyRgbInto,
  waveformFrequencyScale,
} from "../../math/spectralWaveformMath.js";
import {
  DEFAULT_WAVEFORM_CANVAS_COLORS,
  selectWaveformCanvasColors,
} from "../../theme/themeCanvasSelectors.js";
import { useResolvedTheme } from "../../theme/useResolvedTheme.js";
import { readCssNumber } from "../../theme/cssTokens.js";

const WAVEFORM_AXIS_WIDTH_VAR = "--ui-chart-y-axis-rail-w";
const WAVEFORM_CHART_LEFT = `calc(var(${WAVEFORM_AXIS_WIDTH_VAR}) + var(--ui-chart-axis-gap))`;
const WAVEFORM_MAX_DEVICE_PIXEL_RATIO = 1;
/**
 * @param {number} visibleSamples
 * @param {number} effectiveOffsetSamples
 */
function getWaveformHistoryWindowBounds(histSourceList, visibleSamples, effectiveOffsetSamples) {
  const total = histSourceList.length;
  if (total === 0) {
    return { startIndex: -1, endIndex: -1, startRow: null, endRow: null };
  }
  const windowSamples = Math.max(1, visibleSamples);
  const off = Math.max(0, Math.min(Math.max(0, total - 1), effectiveOffsetSamples));
  const newestVisible = total - 1 - off;
  const oldestVisible = newestVisible - windowSamples + 1;
  const startIndex = Math.max(0, Math.floor(oldestVisible));
  const endIndex = Math.min(total - 1, Math.ceil(newestVisible));
  if (endIndex < startIndex) {
    return { startIndex: -1, endIndex: -1, startRow: null, endRow: null };
  }
  const rowAt = (/** @type {number} */ index) =>
    typeof histSourceList.rowAt === "function"
      ? histSourceList.rowAt(index)
      : histSourceList[index];
  const lowerIndex = Math.max(0, Math.min(total - 1, Math.floor(newestVisible)));
  const upperIndex = Math.max(0, Math.min(total - 1, Math.ceil(newestVisible)));
  const lowerTimestampMs = Number(rowAt(lowerIndex)?.timestampMs);
  const upperTimestampMs = Number(rowAt(upperIndex)?.timestampMs);
  const newestVisibleTimestampMs =
    Number.isFinite(lowerTimestampMs) && Number.isFinite(upperTimestampMs)
      ? lowerTimestampMs +
        (upperTimestampMs - lowerTimestampMs) * (newestVisible - Math.floor(newestVisible))
      : Number.isFinite(upperTimestampMs)
        ? upperTimestampMs
        : lowerTimestampMs;
  return {
    startIndex,
    endIndex,
    startRow: rowAt(startIndex) ?? null,
    endRow: rowAt(endIndex) ?? null,
    newestVisibleTimestampMs,
  };
}

export function drawWaveformCanvas(
  canvas,
  {
    orientation = "right-to-left",
    mins,
    maxes,
    bucketCount,
    fracPhase,
    firstBucket,
    lastBucket,
    selected,
    frequencyColor,
    lowMidSplitHz,
    midHighSplitHz,
    dominantFrequencyHz,
    spectralCentroidHz,
    tonality,
    centroid,
    themeColors = DEFAULT_WAVEFORM_CANVAS_COLORS,
  }
) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const geometry = panelOrientation(orientation);
  const W = geometry.vertical ? canvas.height : canvas.width;
  const H = geometry.vertical ? canvas.width : canvas.height;
  const moveTo = (x, y) => {
    const point = geometry.toScreen(x / W, 1 - y / H);
    ctx.moveTo(point.x * canvas.width, point.y * canvas.height);
  };
  const lineTo = (x, y) => {
    const point = geometry.toScreen(x / W, 1 - y / H);
    ctx.lineTo(point.x * canvas.width, point.y * canvas.height);
  };
  // Paths are built in backing pixels, whose width is capped at 1:1 while the height keeps full
  // DPR. Every line width below is CSS px and is stroked through strokeCssWidth for that reason.
  const cssScale = canvasCssScale(canvas);

  const strokeColor = selected ? themeColors.snapshot : themeColors.trace;
  const root = document.documentElement;
  const fillOpacity = WAVEFORM_FILL_OPACITY;
  // Stroke width is product-owned geometry and remains a CSS token.
  const strokeWidth = readCssNumber(root, "--ui-waveform-stroke-width", 1) || 1;
  const spectralPalette = {
    low: parseCssRgb(selected ? themeColors.frequencyLowHistory : themeColors.frequencyLow),
    mid: parseCssRgb(selected ? themeColors.frequencyMidHistory : themeColors.frequencyMid),
    high: parseCssRgb(selected ? themeColors.frequencyHighHistory : themeColors.frequencyHigh),
    neutral: parseCssRgb(
      selected ? themeColors.frequencyNeutralHistory : themeColors.frequencyNeutral
    ),
  };
  const centroidColor = themeColors.centroid;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // No line is drawn at zero; the trace is still measured from it.
  const cy = H / 2;

  if (firstBucket < 0 || !bucketCount || !mins?.length || !maxes?.length) return;

  const xFor = (/** @type {number} */ j) => j - fracPhase; // one bucket per device pixel, sub-pixel phase
  if (frequencyColor) {
    // One colour per pixel column, so the split-derived anchors are resolved once here and the
    // result is written into a single reused array. See `docs/history/notes/perf/waveform.md` §2.1.
    const frequencyScale = waveformFrequencyScale(
      { lowMidSplitHz, midHighSplitHz },
      spectralPalette
    );
    const color = [0, 0, 0];
    for (let j = firstBucket; j <= lastBucket; j++) {
      const next = Math.min(lastBucket, j + 1);
      waveformFrequencyRgbInto(
        frequencyScale,
        dominantFrequencyHz?.[j] ?? 0,
        tonality?.[j] ?? 0,
        color
      );
      const colorCss = `rgb(${color[0]} ${color[1]} ${color[2]})`;
      const x = xFor(j);
      const nextX = xFor(next) + (next === j ? 1 : 0);
      const yMax = cy - Math.max(0, maxes[j]) * cy;
      const yMin = cy - Math.min(0, mins[j]) * cy;
      const nextYMax = cy - Math.max(0, maxes[next]) * cy;
      const nextYMin = cy - Math.min(0, mins[next]) * cy;
      const fillLeft = x - 0.5;
      const fillRight = nextX + 0.5;
      ctx.beginPath();
      moveTo(fillLeft, yMax);
      lineTo(fillRight, nextYMax);
      lineTo(fillRight, nextYMin);
      lineTo(fillLeft, yMin);
      ctx.closePath();
      // Frequency Color is the waveform body, not a translucent overlay on the classic trace.
      ctx.globalAlpha = 1;
      ctx.fillStyle = colorCss;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colorCss;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      moveTo(x, yMax);
      lineTo(nextX, nextYMax);
      moveTo(x, yMin);
      lineTo(nextX, nextYMin);
      strokeCssWidth(ctx, cssScale);
    }
  } else {
    ctx.beginPath();
    for (let j = firstBucket; j <= lastBucket; j++) {
      const x = xFor(j);
      const y = cy - maxes[j] * cy;
      if (j === firstBucket) moveTo(x, y);
      else lineTo(x, y);
    }
    for (let j = lastBucket; j >= firstBucket; j--) {
      const x = xFor(j);
      const y = cy - mins[j] * cy;
      lineTo(x, y);
    }
    ctx.closePath();

    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeWidth;
    strokeCssWidth(ctx, cssScale);
  }

  if (centroid && spectralCentroidHz?.length) {
    ctx.strokeStyle = centroidColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    let drawing = false;
    for (let j = firstBucket; j <= lastBucket; j++) {
      const yFraction = centroidYFraction(spectralCentroidHz[j]);
      if (yFraction === null) {
        drawing = false;
        continue;
      }
      const x = xFor(j);
      const y = yFraction * H;
      if (drawing) lineTo(x, y);
      else moveTo(x, y);
      drawing = true;
    }
    strokeCssWidth(ctx, cssScale);
  }
}

/** @param {{compact?: boolean, showAxes?: boolean, className?: string}} props */
export function WaveformPanel({ showAxes: axesOverride, className } = {}) {
  const { showAxes, fitContainer } = usePanelPresentation(axesOverride);
  const themeColors = useResolvedTheme(selectWaveformCanvasColors);
  const frameData = useFrameData();
  const historyData = useHistoryData();
  const { panelVisible, panelControls } = usePanelInstanceData();
  const waveformControls = useMemo(() => normalizePanelControls(panelControls), [panelControls]);
  const panelData = useMemo(() => ({ ...historyData, ...frameData }), [frameData, historyData]);
  if (panelVisible === false) {
    return (
      <div
        className={cn(
          !fitContainer && PANEL_MIN_WAVEFORM,
          "@container relative flex min-h-0 flex-1 flex-col overflow-hidden",
          "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
          className
        )}
      />
    );
  }

  return (
    <WaveformPanelContent
      fitContainer={fitContainer}
      showAxes={showAxes}
      className={className}
      audioData={panelData}
      controls={waveformControls}
      themeColors={themeColors}
    />
  );
}

function WaveformPanelContent({
  audioData,
  controls,
  themeColors,
  showAxes,
  fitContainer,
  className,
}) {
  const orientation = controls.waveformOrientation;
  const geometry = panelOrientation(orientation);
  const vertical = geometry.vertical;
  const plotInsets = vertical
    ? { bottom: showAxes ? "var(--ui-chart-x-axis-row-h)" : 0 }
    : { left: showAxes ? WAVEFORM_CHART_LEFT : 0 };
  const {
    histSourceList,
    waveformHistoryIndex,
    visualWaveformHist,
    visibleSamples,
    effectiveOffsetSamples,
    channelCount,
    peakLabelContext,
    historyTimeTicks,
    historyChartInteractive,
    historyTimeAxisHandlers,
    historyTimeAxisActive,
    selectedOffset,
    selLineX,
    showSelLine,
    selectionEdge,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
    setSelectedOffset,
    holdHistoryHud,
    showHistoryHud,
  } = audioData;

  // Buckets are one per backing column, so their count is the lane canvas's own backing width,
  // reported by the lanes. Every lane has the same box, hence the same width.
  const [canvasW, setCanvasW] = useState(0);

  const waveformSourceList = histSourceList ?? [];
  const effectiveChannels = channelCount >= 2 ? channelCount : Math.max(1, channelCount || 2);
  const labels = getPeakMeterChannelLabels(effectiveChannels, peakLabelContext ?? {});
  const waveformHistoryWindow = getWaveformHistoryWindowBounds(
    waveformSourceList,
    visibleSamples ?? 0,
    effectiveOffsetSamples ?? 0
  );
  const { mins, maxes, bucketCount, fracPhase, firstBucket, lastBucket } = useMemo(
    () =>
      waveformHistoryIndex
        ? sliceWaveformSubHistoryFromIndex(
            waveformSourceList,
            waveformHistoryIndex,
            visibleSamples ?? 0,
            effectiveOffsetSamples ?? 0,
            effectiveChannels,
            canvasW
          )
        : sliceWaveformSubHistory(
            waveformSourceList,
            visibleSamples ?? 0,
            effectiveOffsetSamples ?? 0,
            effectiveChannels,
            canvasW
          ),
    // The history ring mutates in place; its visible bounds intentionally invalidate this slice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      waveformSourceList,
      waveformHistoryIndex,
      visibleSamples,
      effectiveOffsetSamples,
      effectiveChannels,
      canvasW,
      waveformHistoryWindow.startIndex,
      waveformHistoryWindow.endIndex,
      waveformHistoryWindow.startRow?.timestampMs,
      waveformHistoryWindow.endRow?.timestampMs,
    ]
  );
  // Only the two spectral overlays read these, and both default to off. Deriving them anyway means
  // searching the visual ring on every tick for a result nothing looks at.
  const spectralOverlaysOn = Boolean(controls.waveformFrequencyColor || controls.waveformCentroid);
  const spectralMetrics = useMemo(
    () =>
      !spectralOverlaysOn
        ? EMPTY_SPECTRAL_WAVEFORM_METRICS
        : sliceSpectralWaveformMetrics(
            visualWaveformHist,
            waveformHistoryWindow.startRow?.timestampMs,
            waveformHistoryWindow.endRow?.timestampMs,
            bucketCount,
            effectiveChannels,
            {
              newestVisibleTimestampMs: waveformHistoryWindow.newestVisibleTimestampMs,
              visibleSamples: visibleSamples ?? 0,
              pixelWidth: canvasW,
              fracPhase,
              waveformRows: waveformSourceList,
              effectiveOffsetSamples: effectiveOffsetSamples ?? 0,
              nominalIntervalMs: HIST_SAMPLE_SEC * 1000,
            }
          ),
    // The spectral history ring also mutates in place; its version invalidates the derived metrics.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      spectralOverlaysOn,
      visualWaveformHist,
      visualWaveformHist?.version,
      waveformHistoryWindow.startRow?.timestampMs,
      waveformHistoryWindow.endRow?.timestampMs,
      waveformHistoryWindow.newestVisibleTimestampMs,
      bucketCount,
      fracPhase,
      visibleSamples,
      canvasW,
      effectiveChannels,
      effectiveOffsetSamples,
      waveformSourceList,
    ]
  );

  const {
    hover: waveformHover,
    onMove: onWaveformHoverMove,
    onLeave: onWaveformHoverLeave,
  } = useChartHover(
    (xFrac, yFrac) =>
      historyChartInteractive
        ? computeWaveformHoverPoint(
            geometry.fromScreen(xFrac, yFrac).time,
            mins,
            maxes,
            bucketCount,
            effectiveOffsetSamples ?? 0,
            visibleSamples ?? 0,
            HIST_SAMPLE_SEC,
            labels,
            firstBucket,
            lastBucket
          )
        : null,
    selectedOffset < 0
      ? `${orientation}:${waveformHistoryWindow.startIndex}:${waveformHistoryWindow.endIndex}:${waveformHistoryWindow.startRow?.timestampMs ?? ""}:${waveformHistoryWindow.endRow?.timestampMs ?? ""}:${effectiveOffsetSamples ?? 0}:${visibleSamples ?? 0}:${bucketCount}:${fracPhase}:${firstBucket}:${lastBucket}`
      : orientation
  );
  const [chartDragging, setChartDragging] = useState(null);
  const { isCtrlHover, notePointerMove, notePointerLeave } = useCtrlHoverState();

  return (
    <div
      data-chart-hud-boundary
      className={cn(
        !fitContainer && PANEL_MIN_WAVEFORM,
        "@container relative flex min-h-0 flex-1 flex-col gap-[var(--ui-chart-axis-gap)] overflow-hidden",
        "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
        className
      )}
    >
      {/* Channel lanes + interaction overlay */}
      {showAxes && vertical && (
        <TimeAxisRail
          axis="y"
          className="absolute left-[var(--ui-panel-pad-x)] top-[var(--ui-panel-pad-y)] w-[var(--ui-chart-y-axis-rail-w)]"
          style={{ bottom: "calc(var(--ui-panel-pad-y) + var(--ui-chart-x-axis-row-h))" }}
          interaction={timeAxisInteraction(historyTimeAxisHandlers, true)}
          active={historyTimeAxisActive}
          ticks={(historyTimeTicks ?? []).map((label, i) => ({
            key: i,
            label,
            frac: geometry.timePosition(i / HISTORY_TIME_TICK_STEPS),
          }))}
        />
      )}
      <div
        data-tour-target="history"
        className={cn(
          "relative isolate flex min-h-0 min-w-0 flex-1 gap-0",
          vertical ? "flex-row" : "flex-col"
        )}
        style={{ marginLeft: vertical && showAxes ? WAVEFORM_CHART_LEFT : undefined }}
      >
        {Array.from({ length: effectiveChannels }, (_, ch) => (
          <WaveformLane
            key={ch}
            orientation={orientation}
            showLabels={showAxes}
            label={labels[ch] ?? `Ch${ch + 1}`}
            mins={mins[ch]}
            maxes={maxes[ch]}
            bucketCount={bucketCount}
            fracPhase={fracPhase}
            firstBucket={firstBucket}
            lastBucket={lastBucket}
            selected={selectedOffset >= 0}
            frequencyColor={controls.waveformFrequencyColor}
            lowMidSplitHz={controls.waveformLowMidSplitHz}
            midHighSplitHz={controls.waveformMidHighSplitHz}
            dominantFrequencyHz={spectralMetrics.dominantFrequencyHz[ch]}
            spectralCentroidHz={spectralMetrics.spectralCentroidHz[ch]}
            tonality={spectralMetrics.tonality[ch]}
            centroid={controls.waveformCentroid}
            themeColors={themeColors}
            onBackingWidth={setCanvasW}
          />
        ))}

        <div className="pointer-events-none absolute inset-0" style={plotInsets}>
          <TimelineLatestEdgeHint
            active={(effectiveOffsetSamples ?? 0) > 0}
            edge={geometry.newestEdge}
          />
          <TimelineSelectionEdgeHint
            direction={
              selectionEdge === "left"
                ? geometry.oldestEdge
                : selectionEdge === "right"
                  ? geometry.newestEdge
                  : null
            }
            color={themeColors.selection}
          />
        </div>

        {/* Hover crosshair + popover 鈥?pointer-events-none so interaction overlay stays active */}
        {waveformHover && (
          <div className="pointer-events-none absolute inset-0 z-[25]" style={plotInsets}>
            <ChartCrosshair
              leftPct={
                vertical ? undefined : geometry.timePosition(waveformHover.leftPct / 100) * 100
              }
              topPct={
                vertical ? geometry.timePosition(waveformHover.leftPct / 100) * 100 : undefined
              }
            />
            {/* Popover */}
            <ChartHoverHud channelOverflow>
              <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                {waveformHover.timeLabel}
              </div>
              {waveformHover.channels.map(({ label, dbFs }) => (
                <div key={label}>
                  {label}{" "}
                  <span className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                    {dbFs != null ? `${dbFs.toFixed(1)} dBFS` : "-"}
                  </span>
                </div>
              ))}
            </ChartHoverHud>
          </div>
        )}

        {/* Selection line 鈥?aligned with canvas area, not the label column */}
        {selectedOffset >= 0 && showSelLine && (
          <div className="pointer-events-none absolute inset-0 z-20" style={plotInsets}>
            <svg viewBox="0 0 600 1" preserveAspectRatio="none" className="h-full w-full">
              <line
                transform={orientationSvgTransform(orientation, 600, 1)}
                x1={selLineX}
                x2={selLineX}
                y1={0}
                y2={1}
                stroke={themeColors.selection}
                strokeWidth="var(--ui-loudness-selection-stroke-width)"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        )}

        {/* Interaction overlay 鈥?covers canvas area only so pointer x maps correctly */}
        <div
          className="absolute inset-0 z-30"
          data-waveform-interaction-overlay
          style={{
            ...plotInsets,
            cursor: historyChartInteractive
              ? chartDragging === orientation
                ? "grabbing"
                : isCtrlHover
                  ? "grab"
                  : "crosshair"
              : "default",
            pointerEvents: historyChartInteractive ? "auto" : "none",
          }}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={() => {
            if (!historyChartInteractive) return;
            setSelectedOffset(-1);
            holdHistoryHud(false);
            showHistoryHud(1200);
          }}
          onWheel={onHistoryWheel}
          onPointerDown={(e) => {
            if (e.ctrlKey && e.button === 0) setChartDragging(orientation);
            onHistoryPointerDown(e);
          }}
          onPointerMove={(e) => {
            notePointerMove(e);
            onHistoryPointerMove(e);
            onWaveformHoverMove(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          onPointerLeave={() => {
            notePointerLeave();
            onWaveformHoverLeave();
          }}
          onPointerUp={(e) => {
            setChartDragging(null);
            onHistoryPointerUp(e);
          }}
          onPointerCancel={(e) => {
            setChartDragging(null);
            onHistoryPointerUp(e);
          }}
        />
      </div>

      {showAxes && !vertical && (
        <div className="flex h-[var(--ui-chart-x-axis-row-h)] shrink-0 items-start gap-[var(--ui-chart-axis-gap)]">
          <div data-waveform-x-axis-spacer className={cn(W_LOUDNESS_Y_AXIS, "shrink-0")} />
          <TimeAxisRail
            axis="x"
            className="h-full flex-1"
            interaction={timeAxisInteraction(historyTimeAxisHandlers)}
            active={historyTimeAxisActive}
            ticks={(historyTimeTicks ?? []).map((tick, i) => ({
              // Keyed by slot, not by text. A time label changes on almost every update, so a key
              // carrying it made React unmount and remount the tick instead of writing its text --
              // measured at 77 node mutations a second per panel, in three panels.
              key: i,
              label: tick,
              frac: geometry.timePosition(i / HISTORY_TIME_TICK_STEPS),
            }))}
          />
        </div>
      )}
    </div>
  );
}

function WaveformLane({
  orientation,
  showLabels,
  label,
  mins,
  maxes,
  bucketCount,
  fracPhase,
  firstBucket,
  lastBucket,
  selected,
  frequencyColor,
  lowMidSplitHz,
  midHighSplitHz,
  dominantFrequencyHz,
  spectralCentroidHz,
  tonality,
  centroid,
  themeColors,
  onBackingWidth,
}) {
  const vertical = panelOrientation(orientation).vertical;
  const canvasRef = useRef(null);
  const drawParamsRef = useRef(null);
  const rafRef = useRef(0);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const canvas = canvasRef.current;
      const drawParams = drawParamsRef.current;
      if (!canvas || !drawParams) return;
      drawWaveformCanvas(canvas, drawParams);
    });
  }, []);

  const onResize = useCallback(
    ({ width, height }) => {
      onBackingWidth(vertical ? height : width);
      scheduleDraw();
    },
    [onBackingWidth, scheduleDraw, vertical]
  );
  useCanvasBackingStore(canvasRef, {
    onResize,
    // Cap width only: bucket count (decimation cost) tracks canvas width, so the fullscreen-perf
    // cap stays there. Height keeps full DPR so the near-zero envelope renders at real vertical
    // resolution instead of a sub-pixel hairline that flickers as it scrolls.
    maxDevicePixelRatioX: vertical ? undefined : WAVEFORM_MAX_DEVICE_PIXEL_RATIO,
    maxDevicePixelRatioY: vertical ? WAVEFORM_MAX_DEVICE_PIXEL_RATIO : undefined,
  });

  useEffect(() => {
    drawParamsRef.current = {
      orientation,
      mins,
      maxes,
      bucketCount,
      fracPhase,
      firstBucket,
      lastBucket,
      selected,
      frequencyColor,
      lowMidSplitHz,
      midHighSplitHz,
      dominantFrequencyHz,
      spectralCentroidHz,
      tonality,
      centroid,
      themeColors,
    };
    scheduleDraw();
  }, [
    mins,
    maxes,
    bucketCount,
    fracPhase,
    firstBucket,
    lastBucket,
    selected,
    frequencyColor,
    lowMidSplitHz,
    midHighSplitHz,
    dominantFrequencyHz,
    spectralCentroidHz,
    tonality,
    centroid,
    themeColors,
    scheduleDraw,
    orientation,
  ]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // StrictMode remounts on the same refs. A cancelled id left here makes `scheduleDraw` treat
      // a frame as pending forever, and the lane never paints again.
      rafRef.current = 0;
    },
    []
  );

  return (
    <div
      data-waveform-lane
      className={cn(
        "flex min-h-0 min-w-0 flex-1 items-stretch gap-[var(--ui-chart-axis-gap)]",
        vertical && "flex-col-reverse"
      )}
    >
      {showLabels && (
        <div
          data-waveform-label-rail
          className={cn(
            vertical ? "h-[var(--ui-chart-x-axis-row-h)]" : W_LOUDNESS_Y_AXIS,
            "flex shrink-0 items-center text-[length:var(--ui-fs-axis)] text-[color:var(--ui-text-annotation)]",
            vertical ? "justify-center" : "justify-end"
          )}
        >
          {label}
        </div>
      )}
      <div className="relative min-h-0 min-w-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}
