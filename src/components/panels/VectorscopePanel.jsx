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

const CORRELATION_SIGNAL_FLOOR_DB = -90;

function clampCorrelation(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

function correlationMarkerLeft(value) {
  const corr = clampCorrelation(value);
  if (corr === null) return "50%";
  return `${((corr + 1) / 2) * 100}%`;
}

function hasPairSignal(peakDb, x, y) {
  if (!Array.isArray(peakDb)) return false;
  const lx = Number.isFinite(peakDb[x]) ? peakDb[x] : -Infinity;
  const ly = Number.isFinite(peakDb[y]) ? peakDb[y] : -Infinity;
  return Math.max(lx, ly) > CORRELATION_SIGNAL_FLOOR_DB;
}

function correlationMarkerClass(value) {
  const corr = clampCorrelation(value);
  if (corr === null) return "bg-[color:var(--muted-foreground)]";
  if (corr < 0) return "bg-[color:var(--ui-signal-bad)]";
  if (corr < 0.35) return "bg-[color:var(--ui-signal-warn)]";
  return "bg-[color:var(--ui-signal-good)]";
}

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
  const hasCorrelationSignal = isSnapshot
    ? snapResolved?.hasSignal === true
    : hasPairSignal(displayAudio?.peakDb, px, py);
  const canPlaceCorrelationMarker =
    hasCorrelationSignal && clampCorrelation(panelCorrelation) !== null;
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
          className="relative w-full"
          style={{ aspectRatio: "1/1", maxHeight: "100%", maxWidth: "100%" }}
        >
          <div className="absolute inset-[var(--ui-vector-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
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
      <div
        data-vectorscope-correlation-rail
        className="mt-[var(--ui-chart-axis-gap)] h-[var(--ui-chart-x-axis-row-h)] shrink-0 px-[calc(var(--ui-vector-corner-inset)*0.5)]"
      >
        <div
          className={cn(
            "relative h-full w-full",
            hasCorrelationSignal ? "opacity-100" : "opacity-30"
          )}
          aria-hidden
        >
          <div className="absolute inset-x-0 bottom-0 h-2.5">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-[color:color-mix(in_srgb,var(--muted-foreground)_25%,transparent)]" />
            <div className="absolute left-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
            <div className="absolute right-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
          </div>
          {canPlaceCorrelationMarker && (
            <div
              data-vectorscope-correlation-marker
              className={cn(
                "absolute bottom-0 h-3 w-0.5 -translate-x-1/2 rounded-full",
                !isSnapshot && "transition-[left] duration-100 ease-out",
                correlationMarkerClass(panelCorrelation)
              )}
              style={{ left: correlationMarkerLeft(panelCorrelation) }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
