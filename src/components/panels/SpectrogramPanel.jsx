import { useRef, useMemo } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTROGRAM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import { FREQ_LABELS, freqToXFrac } from "../../config/scales";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas";
import { useCanvasSize } from "../../hooks/useCanvasSize";
import { HISTORY_TIME_TICK_STEPS } from "../../math/historyMath";
import { mapHistoryViewportToVisual } from "../../math/spectrogramViewportMath";
import { HelpPopover } from "../HelpPopover";
import { useChartHover } from "../../hooks/useChartHover";
import { computeSpectrogramHoverPoint } from "../../math/hoverMath";
import { VISUAL_HIST_SAMPLE_SEC } from "../../hooks/useLoudnessHistory.js";

const SPECTROGRAM_HELP = [
  "Left click - Select snapshot",
  "Left drag - Scrub timeline",
  "Left double-click - Return to live",
  "Right drag - Pan timeline",
  "Right double-click - Reset window and offset",
  "Mouse wheel - Wheel up/down to zoom in/out",
];

export function SpectrogramPanel({ compact = false }) {
  const {
    spectrogramSnapRef: snapRef,
    frequencyMarkerRef,
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
    visualSpectrogramSnap,
    historyTimeTicks,
  } = useAudioData();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  useCanvasSize(canvasRef, containerRef);

  const selLineSvgX = (selLineX / 600) * 1000;

  const markers = frequencyMarkerRef?.current ?? [];
  let visibleFrequencyMarkers = [];
  if (markers.length && visibleSamples > 0 && totalSamples > 0) {
    const newestVisible = totalSamples - 1 - effectiveOffsetSamples;
    const oldestVisible = newestVisible - visibleSamples + 1;
    visibleFrequencyMarkers = markers
      .map((marker, idx) => ({ marker, idx }))
      .filter(({ marker, idx }) => marker && idx >= oldestVisible && idx <= newestVisible)
      .map(({ marker, idx }) => ({
        marker,
        x: ((idx - oldestVisible) / Math.max(1, visibleSamples - 1)) * 1000,
      }));
  }

  const spectrogramSnaps =
    selectedOffset >= 0 ? (visualSpectrogramSnap ?? []) : (snapRef.current ?? []);
  const visualViewport = useMemo(
    () =>
      mapHistoryViewportToVisual({
        historyEntries: histSourceList ?? [],
        visualEntries: spectrogramSnaps,
        totalHistorySamples: totalSamples,
        totalVisualSamples: spectrogramSnaps.length,
        effectiveOffsetSamples,
        visibleSamples,
      }),
    [effectiveOffsetSamples, histSourceList, spectrogramSnaps, totalSamples, visibleSamples]
  );
  useSpectrogramCanvas({
    canvasRef,
    snapRef,
    effectiveOffsetSamples: visualViewport.effectiveOffsetSamples,
    visibleSamples: visualViewport.visibleSamples,
    selectedOffset,
    frozenSnaps: selectedOffset >= 0 ? spectrogramSnaps : null,
  });
  const {
    hover: spectrogramHover,
    onMove: onSpectrogramHoverMove,
    onLeave: onSpectrogramHoverLeave,
  } = useChartHover((xFrac, yFrac) =>
    historyChartInteractive
      ? computeSpectrogramHoverPoint(
          xFrac,
          yFrac,
          spectrogramSnaps,
          visualViewport.effectiveOffsetSamples,
          visualViewport.visibleSamples,
          VISUAL_HIST_SAMPLE_SEC
        )
      : null
  );

  return (
    <div
      className={cn(
        PANEL_MIN_SPECTROGRAM,
        "relative flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="pointer-events-none absolute right-[var(--ui-panel-pad-x)] top-[var(--ui-panel-pad-y)] z-10">
        <div className="pointer-events-auto">
          <HelpPopover items={SPECTROGRAM_HELP} />
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[var(--ui-w-spectrum-y-axis)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch"
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
            <div ref={containerRef} className="relative min-h-0 h-full rounded-lg bg-muted">
              <canvas
                ref={canvasRef}
                className={cn(
                  "absolute inset-0 h-full w-full rounded-lg bg-muted",
                  historyChartInteractive ? "cursor-crosshair" : "pointer-events-none"
                )}
                onContextMenu={(e) => e.preventDefault()}
                onPointerDown={onHistoryPointerDown}
                onPointerMove={(e) => {
                  onHistoryPointerMove(e);
                  onSpectrogramHoverMove(
                    e.clientX,
                    e.clientY,
                    e.currentTarget.getBoundingClientRect()
                  );
                }}
                onPointerLeave={onSpectrogramHoverLeave}
                onPointerUp={onHistoryPointerUp}
                onPointerCancel={onHistoryPointerUp}
                onWheel={onHistoryWheel}
                onDoubleClick={() => {
                  if (!historyChartInteractive) return;
                  setSelectedOffset(-1);
                }}
              />
              {(selectedOffset >= 0 && showSelLine) || visibleFrequencyMarkers.length > 0 ? (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="pointer-events-none absolute inset-0 h-full w-full"
                >
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
                      stroke="var(--ui-chart-selection)"
                      strokeWidth="var(--ui-lh-stroke-sel-w)"
                      strokeDasharray="5 4"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null}
                </svg>
              ) : null}
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
                  </div>
                </div>
              )}
            </div>
          </div>

          <div />
          <div className={cn(CAPTION_TEXT, "relative h-[var(--ui-chart-x-axis-row-h)] w-full")}>
            <div className="absolute inset-0">
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
      </div>
    </div>
  );
}
