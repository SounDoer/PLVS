import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { useCanvasSize } from "../../hooks/useCanvasSize.js";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { sliceWaveformSubHistory } from "../../math/waveformMath.js";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { DockHistoryWindowHud, dockHistoryInteractionProps } from "./DockHistoryInteraction.jsx";

const MAX_DEVICE_PIXEL_RATIO = 1;
const MAX_AGGREGATION_STRIDE = 10;

function cssNumber(style, name, fallback) {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) ? value : fallback;
}

function clampAmplitude(value) {
  return Number.isFinite(value) ? Math.max(-1, Math.min(1, value)) : 0;
}

/**
 * Long windows move by much less than one pixel per history tick. Avoid rebuilding every bucket
 * for sub-pixel changes while keeping short windows at the full 10 Hz history cadence.
 */
export function dockWaveformAggregationStride(visibleRowCount, pixelWidth) {
  const rowsPerPixel = Math.max(1, visibleRowCount) / Math.max(1, pixelWidth);
  return Math.max(1, Math.min(MAX_AGGREGATION_STRIDE, Math.floor(rowsPerPixel / 2)));
}

/** Paint all channel envelopes into one bounded canvas. */
export function paintDockWaveformCanvas(
  canvas,
  { mins, maxes, bucketCount, fracPhase, firstBucket, lastBucket, channelCount }
) {
  if (!canvas || canvas.width <= 0 || canvas.height <= 0 || channelCount <= 0) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const style = getComputedStyle(canvas);
  const traceColor = style.getPropertyValue("--ui-waveform-trace").trim() || "#fb923c";
  const gridColor = style.getPropertyValue("--ui-loudness-grid").trim() || "rgba(128,128,128,0.18)";
  const fillOpacity = cssNumber(style, "--ui-waveform-fill-opacity", 0.22);
  const strokeWidth = cssNumber(style, "--ui-waveform-stroke-width", 1);
  // The backing store height now uses full DPR while width is capped, so it is no longer 1:1 with
  // CSS pixels. Convert the CSS-px row gap into backing pixels before laying out the lanes.
  const vScale = canvas.clientHeight > 0 ? height / canvas.clientHeight : 1;
  const rowGap = cssNumber(style, "--ui-dock-gap-row", 0) * vScale;
  const laneHeight = Math.max(0, (height - rowGap * Math.max(0, channelCount - 1)) / channelCount);

  ctx.clearRect(0, 0, width, height);

  for (let channel = 0; channel < channelCount; channel += 1) {
    const laneTop = channel * (laneHeight + rowGap);
    const centerY = laneTop + laneHeight / 2;
    const halfHeight = laneHeight / 2;

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY);
    ctx.lineTo(width, centerY);
    ctx.stroke();

    if (
      firstBucket < 0 ||
      firstBucket > lastBucket ||
      !bucketCount ||
      !mins?.[channel]?.length ||
      !maxes?.[channel]?.length
    ) {
      continue;
    }

    const xFor = (bucket) => bucket - fracPhase;
    ctx.beginPath();
    for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
      const x = xFor(bucket);
      const y = centerY - clampAmplitude(maxes[channel][bucket]) * halfHeight;
      if (bucket === firstBucket) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    for (let bucket = lastBucket; bucket >= firstBucket; bucket -= 1) {
      const x = xFor(bucket);
      const y = centerY - clampAmplitude(mins[channel][bucket]) * halfHeight;
      ctx.lineTo(x, y);
    }
    ctx.closePath();

    ctx.globalAlpha = fillOpacity;
    ctx.fillStyle = traceColor;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = traceColor;
    ctx.lineWidth = strokeWidth;
    ctx.stroke();
  }
}

/** Compact, latest-locked waveform with one labeled lane per available channel. */
export function DockWaveform({ controls }) {
  const frameData = useFrameData() ?? {};
  const { histSourceList = [] } = useHistoryData() ?? {};
  const canvasRef = useRef(null);
  const plotRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const latestRow = histSourceList[histSourceList.length - 1];
  const historyLength = histSourceList.length;
  const detectedChannelCount =
    frameData.channelCount ||
    frameData.displayAudio?.peakDb?.length ||
    latestRow?.waveformMin?.length ||
    latestRow?.waveformMax?.length ||
    2;
  const channelCount = Math.max(1, Math.floor(Number(detectedChannelCount) || 2));
  const labels = getPeakMeterChannelLabels(channelCount, frameData.peakLabelContext ?? {});
  const visibleSamples = Math.round((controls?.dockHistoryWindowSec ?? 60) / HIST_SAMPLE_SEC);
  const aggregationStride = dockWaveformAggregationStride(
    Math.min(historyLength, visibleSamples),
    canvasSize.width
  );
  const latestTimestampMs = Number.isFinite(latestRow?.timestampMs) ? latestRow.timestampMs : null;
  const historyVersion =
    latestTimestampMs === null
      ? historyLength
      : Math.floor(latestTimestampMs / (HIST_SAMPLE_SEC * 1000 * aggregationStride));

  const onCanvasResize = useCallback(({ width, height }) => {
    setCanvasSize((current) =>
      current.width === width && current.height === height ? current : { width, height }
    );
  }, []);
  useCanvasSize(canvasRef, plotRef, onCanvasResize, {
    // Width capped for decimation cost; height stays full DPR so the near-zero envelope keeps real
    // vertical resolution instead of flickering as a sub-pixel hairline (see WaveformPanel).
    maxDevicePixelRatioX: MAX_DEVICE_PIXEL_RATIO,
  });

  const envelope = useMemo(
    () =>
      sliceWaveformSubHistory(histSourceList, visibleSamples, 0, channelCount, canvasSize.width),
    [
      histSourceList,
      historyVersion,
      latestTimestampMs === null ? latestRow : null,
      visibleSamples,
      channelCount,
      canvasSize.width,
    ]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      paintDockWaveformCanvas(canvasRef.current, { ...envelope, channelCount });
    });
    return () => cancelAnimationFrame(frame);
  }, [envelope, channelCount, canvasSize.height, frameData.resolvedThemeId]);

  return (
    <div
      {...dockHistoryInteractionProps(controls)}
      className="relative flex h-full min-w-0 items-stretch"
      style={{
        columnGap: "var(--ui-dock-gap-column)",
        padding: "var(--ui-dock-pad-y) var(--ui-dock-pad-x)",
      }}
    >
      <div
        data-testid="dock-waveform-labels"
        className="grid min-h-0 shrink-0"
        style={{
          gridTemplateRows: `repeat(${channelCount}, minmax(0, 1fr))`,
          rowGap: "var(--ui-dock-gap-row)",
        }}
      >
        {labels.map((label, channel) => (
          <span
            key={`${channel}-${label}`}
            className="self-center whitespace-nowrap text-right font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-dock-fs-label)] font-medium leading-none text-muted-foreground"
          >
            {label}
          </span>
        ))}
      </div>
      <div ref={plotRef} className="relative min-h-0 min-w-0 flex-1">
        <canvas
          ref={canvasRef}
          data-testid="dock-waveform-canvas"
          className="absolute inset-0 h-full w-full"
          aria-hidden="true"
        />
        <DockHistoryWindowHud controls={controls} />
      </div>
    </div>
  );
}
