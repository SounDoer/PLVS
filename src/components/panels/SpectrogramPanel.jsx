import { useRef, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import {
  CHART_INSET_MIN_H,
  PANEL_MIN_SPECTROGRAM,
  W_SPECTRUM_Y_AXIS,
} from "@/lib/shellLayout";
import { FREQ_LABELS, freqToXFrac } from "../../scales";
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

export function SpectrogramPanel({
  snapRef,
  effectiveOffsetSamples,
  visibleSamples,
  selectedOffset,
  setSelectedOffset,
  totalSamples,
}) {
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
    <Card
      className={cn(
        PANEL_MIN_SPECTROGRAM,
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-card)] border-border/80 bg-card/55 py-[var(--ui-article-pad-y)] pl-[var(--ui-article-pad-x)] pr-[var(--ui-article-pad-x)] text-card-foreground shadow-sm backdrop-blur-md"
      )}
    >
      <CardHeader className="flex min-w-0 flex-row items-center justify-between gap-2 space-y-0 p-0 pb-0">
        <CardTitle className="min-w-0 truncate text-[length:var(--ui-fs-section)] font-semibold text-muted-foreground">
          Spectrogram
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0 pt-[var(--ui-section-title-gap)]">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[var(--ui-w-spectrum-y-axis)_minmax(0,1fr)] gap-x-[var(--ui-axis-gap-y)] items-stretch",
            PANEL_MIN_SPECTROGRAM
          )}
        >
          <div
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis-value)] text-muted-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-[var(--ui-spectrum-display-top-inset)] bottom-[var(--ui-spectrum-display-bottom-inset)]">
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
                className="absolute inset-0 h-full w-full cursor-crosshair rounded-lg"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
