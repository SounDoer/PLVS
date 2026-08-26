import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";
import { useCanvasSize } from "../../hooks/useCanvasSize.js";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import {
  sliceWaveformSubHistory,
  sliceWaveformSubHistoryFromIndex,
} from "../../math/waveformMath.js";
import { useFrameData, useHistoryData } from "../../workspace/AudioDataContext.jsx";
import { DockHistoryWindowHud, dockHistoryInteractionProps } from "./DockHistoryInteraction.jsx";
import {
  centroidYFraction,
  parseCssRgb,
  sliceSpectralWaveformMetrics,
  waveformFrequencyRgb,
} from "../../math/spectralWaveformMath.js";
import {
  DEFAULT_WAVEFORM_CANVAS_COLORS,
  selectWaveformCanvasColors,
} from "../../theme/themeCanvasSelectors.js";
import { useResolvedTheme } from "../../theme/useResolvedTheme.js";

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

export function sliceDockWaveformHistory(
  histSourceList,
  waveformHistoryIndex,
  visibleSamples,
  channelCount,
  pixelWidth
) {
  return waveformHistoryIndex
    ? sliceWaveformSubHistoryFromIndex(
        histSourceList,
        waveformHistoryIndex,
        visibleSamples,
        0,
        channelCount,
        pixelWidth
      )
    : sliceWaveformSubHistory(histSourceList, visibleSamples, 0, channelCount, pixelWidth);
}

/** Paint all channel envelopes into one bounded canvas. */
export function paintDockWaveformCanvas(
  canvas,
  {
    mins,
    maxes,
    bucketCount,
    fracPhase,
    firstBucket,
    lastBucket,
    channelCount,
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
  if (!canvas || canvas.width <= 0 || canvas.height <= 0 || channelCount <= 0) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const width = canvas.width;
  const height = canvas.height;
  const style = getComputedStyle(canvas);
  const traceColor = themeColors.trace;
  const fillOpacity = cssNumber(style, "--ui-waveform-fill-opacity", 0.22);
  const strokeWidth = cssNumber(style, "--ui-waveform-stroke-width", 1);
  const spectralPalette = {
    low: parseCssRgb(themeColors.frequencyLow),
    mid: parseCssRgb(themeColors.frequencyMid),
    high: parseCssRgb(themeColors.frequencyHigh),
    neutral: parseCssRgb(themeColors.frequencyNeutral),
  };
  const centroidColor = themeColors.centroid;
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
    if (frequencyColor) {
      for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
        const next = Math.min(lastBucket, bucket + 1);
        const color = waveformFrequencyRgb(
          dominantFrequencyHz?.[channel]?.[bucket] ?? 0,
          tonality?.[channel]?.[bucket] ?? 0,
          { lowMidSplitHz, midHighSplitHz },
          spectralPalette
        );
        const colorCss = `rgb(${color.join(" ")})`;
        const x = xFor(bucket);
        const nextX = xFor(next) + (next === bucket ? 1 : 0);
        const yMax = centerY - Math.max(0, clampAmplitude(maxes[channel][bucket])) * halfHeight;
        const yMin = centerY - Math.min(0, clampAmplitude(mins[channel][bucket])) * halfHeight;
        const nextYMax = centerY - Math.max(0, clampAmplitude(maxes[channel][next])) * halfHeight;
        const nextYMin = centerY - Math.min(0, clampAmplitude(mins[channel][next])) * halfHeight;
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

    if (centroid && spectralCentroidHz?.[channel]?.length) {
      ctx.strokeStyle = centroidColor;
      ctx.lineWidth = 1;
      ctx.beginPath();
      let drawing = false;
      for (let bucket = firstBucket; bucket <= lastBucket; bucket += 1) {
        const yFraction = centroidYFraction(spectralCentroidHz[channel][bucket]);
        if (yFraction === null) {
          drawing = false;
          continue;
        }
        const x = xFor(bucket);
        const y = laneTop + yFraction * laneHeight;
        if (drawing) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
        drawing = true;
      }
      ctx.stroke();
    }
  }
}

/** Compact, latest-locked waveform with one labeled lane per available channel. */
export function DockWaveform({ controls }) {
  const themeColors = useResolvedTheme(selectWaveformCanvasColors);
  const frameData = useFrameData() ?? {};
  const {
    histSourceList = [],
    waveformHistoryIndex = null,
    visualWaveformHist = [],
  } = useHistoryData() ?? {};
  const canvasRef = useRef(null);
  const plotRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const latestRow =
    typeof histSourceList.rowAt === "function"
      ? histSourceList.rowAt(histSourceList.length - 1)
      : histSourceList[histSourceList.length - 1];
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
  const latestRowFallback = latestTimestampMs === null ? latestRow : null;

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

  const waveformView = useMemo(() => {
    // Rows without timestamps still need to invalidate the memo as the live ring advances.
    void latestRowFallback;
    void historyVersion;
    return {
      envelope: sliceDockWaveformHistory(
        histSourceList,
        waveformHistoryIndex,
        visibleSamples,
        channelCount,
        canvasSize.width
      ),
      newestVisibleTimestampMs: latestTimestampMs,
    };
  }, [
    histSourceList,
    waveformHistoryIndex,
    historyVersion,
    latestRowFallback,
    latestTimestampMs,
    visibleSamples,
    channelCount,
    canvasSize.width,
  ]);
  const { envelope } = waveformView;
  const spectralMetrics = useMemo(
    () =>
      sliceSpectralWaveformMetrics(
        visualWaveformHist,
        waveformView.newestVisibleTimestampMs - (visibleSamples - 1) * HIST_SAMPLE_SEC * 1000,
        waveformView.newestVisibleTimestampMs,
        envelope.bucketCount,
        channelCount,
        {
          newestVisibleTimestampMs: waveformView.newestVisibleTimestampMs,
          visibleSamples,
          pixelWidth: canvasSize.width,
          fracPhase: envelope.fracPhase,
          waveformRows: histSourceList,
          effectiveOffsetSamples: 0,
          nominalIntervalMs: HIST_SAMPLE_SEC * 1000,
        }
      ),
    [
      visualWaveformHist,
      waveformView.newestVisibleTimestampMs,
      envelope.bucketCount,
      envelope.fracPhase,
      visibleSamples,
      canvasSize.width,
      channelCount,
      histSourceList,
    ]
  );

  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      paintDockWaveformCanvas(canvasRef.current, {
        ...envelope,
        ...spectralMetrics,
        channelCount,
        frequencyColor: controls?.waveformFrequencyColor ?? false,
        lowMidSplitHz: controls?.waveformLowMidSplitHz ?? 200,
        midHighSplitHz: controls?.waveformMidHighSplitHz ?? 2000,
        centroid: controls?.waveformCentroid ?? false,
        themeColors,
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [
    envelope,
    spectralMetrics,
    channelCount,
    controls,
    canvasSize.height,
    frameData.resolvedThemeId,
    themeColors,
  ]);

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
