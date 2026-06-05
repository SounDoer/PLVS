import { useRef, useEffect, useState } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { PANEL_MIN_WAVEFORM } from "@/lib/shellLayout";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { sliceWaveformHistory } from "../../math/waveformMath.js";

const LABEL_WIDTH_PX = 28;

export function WaveformPanel({ compact = false }) {
  const { histSourceList, visibleSamples, effectiveOffsetSamples, channelCount, peakLabelContext } =
    useAudioData();

  // Match idle fallback used by other multi-channel panels
  const effectiveChannels = channelCount >= 2 ? channelCount : Math.max(1, channelCount || 2);
  const labels = getPeakMeterChannelLabels(effectiveChannels, peakLabelContext ?? {});
  const { mins, maxes, entryCount } = sliceWaveformHistory(
    histSourceList ?? [],
    visibleSamples ?? 0,
    effectiveOffsetSamples ?? 0,
    effectiveChannels
  );

  return (
    <div
      className={cn(
        PANEL_MIN_WAVEFORM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden gap-0.5",
        "py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
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
    </div>
  );
}

function WaveformLane({ label, mins, maxes, entryCount, compact }) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  // canvasSize triggers redraw when the container is resized
  const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });

  // Resize observer — updates canvas buffer dimensions and triggers redraw via state
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

  // Draw — re-runs when data changes or when canvas is resized
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasSize.w === 0 || canvasSize.h === 0) return;

    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;

    ctx.clearRect(0, 0, W, H);

    // Subtle center baseline (silence line)
    const cy = H / 2;
    ctx.strokeStyle = "rgba(128,128,128,0.18)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy);
    ctx.lineTo(W, cy);
    ctx.stroke();

    if (!entryCount || !mins?.length) return;

    // Build filled waveform shape:
    //   top edge traces waveformMax (positive peaks → above center)
    //   bottom edge traces waveformMin (negative troughs → below center)
    ctx.beginPath();
    for (let i = 0; i < entryCount; i++) {
      const x = entryCount === 1 ? W : (i / (entryCount - 1)) * W;
      const y = cy - maxes[i] * cy; // cy maps amplitude 1.0 to the top
      if (i === 0) ctx.moveTo(entryCount === 1 ? 0 : x, y);
      else ctx.lineTo(x, y);
    }
    for (let i = entryCount - 1; i >= 0; i--) {
      const x = entryCount === 1 ? 0 : (i / (entryCount - 1)) * W;
      const y = cy - mins[i] * cy;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    // Read primary color from CSS variable (supports light/dark themes)
    const primaryHsl = getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim();
    ctx.fillStyle = primaryHsl ? `hsl(${primaryHsl} / 0.6)` : "rgba(99,179,237,0.6)";
    ctx.fill();
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
