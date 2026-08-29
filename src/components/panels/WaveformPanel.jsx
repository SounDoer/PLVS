import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { PANEL_MIN_WAVEFORM, W_LOUDNESS_Y_AXIS } from "@/lib/shellLayout";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { AxisRail, timeAxisInteraction } from "./AxisRail.jsx";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import {
  sliceWaveformSubHistory,
  sliceWaveformSubHistoryFromIndex,
} from "../../math/waveformMath.js";
import { useChartHover } from "../../hooks/useChartHover";
import { useCanvasSize } from "../../hooks/useCanvasSize";
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
function cssLengthToPx(value) {
  const trimmed = value?.trim();
  if (!trimmed) return 0;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return 0;
  if (trimmed.endsWith("rem")) {
    const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return numeric * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
  }
  return numeric;
}

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
  const rowAt = (index) =>
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
  const W = canvas.width;
  const H = canvas.height;

  const strokeColor = selected ? themeColors.snapshot : themeColors.trace;
  // Read through the theme-scoped cache: these are per-frame reads of values that change only
  // with the theme. See `readCssToken`.
  const root = document.documentElement;
  const fillOpacity = readCssNumber(root, "--ui-waveform-fill-opacity", 0.22) || 0.22;
  const strokeWidth = readCssNumber(root, "--ui-waveform-stroke-width", 1) || 1;
  const spectralPalette = {
    low: parseCssRgb(themeColors.frequencyLow),
    mid: parseCssRgb(themeColors.frequencyMid),
    high: parseCssRgb(themeColors.frequencyHigh),
    neutral: parseCssRgb(themeColors.frequencyNeutral),
  };
  const centroidColor = themeColors.centroid;

  ctx.clearRect(0, 0, W, H);

  // No line is drawn at zero; the trace is still measured from it.
  const cy = H / 2;

  if (firstBucket < 0 || !bucketCount || !mins?.length || !maxes?.length) return;

  const xFor = (j) => j - fracPhase; // one bucket per device pixel, sub-pixel phase
  if (frequencyColor) {
    // One colour per pixel column, so the split-derived anchors are resolved once here and the
    // result is written into a single reused array. See `docs/working/perf/waveform.md` §2.1.
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
      ctx.moveTo(fillLeft, yMax);
      ctx.lineTo(fillRight, nextYMax);
      ctx.lineTo(fillRight, nextYMin);
      ctx.lineTo(fillLeft, yMin);
      ctx.closePath();
      // Frequency Color is the waveform body, not a translucent overlay on the classic trace.
      ctx.globalAlpha = 1;
      ctx.fillStyle = colorCss;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = colorCss;
      ctx.lineWidth = strokeWidth;
      ctx.beginPath();
      ctx.moveTo(x, yMax);
      ctx.lineTo(nextX, nextYMax);
      ctx.moveTo(x, yMin);
      ctx.lineTo(nextX, nextYMin);
      ctx.stroke();
    }
  } else {
    ctx.beginPath();
    for (let j = firstBucket; j <= lastBucket; j++) {
      const x = xFor(j);
      const y = cy - maxes[j] * cy;
      if (j === firstBucket) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let j = lastBucket; j >= firstBucket; j--) {
      const x = xFor(j);
      const y = cy - mins[j] * cy;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = strokeColor;
    // WAVEFORM_MAX_DEVICE_PIXEL_RATIO caps the backing store width at 1:1 with CSS pixels, so the
    // token is the width in device pixels as-is. Scaling it by dpr again doubles the trace on HiDPI.
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
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
      if (drawing) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
      drawing = true;
    }
    ctx.stroke();
  }
}

export function WaveformPanel({ compact = false }) {
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
          PANEL_MIN_WAVEFORM,
          "@container relative flex min-h-0 flex-1 flex-col overflow-hidden",
          "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      />
    );
  }

  return (
    <WaveformPanelContent
      compact={compact}
      audioData={panelData}
      controls={waveformControls}
      themeColors={themeColors}
    />
  );
}

function WaveformPanelContent({ compact, audioData, controls, themeColors }) {
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

  const lanesRef = useRef(null);
  const [canvasW, setCanvasW] = useState(0);
  useEffect(() => {
    const el = lanesRef.current;
    if (!el) return;
    let rafId = 0;

    const measureWidth = () => {
      rafId = 0;
      const dpr = Math.min(window.devicePixelRatio || 1, WAVEFORM_MAX_DEVICE_PIXEL_RATIO);
      const computedStyle = getComputedStyle(el);
      const axisWidthPx =
        el.querySelector("[data-waveform-label-rail]")?.getBoundingClientRect().width ?? 0;
      const chartAxisGapPx = cssLengthToPx(computedStyle.getPropertyValue("--ui-chart-axis-gap"));
      const cssW = Math.max(0, el.clientWidth - axisWidthPx - chartAxisGapPx);
      const nextCanvasW = Math.round(cssW * dpr);
      setCanvasW((prevCanvasW) => (prevCanvasW === nextCanvasW ? prevCanvasW : nextCanvasW));
    };

    const ro = new ResizeObserver(() => {
      if (rafId) return;
      rafId = requestAnimationFrame(measureWidth);
    });
    ro.observe(el);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      ro.disconnect();
    };
  }, []);

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
    (xFrac) =>
      historyChartInteractive
        ? computeWaveformHoverPoint(
            xFrac,
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
      ? `${waveformHistoryWindow.startIndex}:${waveformHistoryWindow.endIndex}:${waveformHistoryWindow.startRow?.timestampMs ?? ""}:${waveformHistoryWindow.endRow?.timestampMs ?? ""}:${effectiveOffsetSamples ?? 0}:${visibleSamples ?? 0}:${bucketCount}:${fracPhase}:${firstBucket}:${lastBucket}`
      : null
  );
  const [chartDragging, setChartDragging] = useState(false);
  const { isCtrlHover, notePointerMove, notePointerLeave } = useCtrlHoverState();

  return (
    <div
      className={cn(
        PANEL_MIN_WAVEFORM,
        "@container relative flex min-h-0 flex-1 flex-col gap-[var(--ui-chart-axis-gap)] overflow-hidden",
        "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      {/* Channel lanes + interaction overlay */}
      <div ref={lanesRef} className="relative isolate flex min-h-0 flex-1 flex-col gap-0.5">
        {Array.from({ length: effectiveChannels }, (_, ch) => (
          <WaveformLane
            key={ch}
            label={labels[ch] ?? `Ch${ch + 1}`}
            mins={mins[ch]}
            maxes={maxes[ch]}
            bucketCount={bucketCount}
            fracPhase={fracPhase}
            firstBucket={firstBucket}
            lastBucket={lastBucket}
            compact={compact}
            selected={selectedOffset >= 0}
            frequencyColor={controls.waveformFrequencyColor}
            lowMidSplitHz={controls.waveformLowMidSplitHz}
            midHighSplitHz={controls.waveformMidHighSplitHz}
            dominantFrequencyHz={spectralMetrics.dominantFrequencyHz[ch]}
            spectralCentroidHz={spectralMetrics.spectralCentroidHz[ch]}
            tonality={spectralMetrics.tonality[ch]}
            centroid={controls.waveformCentroid}
            themeColors={themeColors}
          />
        ))}

        <TimelineLatestEdgeHint
          active={(effectiveOffsetSamples ?? 0) > 0}
          className="left-[calc(var(--ui-chart-y-axis-rail-w)+var(--ui-chart-axis-gap))] w-auto"
        />
        <TimelineSelectionEdgeHint
          direction={selectionEdge}
          className={
            selectionEdge === "left"
              ? "left-[calc(var(--ui-chart-y-axis-rail-w)+var(--ui-chart-axis-gap))]"
              : undefined
          }
        />

        {/* Hover crosshair + popover 鈥?pointer-events-none so interaction overlay stays active */}
        {waveformHover && (
          <div
            className="pointer-events-none absolute inset-0 z-[25]"
            style={{ left: WAVEFORM_CHART_LEFT }}
          >
            {/* Vertical crosshair line */}
            <div
              className="absolute bottom-0 top-0 border-l border-dashed border-muted-foreground/55"
              style={{ left: `${waveformHover.leftPct}%` }}
            />
            {/* Popover */}
            <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded-xs border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
              <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                {waveformHover.timeLabel}
              </div>
              {waveformHover.channels.map(({ label, dbFs }) => (
                <div key={label}>
                  {label}{" "}
                  <span className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                    {dbFs.toFixed(1)} dBFS
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Selection line 鈥?aligned with canvas area, not the label column */}
        {selectedOffset >= 0 && showSelLine && (
          <div
            className="pointer-events-none absolute inset-0 z-20"
            style={{ left: WAVEFORM_CHART_LEFT }}
          >
            <svg viewBox="0 0 600 1" preserveAspectRatio="none" className="h-full w-full">
              <line
                x1={selLineX}
                x2={selLineX}
                y1={0}
                y2={1}
                stroke="var(--ui-loudness-selection)"
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
            left: WAVEFORM_CHART_LEFT,
            cursor: historyChartInteractive
              ? chartDragging
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
            if (e.ctrlKey && e.button === 0) setChartDragging(true);
            onHistoryPointerDown(e);
          }}
          onPointerMove={(e) => {
            notePointerMove(e);
            onHistoryPointerMove(e);
            onWaveformHoverMove(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          onPointerLeave={(e) => {
            notePointerLeave(e);
            onWaveformHoverLeave(e);
          }}
          onPointerUp={(e) => {
            setChartDragging(false);
            onHistoryPointerUp(e);
          }}
          onPointerCancel={(e) => {
            setChartDragging(false);
            onHistoryPointerUp(e);
          }}
        />
      </div>

      <div className="flex h-[var(--ui-chart-x-axis-row-h)] shrink-0 items-start gap-[var(--ui-chart-axis-gap)]">
        <div data-waveform-x-axis-spacer className={cn(W_LOUDNESS_Y_AXIS, "shrink-0")} />
        <AxisRail
          axis="x"
          className="h-full flex-1"
          interaction={timeAxisInteraction(historyTimeAxisHandlers)}
          active={historyTimeAxisActive}
          ticks={(historyTimeTicks ?? []).map((tick, i) => ({
            key: `${i}-${tick}`,
            label: tick,
            frac: i / HISTORY_TIME_TICK_STEPS,
          }))}
        />
      </div>
    </div>
  );
}

function WaveformLane({
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
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
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

  useCanvasSize(canvasRef, containerRef, scheduleDraw, {
    // Cap width only: bucket count (decimation cost) tracks canvas width, so the fullscreen-perf
    // cap stays there. Height keeps full DPR so the near-zero envelope renders at real vertical
    // resolution instead of a sub-pixel hairline that flickers as it scrolls.
    maxDevicePixelRatioX: WAVEFORM_MAX_DEVICE_PIXEL_RATIO,
  });

  useEffect(() => {
    drawParamsRef.current = {
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
  ]);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  return (
    <div
      data-waveform-lane
      className="flex min-h-0 min-w-0 flex-1 items-stretch gap-[var(--ui-chart-axis-gap)]"
    >
      <div
        data-waveform-label-rail
        className={cn(
          W_LOUDNESS_Y_AXIS,
          "flex shrink-0 items-center justify-end text-[length:var(--ui-fs-axis)] text-muted-foreground"
        )}
      >
        {label}
      </div>
      <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      </div>
    </div>
  );
}
