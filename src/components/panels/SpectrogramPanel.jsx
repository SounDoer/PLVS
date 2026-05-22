import { useEffect, useRef, useMemo } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import {
  CAPTION_TEXT,
  CHART_INSET_MIN_H,
  PANEL_MIN_SPECTROGRAM,
  W_SPECTRUM_Y_AXIS,
} from "@/lib/shellLayout";
import { FREQ_LABELS, freqToXFrac } from "../../config/scales";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas";
import { useCanvasSize } from "../../hooks/useCanvasSize";
import { buildHistoryTimeAxisLabels, HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory";

export function SpectrogramPanel({ compact = false }) {
  const {
    spectrogramSnapRef: snapRef,
    effectiveOffsetSamples,
    visibleSamples,
    selectedOffset,
    setSelectedOffset,
    totalSamples,
    historyChartInteractive,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
  } = useAudioData();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  useCanvasSize(canvasRef, containerRef);

  const selectedHistSteps =
    selectedOffset >= 0 ? Math.max(0, Math.round(selectedOffset / HIST_SAMPLE_SEC)) : -1;
  const showSelLine =
    selectedOffset >= 0 &&
    totalSamples > 0 &&
    selectedHistSteps >= 0 &&
    selectedHistSteps < totalSamples;

  const reduceMotion = useReducedMotion();
  const selLineSvgX = useMemo(() => {
    if (selectedOffset < 0 || visibleSamples <= 0) return 0;
    const norm =
      (selectedOffset / HIST_SAMPLE_SEC - effectiveOffsetSamples) / Math.max(1, visibleSamples - 1);
    return (1 - Math.max(0, Math.min(1, norm))) * 1000;
  }, [selectedOffset, effectiveOffsetSamples, visibleSamples]);
  const selSpring = useSpring(selLineSvgX, {
    stiffness: reduceMotion ? 20000 : 540,
    damping: reduceMotion ? 200 : 46,
    mass: reduceMotion ? 0.06 : 0.28,
  });
  useEffect(() => {
    selSpring.set(selLineSvgX);
  }, [selLineSvgX, selSpring]);

  useSpectrogramCanvas({
    canvasRef,
    snapRef,
    effectiveOffsetSamples,
    visibleSamples,
    selectedOffset,
    totalSamples,
  });

  const spectrogramTimeTicks = useMemo(
    () =>
      buildHistoryTimeAxisLabels(
        effectiveOffsetSamples * HIST_SAMPLE_SEC,
        visibleSamples * HIST_SAMPLE_SEC
      ),
    [effectiveOffsetSamples, visibleSamples]
  );

  return (
    <div
      className={cn(
        PANEL_MIN_SPECTROGRAM,
        "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[var(--ui-w-spectrum-y-axis)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch",
            PANEL_MIN_SPECTROGRAM
          )}
        >
          {/* Y-axis frequency labels */}
          <div
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
              {FREQ_LABELS.map(([hz, label]) => (
                <span
                  key={hz}
                  className="absolute right-0 -translate-y-1/2 leading-none"
                  style={{ top: `${(1 - freqToXFrac(hz)) * 100}%` }}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>

          {/* Canvas chart */}
          <div className="relative min-h-0 min-w-0">
            <div
              ref={containerRef}
              className={cn("relative min-h-0 h-full rounded-lg bg-muted", CHART_INSET_MIN_H)}
            >
              <canvas
                ref={canvasRef}
                className={cn(
                  "absolute inset-0 h-full w-full rounded-lg bg-muted",
                  historyChartInteractive ? "cursor-crosshair" : "pointer-events-none"
                )}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={onHistoryPointerDown}
                onPointerMove={onHistoryPointerMove}
                onPointerUp={onHistoryPointerUp}
                onPointerCancel={onHistoryPointerUp}
                onWheel={onHistoryWheel}
                onDoubleClick={() => {
                  if (!historyChartInteractive) return;
                  setSelectedOffset(-1);
                }}
              />
              {selectedOffset >= 0 && showSelLine ? (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
                  <motion.line
                    x1={selSpring}
                    x2={selSpring}
                    y1={0}
                    y2={1000}
                    stroke="var(--ui-chart-selection)"
                    strokeWidth="var(--ui-lh-stroke-sel-w)"
                    strokeDasharray="5 4"
                    vectorEffect="non-scaling-stroke"
                  />
                </svg>
              ) : null}
            </div>
          </div>

          {/* X-axis: empty Y-axis column placeholder */}
          <div />

          {/* X-axis: time tick labels */}
          <div className={cn(CAPTION_TEXT, "relative h-[var(--ui-chart-x-axis-row-h)] w-full")}>
            <div className="absolute inset-x-[var(--ui-chart-pad)] top-0 h-full">
              {spectrogramTimeTicks.map((tick, i) => {
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
      </div>
    </div>
  );
}
