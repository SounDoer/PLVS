import { useRef, useEffect } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { CHART_INSET_MIN_H, PANEL_MIN_SPECTROGRAM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import { FREQ_LABELS, freqToXFrac } from "../../config/scales";
import { useSpectrogramCanvas } from "../../hooks/useSpectrogramCanvas";

function useCanvasSize(canvasRef, containerRef) {
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = container.clientWidth;
      canvas.height = container.clientHeight;
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [canvasRef, containerRef]);
}

export function SpectrogramPanel({ compact = false }) {
  const { spectrogramSnapRef: snapRef, effectiveOffsetSamples, visibleSamples, selectedOffset, setSelectedOffset, totalSamples } =
    useAudioData();
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  useCanvasSize(canvasRef, containerRef);

  const { handlePointerDown, handlePointerMove } = useSpectrogramCanvas({
    canvasRef,
    snapRef,
    effectiveOffsetSamples,
    visibleSamples,
    selectedOffset,
    setSelectedOffset,
    totalSamples,
  });

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
            "grid min-h-0 flex-1 grid-cols-[var(--ui-w-spectrum-y-axis)_minmax(0,1fr)] gap-x-[var(--ui-chart-axis-gap)] items-stretch",
            PANEL_MIN_SPECTROGRAM
          )}
        >
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
          <div className="relative min-h-0 min-w-0">
            <div
              ref={containerRef}
              className={cn("relative min-h-0 h-full rounded-lg bg-muted", CHART_INSET_MIN_H)}
            >
              <canvas
                ref={canvasRef}
                className="absolute inset-0 h-full w-full cursor-crosshair rounded-lg bg-muted"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
