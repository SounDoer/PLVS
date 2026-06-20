import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { vectorscopeRequestKeyFromControls } from "../../analysis/analysisRequests.js";
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
    displayAudio,
    panelControls,
  } = useAudioData();
  const liveVectorscopeKey = vectorscopeRequestKeyFromControls(panelControls);
  const liveVectorscopeResult =
    selectedOffset < 0 ? displayAudio?.vectorscopeResultsByKey?.[liveVectorscopeKey] : null;
  const panelVectorPath = liveVectorscopeResult?.path ?? displayVectorPath;
  const panelCorrelation = liveVectorscopeResult?.correlation ?? correlation;
  const panelPairX = liveVectorscopeResult?.pairX ?? pairX;
  const panelPairY = liveVectorscopeResult?.pairY ?? pairY;
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const stripLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const px = Number.isFinite(panelPairX) ? Math.max(0, Math.floor(Number(panelPairX))) : 0;
  const py = Number.isFinite(panelPairY) ? Math.max(0, Math.floor(Number(panelPairY))) : 1;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  return (
    <div
      className={cn(
        PANEL_MIN_SPECTRUM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0">
        <div
          className="relative w-full rounded-lg bg-muted"
          style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
        >
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
                stroke="var(--ui-vectorscope-grid-stroke)"
                strokeWidth="0.35"
                strokeDasharray="var(--ui-vectorscope-grid-dash)"
                vectorEffect="non-scaling-stroke"
              />
              <line
                x1={vsGridDiagFar}
                y1={vsGridDiagInset}
                x2={vsGridDiagInset}
                y2={vsGridDiagFar}
                stroke="var(--ui-vectorscope-grid-stroke)"
                strokeWidth="0.35"
                strokeDasharray="var(--ui-vectorscope-grid-dash)"
                vectorEffect="non-scaling-stroke"
              />
            </svg>
            <svg
              viewBox="0 0 260 260"
              preserveAspectRatio="none"
              className="absolute inset-0 z-[1] block h-full w-full"
            >
              {panelVectorPath && (
                <>
                  <path
                    d={panelVectorPath}
                    fill="none"
                    stroke={
                      selectedOffset >= 0
                        ? "var(--ui-vectorscope-trace-snap)"
                        : "var(--ui-vectorscope-trace)"
                    }
                    strokeWidth="var(--ui-vectorscope-stroke-width)"
                    opacity="var(--ui-vectorscope-axis-opacity)"
                    strokeLinecap="round"
                  />
                  <circle
                    cx="130"
                    cy="130"
                    r="2"
                    fill={
                      selectedOffset >= 0
                        ? "var(--ui-vectorscope-trace-snap)"
                        : "var(--ui-vectorscope-trace)"
                    }
                  />
                </>
              )}
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
      </div>
      <div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-center text-[length:var(--ui-fs-display)]">
        <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
          <span className="text-muted-foreground">Correlation</span>
          <span
            className={
              Number.isFinite(panelCorrelation)
                ? "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-[color:var(--ui-signal-tp-max)]"
                : "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-muted-foreground"
            }
          >
            {Number.isFinite(panelCorrelation) ? panelCorrelation.toFixed(2) : "-"}
          </span>
        </div>
      </div>
    </div>
  );
}
