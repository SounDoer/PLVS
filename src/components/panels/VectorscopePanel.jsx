import { cn } from "@/lib/utils";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import { ANNOTATION_TEXT, CAPTION_TEXT, PANEL_MIN_SPECTRUM } from "@/lib/shellLayout";
import { VectorscopeLissajousGrid } from "./VectorscopeLissajousGrid.jsx";
import { VectorscopePolarPlot, VectorscopePolarStage } from "./VectorscopePolarPlot.jsx";
import { SnapshotEmptyState, SNAPSHOT_NO_DATA_MESSAGE } from "./SnapshotEmptyState.jsx";
import { useVectorscopeDisplay } from "./useVectorscopeDisplay.js";
function clampCorrelation(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(-1, Math.min(1, value));
}

function correlationMarkerLeft(value) {
  const corr = clampCorrelation(value);
  if (corr === null) return "50%";
  return `${((corr + 1) / 2) * 100}%`;
}

function correlationMarkerClass(value) {
  const corr = clampCorrelation(value);
  if (corr === null) return "bg-[color:var(--muted-foreground)]";
  if (corr < 0) return "bg-[color:var(--ui-vectorscope-correlation-critical)]";
  if (corr < 0.35) return "bg-[color:var(--ui-vectorscope-correlation-warning)]";
  return "bg-[color:var(--ui-vectorscope-correlation-safe)]";
}

/** @param {{ compact?: boolean, className?: string }} props */
export function VectorscopePanel({ compact = false, className } = {}) {
  const {
    snapshotMissing,
    isLissajous,
    canResetMaxHold,
    onTracePointerDown,
    onTracePointerMove,
    onTracePointerUp,
    setMaxHoldResetKey,
    axisXLabel,
    axisYLabel,
    persistenceActive,
    panelVectorPath,
    selectedOffset,
    persistenceCanvasRef,
    vectorscopeMode,
    polarRows,
    isSnapshot,
    snapResolved,
    liveVectorscopeResult,
    normalizedPanelControls,
    maxHoldResetKey,
    vectorscopeResetEpoch,
    vectorscopeKey,
    px,
    py,
    vectorscopeColors,
    panelActive,
    displayCorrelation,
  } = useVectorscopeDisplay();
  if (snapshotMissing) {
    return (
      <div
        className={cn(
          !compact && PANEL_MIN_SPECTRUM,
          "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
          className
        )}
      >
        <SnapshotEmptyState message={SNAPSHOT_NO_DATA_MESSAGE} />
      </div>
    );
  }
  return (
    <div
      className={cn(
        !compact && PANEL_MIN_SPECTRUM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
        className
      )}
    >
      <div
        data-vectorscope-plot-stage
        className={cn(
          "flex min-h-0 flex-1 flex-col items-center gap-0 [container-type:size]",
          isLissajous ? "justify-start" : "justify-end"
        )}
      >
        <div
          data-vectorscope-plot
          data-max-hold-reset={canResetMaxHold ? "true" : undefined}
          className={cn("relative shrink-0", canResetMaxHold && "cursor-pointer")}
          style={{ aspectRatio: "1/1", width: "min(100cqw, 100cqh)" }}
          onPointerDown={onTracePointerDown}
          onPointerMove={onTracePointerMove}
          onPointerUp={onTracePointerUp}
          onPointerCancel={onTracePointerUp}
          onPointerLeave={onTracePointerUp}
          onClick={canResetMaxHold ? () => setMaxHoldResetKey((k) => k + 1) : undefined}
        >
          <div className="absolute inset-[var(--ui-vector-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
            {isLissajous ? (
              <>
                <VectorscopeLissajousGrid
                  labelSize="var(--ui-fs-axis)"
                  labelGap="var(--ui-chart-axis-gap)"
                  labelClassName={ANNOTATION_TEXT}
                  firstLabel={axisXLabel}
                  secondLabel={axisYLabel}
                  gridProps={{ "data-vectorscope-lissajous-grid": true }}
                  labelProps={{ "data-vectorscope-pair-labels": true }}
                />
                <svg
                  viewBox="0 0 260 260"
                  preserveAspectRatio="none"
                  className="absolute inset-0 z-[1] block h-full w-full"
                >
                  {!persistenceActive && panelVectorPath && (
                    <path
                      d={panelVectorPath}
                      fill="none"
                      stroke={
                        selectedOffset >= 0
                          ? "var(--ui-vectorscope-trace-snap)"
                          : "var(--ui-vectorscope-trace)"
                      }
                      strokeWidth="var(--ui-vectorscope-stroke-width)"
                      vectorEffect="non-scaling-stroke"
                      strokeLinecap="round"
                    />
                  )}
                </svg>
              </>
            ) : null}
            {persistenceActive && (
              <canvas
                ref={persistenceCanvasRef}
                data-vectorscope-persistence
                className="pointer-events-none absolute inset-0 z-[1] block h-full w-full"
                aria-hidden
              />
            )}
            {!isLissajous ? (
              <VectorscopePolarStage
                labelSize="var(--ui-fs-axis)"
                labelGap="var(--ui-chart-axis-gap)"
                labelClassName={ANNOTATION_TEXT}
                firstLabel={axisXLabel}
                secondLabel={axisYLabel}
                stageProps={{ "data-vectorscope-polar-stage": true }}
                labelProps={{ "data-vectorscope-pair-labels": true }}
              >
                <VectorscopePolarPlot
                  mode={vectorscopeMode}
                  rows={polarRows}
                  snapshotPairs={isSnapshot ? snapResolved?.pairs : null}
                  snapshotMaxHold={isSnapshot ? snapResolved?.maxHold : null}
                  initialMaxHold={!isSnapshot ? liveVectorscopeResult?.initialMaxHold : null}
                  maxHoldEnabled={normalizedPanelControls.vectorscopePolarLevelMaxHold}
                  maxHoldResetKey={maxHoldResetKey}
                  persistenceMs={normalizedPanelControls.vectorscopePolarSamplePersistenceMs}
                  resetEpoch={vectorscopeResetEpoch}
                  identityKey={`${vectorscopeKey}:${px}:${py}`}
                  colors={vectorscopeColors}
                  enabled={panelActive}
                />
              </VectorscopePolarStage>
            ) : null}
          </div>
        </div>
      </div>
      <div data-vectorscope-correlation-rail className="mt-[var(--ui-chart-axis-gap)] h-3 shrink-0">
        <div className="relative h-full w-full" aria-hidden>
          <div className="absolute inset-x-0 top-1/2 h-2.5 -translate-y-1/2">
            <div className="absolute left-0 right-0 top-1/2 h-px -translate-y-1/2 rounded-full bg-[color:var(--ui-vectorscope-guides-stroke)]" />
            <div className="absolute left-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
            <div className="absolute left-1/2 top-1/2 h-0.5 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
            <div className="absolute right-0 top-1/2 h-1 w-1 -translate-y-1/2 rounded-full bg-[color:var(--muted-foreground)]" />
          </div>
          {displayCorrelation !== null && (
            <div
              data-vectorscope-correlation-marker
              className={cn(
                "absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full",
                !isSnapshot && "transition-[left,background-color] duration-100 ease-out",
                correlationMarkerClass(displayCorrelation)
              )}
              style={{ left: correlationMarkerLeft(displayCorrelation) }}
            />
          )}
        </div>
      </div>
      <div
        data-vectorscope-correlation-axis
        className={cn(
          CAPTION_TEXT,
          "mt-[var(--ui-chart-axis-gap)] h-[var(--ui-chart-x-axis-row-h)] w-full shrink-0"
        )}
      >
        <div className="relative h-full w-full" aria-hidden>
          <span className={axisLabelClass("x", "start")}>-1</span>
          <span className={axisLabelClass("x", "middle")} style={{ left: "50%" }}>
            0
          </span>
          <span className={axisLabelClass("x", "end")}>+1</span>
        </div>
      </div>
    </div>
  );
}
