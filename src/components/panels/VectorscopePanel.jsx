import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { vectorscopeRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM } from "@/lib/shellLayout";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import {
  SnapshotEmptyState,
  SNAPSHOT_NO_DATA_MESSAGE,
  ANALYSIS_OVER_CAP_MESSAGE,
} from "./SnapshotEmptyState.jsx";

export function VectorscopePanel() {
  const {
    vsGridDiagInset,
    vsGridDiagFar,
    selectedOffset,
    correlation,
    channelCount = 0,
    peakLabelContext,
    vectorscopePairX: pairX = 0,
    vectorscopePairY: pairY = 1,
    displayAudio,
    panelControls,
    resolveVectorscopeSnapshotForKey,
    analysisStatus,
  } = useAudioData();
  const vectorscopeKey = vectorscopeRequestKeyFromControls(panelControls);
  const isOverCap = analysisStatus === "overCap";
  const isSnapshot = selectedOffset >= 0;
  const snapResolved = isSnapshot ? resolveVectorscopeSnapshotForKey?.(vectorscopeKey) : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveVectorscopeResult = isSnapshot
    ? null
    : displayAudio?.vectorscopeResultsByKey?.[vectorscopeKey];
  // The panel's own pair (snapshot/pending fall back to its per-instance controls, not the global).
  const controlPair = normalizePanelControls(panelControls).vectorscopePair ?? {
    x: pairX,
    y: pairY,
  };
  let panelVectorPath;
  let panelCorrelation;
  let panelPairX;
  let panelPairY;
  if (isSnapshot) {
    panelVectorPath = snapResolved?.path ?? "";
    panelCorrelation = snapResolved?.correlation ?? correlation;
    panelPairX = controlPair.x;
    panelPairY = controlPair.y;
  } else if (liveVectorscopeResult) {
    panelVectorPath = liveVectorscopeResult.path;
    panelCorrelation = liveVectorscopeResult.correlation;
    panelPairX = liveVectorscopeResult.pairX;
    panelPairY = liveVectorscopeResult.pairY;
  } else {
    // Live but no per-key result yet: pending treatment (empty trace) until this request's first
    // frame arrives, rather than showing another request's trace.
    panelVectorPath = "";
    panelCorrelation = null;
    panelPairX = controlPair.x;
    panelPairY = controlPair.y;
  }
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const stripLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const px = Number.isFinite(panelPairX) ? Math.max(0, Math.floor(Number(panelPairX))) : 0;
  const py = Number.isFinite(panelPairY) ? Math.max(0, Math.floor(Number(panelPairY))) : 1;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  if (isOverCap || snapshotMissing) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <SnapshotEmptyState
          message={isOverCap ? ANALYSIS_OVER_CAP_MESSAGE : SNAPSHOT_NO_DATA_MESSAGE}
        />
      </div>
    );
  }
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
