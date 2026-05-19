import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM } from "@/lib/shellLayout";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";

export function VectorscopePanel() {
  const {
    vsGridDiagInset,
    vsGridDiagFar,
    displayVectorPath,
    selectedOffset,
    correlation,
    channelCount = 0,
    peakLabelContext,
    vectorscopePairX: pairX = 0,
    vectorscopePairY: pairY = 1,
  } = useAudioData();
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const stripLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const px = Number.isFinite(pairX) ? Math.max(0, Math.floor(Number(pairX))) : 0;
  const py = Number.isFinite(pairY) ? Math.max(0, Math.floor(Number(pairY))) : 1;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  return (
    <div
      className={cn(
        PANEL_MIN_SPECTRUM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="relative min-h-0 flex-1 rounded-lg bg-muted">
          <div className="absolute inset-[var(--ui-chart-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
            <svg
              className="pointer-events-none absolute inset-0 z-0 block h-full w-full"
              viewBox="0 0 100 100"
              preserveAspectRatio="none"
              aria-hidden
            >
              <line
                x1={vsGridDiagInset}
                y1={vsGridDiagInset}
                x2={vsGridDiagFar}
                y2={vsGridDiagFar}
                stroke="var(--ui-vs-grid-diag-stroke)"
                strokeWidth="0.35"
                strokeDasharray="var(--ui-vs-grid-diag-dash)"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={vsGridDiagFar}
                y1={vsGridDiagInset}
                x2={vsGridDiagInset}
                y2={vsGridDiagFar}
                stroke="var(--ui-vs-grid-diag-stroke)"
                strokeWidth="0.35"
                strokeDasharray="var(--ui-vs-grid-diag-dash)"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <svg
              viewBox="0 0 260 260"
              preserveAspectRatio="none"
              className="absolute inset-0 z-[1] block h-full w-full"
            >
              <path
                d={displayVectorPath || "M 130 130 L 130 130"}
                fill="none"
                stroke={
                  selectedOffset >= 0
                    ? "var(--ui-chart-vectorscope-snap)"
                    : "var(--ui-chart-vectorscope-live)"
                }
                strokeWidth="var(--ui-vs-stroke-w-halo)"
                opacity="var(--ui-vs-path-glow-opacity)"
                strokeLinecap="round"
              />
              <path
                d={displayVectorPath || "M 130 130 L 130 130"}
                fill="none"
                stroke={
                  selectedOffset >= 0
                    ? "var(--ui-chart-vectorscope-snap)"
                    : "var(--ui-chart-vectorscope-live)"
                }
                strokeWidth="var(--ui-vs-stroke-w)"
                opacity="var(--ui-vs-axis-op)"
                strokeLinecap="round"
              />
              <circle
                cx="130"
                cy="130"
                r="2"
                fill={
                  selectedOffset >= 0
                    ? "var(--ui-chart-vectorscope-snap)"
                    : "var(--ui-chart-vectorscope-live)"
                }
              />
            </svg>
          </div>
          <span
            className={cn(
              CAPTION_TEXT,
              "absolute left-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]"
            )}
          >
            {axisXLabel}
          </span>
          <span
            className={cn(
              CAPTION_TEXT,
              "absolute right-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]"
            )}
          >
            {axisYLabel}
          </span>
        </div>
        <div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-display)]">
          <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
            <span className="text-muted-foreground">CORRELATION</span>
            <span
              className={
                Number.isFinite(correlation)
                  ? "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-[color:var(--ui-signal-tp-max)]"
                  : "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-muted-foreground"
              }
            >
              {Number.isFinite(correlation) ? correlation.toFixed(2) : "-"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
