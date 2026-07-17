import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_WAVEFORM, W_LOUDNESS_Y_AXIS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { sliceWaveformSubHistory } from "../../math/waveformMath.js";
import { useChartHover } from "../../hooks/useChartHover";
import { useCanvasSize } from "../../hooks/useCanvasSize";
import { useCtrlHoverState } from "../../hooks/useCtrlHoverState";
import { computeWaveformHoverPoint } from "../../math/hoverMath";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { TimelineLatestEdgeHint } from "./TimelineLatestEdgeHint.jsx";

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
  return {
    startIndex,
    endIndex,
    startRow: histSourceList[startIndex] ?? null,
    endRow: histSourceList[endIndex] ?? null,
  };
}

export function drawWaveformCanvas(
  canvas,
  { mins, maxes, bucketCount, fracPhase, firstBucket, lastBucket, selected }
) {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;

  const style = getComputedStyle(document.documentElement);
  const zeroLineColor =
    style.getPropertyValue("--ui-loudness-grid").trim() || "rgba(128,128,128,0.18)";
  const strokeColor =
    (selected
      ? style.getPropertyValue("--ui-waveform-trace-snap").trim()
      : style.getPropertyValue("--ui-waveform-trace").trim()) || "#fb923c";
  const fillOpacity =
    parseFloat(style.getPropertyValue("--ui-waveform-fill-opacity").trim()) || 0.22;
  const strokeWidth = parseFloat(style.getPropertyValue("--ui-waveform-stroke-width").trim()) || 1;

  ctx.clearRect(0, 0, W, H);

  const cy = H / 2;
  ctx.strokeStyle = zeroLineColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, cy);
  ctx.lineTo(W, cy);
  ctx.stroke();

  if (firstBucket < 0 || !bucketCount || !mins?.length || !maxes?.length) return;

  const xFor = (j) => j - fracPhase; // one bucket per device pixel, sub-pixel phase
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
  // WAVEFORM_MAX_DEVICE_PIXEL_RATIO keeps the backing store 1:1 with CSS pixels, so the token
  // is the width in device pixels as-is. Scaling it by dpr again doubles the trace on HiDPI.
  ctx.lineWidth = strokeWidth;
  ctx.stroke();
}

export function WaveformPanel({ compact = false }) {
  const frameData = useFrameData();
  const historyData = useHistoryData();
  const { panelVisible } = usePanelInstanceData();
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

  return <WaveformPanelContent compact={compact} audioData={panelData} />;
}

function WaveformPanelContent({ compact, audioData }) {
  const {
    histSourceList,
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
      sliceWaveformSubHistory(
        waveformSourceList,
        visibleSamples ?? 0,
        effectiveOffsetSamples ?? 0,
        effectiveChannels,
        canvasW
      ),
    [
      waveformSourceList,
      visibleSamples,
      effectiveOffsetSamples,
      effectiveChannels,
      canvasW,
      waveformHistoryWindow.startIndex,
      waveformHistoryWindow.endIndex,
      waveformHistoryWindow.startRow,
      waveformHistoryWindow.endRow,
      waveformHistoryWindow.startRow?.timestampMs,
      waveformHistoryWindow.endRow?.timestampMs,
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
          />
        ))}

        <TimelineLatestEdgeHint
          active={(effectiveOffsetSamples ?? 0) > 0}
          className="left-[calc(var(--ui-chart-y-axis-rail-w)+var(--ui-chart-axis-gap))] w-auto"
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
            <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
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
        <div
          {...(historyTimeAxisHandlers ?? {})}
          style={{ cursor: historyTimeAxisHandlers ? "ew-resize" : undefined }}
          className={cn(
            CAPTION_TEXT,
            "relative h-full flex-1 transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
            historyTimeAxisActive && "text-foreground"
          )}
        >
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
  compact,
  selected,
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
    maxDevicePixelRatio: WAVEFORM_MAX_DEVICE_PIXEL_RATIO,
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
    };
    scheduleDraw();
  }, [mins, maxes, bucketCount, fracPhase, firstBucket, lastBucket, selected, scheduleDraw]);

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
