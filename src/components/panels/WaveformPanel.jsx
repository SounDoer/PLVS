import { useRef, useEffect, useState } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_WAVEFORM } from "@/lib/shellLayout";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { sliceWaveformHistory } from "../../math/waveformMath.js";
import { useChartHover } from "../../hooks/useChartHover";
import { computeWaveformHoverPoint } from "../../math/hoverMath";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { HelpPopover } from "../HelpPopover";

const WAVEFORM_HELP = [
  "Left click - Select snapshot",
  "Left drag - Scrub timeline",
  "Left double-click - Return to live",
  "Right drag - Pan timeline",
  "Right double-click - Reset window and offset",
  "Mouse wheel - Wheel up/down to zoom in/out",
];

const LABEL_WIDTH_PX = 28;

export function WaveformPanel({ compact = false }) {
  const {
    histSourceList,
    visibleSamples,
    effectiveOffsetSamples,
    channelCount,
    peakLabelContext,
    historyTimeTicks,
    historyChartInteractive,
    selectedOffset,
    selLineX,
    showSelLine,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
    setSelectedOffset,
    running,
    setStatus,
    holdHistoryHud,
    showHistoryHud,
  } = useAudioData();

  const effectiveChannels = channelCount >= 2 ? channelCount : Math.max(1, channelCount || 2);
  const labelContext =
    channelCount > 0
      ? (peakLabelContext ?? {})
      : { ...(peakLabelContext ?? {}), resolvedLayout: "stereo" };
  const labels = getPeakMeterChannelLabels(effectiveChannels, labelContext);
  const { mins, maxes, entryCount } = sliceWaveformHistory(
    histSourceList ?? [],
    visibleSamples ?? 0,
    effectiveOffsetSamples ?? 0,
    effectiveChannels
  );

  const {
    hover: waveformHover,
    onMove: onWaveformHoverMove,
    onLeave: onWaveformHoverLeave,
  } = useChartHover((xFrac) =>
    historyChartInteractive
      ? computeWaveformHoverPoint(
          xFrac,
          mins,
          maxes,
          entryCount,
          effectiveOffsetSamples ?? 0,
          visibleSamples ?? 0,
          HIST_SAMPLE_SEC,
          labels
        )
      : null
  );

  return (
    <div
      className={cn(
        PANEL_MIN_WAVEFORM,
        "@container relative flex min-h-0 flex-1 flex-col overflow-hidden",
        "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="pointer-events-none absolute right-[var(--ui-panel-pad-x)] top-[var(--ui-panel-pad-y)] z-10">
        <div className="pointer-events-auto">
          <HelpPopover items={WAVEFORM_HELP} />
        </div>
      </div>
      {/* Channel lanes + interaction overlay */}
      <div className="relative isolate flex min-h-0 flex-1 flex-col gap-0.5">
        {Array.from({ length: effectiveChannels }, (_, ch) => (
          <WaveformLane
            key={ch}
            label={labels[ch] ?? `Ch${ch + 1}`}
            mins={mins[ch]}
            maxes={maxes[ch]}
            entryCount={entryCount}
            compact={compact}
          />
        ))}

        {/* Hover crosshair + popover — pointer-events-none so interaction overlay stays active */}
        {waveformHover && (
          <div
            className="pointer-events-none absolute inset-0 z-[25]"
            style={{ left: LABEL_WIDTH_PX }}
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

        {/* Selection line — aligned with canvas area, not the label column */}
        {selectedOffset >= 0 && showSelLine && (
          <div
            className="pointer-events-none absolute inset-0 z-20"
            style={{ left: LABEL_WIDTH_PX }}
          >
            <svg viewBox="0 0 600 1" preserveAspectRatio="none" className="h-full w-full">
              <line
                x1={selLineX}
                x2={selLineX}
                y1={0}
                y2={1}
                stroke="var(--ui-chart-selection)"
                strokeWidth="var(--ui-lh-stroke-sel-w)"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
          </div>
        )}

        {/* Interaction overlay — covers canvas area only so pointer x maps correctly */}
        <div
          className="absolute inset-0 z-30"
          style={{
            left: LABEL_WIDTH_PX,
            cursor: historyChartInteractive ? "crosshair" : "default",
            pointerEvents: historyChartInteractive ? "auto" : "none",
          }}
          onContextMenu={(e) => e.preventDefault()}
          onDoubleClick={() => {
            if (!historyChartInteractive) return;
            setSelectedOffset(-1);
            if (running) setStatus("Monitoring live input");
            holdHistoryHud(false);
            showHistoryHud(1200);
          }}
          onWheel={onHistoryWheel}
          onPointerDown={onHistoryPointerDown}
          onPointerMove={(e) => {
            onHistoryPointerMove(e);
            onWaveformHoverMove(e.clientX, e.clientY, e.currentTarget.getBoundingClientRect());
          }}
          onPointerLeave={onWaveformHoverLeave}
          onPointerUp={onHistoryPointerUp}
          onPointerCancel={onHistoryPointerUp}
        />
      </div>

      <div className="flex h-[var(--ui-chart-x-axis-row-h)] shrink-0 items-start">
        <div className="shrink-0" style={{ width: LABEL_WIDTH_PX }} />
        <div className={cn(CAPTION_TEXT, "relative h-full flex-1")}>
          {(historyTimeTicks ?? []).map((tick, i) => {
            if (i === 0) {
              return (
                <span key={`${i}-${tick}`} className="absolute left-0 top-0 text-left">
                  {tick}
                </span>
              );
            }
            if (i === HISTORY_TIME_TICK_STEPS) {
              return (
                <span key={`${i}-${tick}`} className="absolute right-0 top-0 text-right">
                  {tick}
                </span>
              );
            }
            return (
              <span
                key={`${i}-${tick}`}
                className="absolute top-0 -translate-x-1/2 text-center"
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

function WaveformLane({ label, mins, maxes, entryCount, compact }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const dpr = window.devicePixelRatio || 1;
      const w = Math.round(container.clientWidth * dpr);
      const h = Math.round(container.clientHeight * dpr);
      canvas.width = w;
      canvas.height = h;
      setCanvasSize({ w, h });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w === 0 || canvasSize.h === 0) return;

    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    const style = getComputedStyle(document.documentElement);
    const zeroLineColor =
      style.getPropertyValue("--ui-loudness-history-grid-line").trim() || "rgba(128,128,128,0.18)";
    const strokeColor = style.getPropertyValue("--ui-chart-waveform-live").trim() || "#fb923c";
    const fillOpacity =
      parseFloat(style.getPropertyValue("--ui-chart-waveform-fill-opacity").trim()) || 0.22;

    ctx.clearRect(0, 0, W, H);

    const cy = H / 2;
    ctx.strokeStyle = zeroLineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.stroke();

    if (!entryCount || !mins?.length) return;

    // Build envelope path
    ctx.beginPath();
    for (let i = 0; i < entryCount; i++) {
      const x = entryCount === 1 ? W : (i / (entryCount - 1)) * W;
      const y = cy - maxes[i] * cy;
      if (i === 0) {
        ctx.moveTo(0, y);
        if (entryCount === 1) ctx.lineTo(W, y);
      } else {
        ctx.lineTo(x, y);
      }
    }
    for (let i = entryCount - 1; i >= 0; i--) {
      const x = entryCount === 1 ? 0 : (i / (entryCount - 1)) * W;
      const y = cy - mins[i] * cy;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Fill
    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = strokeColor;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Stroke the envelope outline once (same closed path)
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = window.devicePixelRatio || 1;
    ctx.stroke();
  }, [mins, maxes, entryCount, canvasSize]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 items-stretch">
      <div
        className="flex shrink-0 items-center justify-end pr-1 text-[length:var(--ui-fs-axis)] text-muted-foreground"
        style={{ width: LABEL_WIDTH_PX }}
      >
        {compact ? null : label}
      </div>
      <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1 rounded bg-muted">
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full rounded" />
      </div>
    </div>
  );
}
