import { usePanelPresentation } from "../../workspace/AudioDataContext.jsx";
import { VECTOR_CORRELATION_MIN_EM } from "../../lib/vectorscopeSizing.js";
import { cn } from "@/lib/utils";
import { AxisRail } from "./AxisRail.jsx";
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

/** @param {{ compact?: boolean, showAxes?: boolean, className?: string }} props */
export function VectorscopePanel({ compact = false, showAxes: axesOverride, className } = {}) {
  const { showAxes, fitContainer } = usePanelPresentation(axesOverride);
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
          !fitContainer && !compact && PANEL_MIN_SPECTRUM,
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
        !fitContainer && !compact && PANEL_MIN_SPECTRUM,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
        className
      )}
    >
      <div className="flex min-h-0 flex-1 items-center justify-center [container-type:size]">
        <div
          data-vectorscope-instrument
          className="flex shrink-0 flex-col"
          style={{
            // Reserve the correlation rail, its labels and gaps before fitting the plot.
            // Polar needs a separate pair-label strip; Lissajous labels sit inside its square.
            width: showAxes
              ? `min(100cqw, max(var(--vector-plot-width), calc(var(--ui-fs-axis) * ${VECTOR_CORRELATION_MIN_EM})))`
              : "var(--vector-plot-width)",
            "--vector-plot-width": !showAxes
              ? `min(100cqw, max(0px, calc(${isLissajous ? 1 : 2} * (100cqh - 0.75rem - var(--ui-chart-axis-gap)))))`
              : isLissajous
                ? "min(100cqw, max(0px, calc(100cqh - 0.75rem - var(--ui-chart-x-axis-row-h) - 2 * var(--ui-chart-axis-gap))))"
                : "min(100cqw, max(0px, calc(2 * (100cqh - 0.75rem - var(--ui-chart-x-axis-row-h) - var(--ui-fs-axis) - 3 * var(--ui-chart-axis-gap)))))",
          }}
        >
          <div
            data-vectorscope-plot-stage
            className="relative mx-auto box-content shrink-0"
            style={{
              width: "var(--vector-plot-width)",
              aspectRatio: isLissajous ? "1 / 1" : "2 / 1",
              paddingBottom:
                isLissajous || !showAxes ? 0 : "calc(var(--ui-fs-axis) + var(--ui-chart-axis-gap))",
            }}
          >
            <div
              data-vectorscope-plot
              data-max-hold-reset={canResetMaxHold ? "true" : undefined}
              className={cn("absolute inset-0", canResetMaxHold && "cursor-pointer")}
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
                      labelSize={showAxes ? "var(--ui-fs-axis)" : null}
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
                    labelSize={showAxes ? "var(--ui-fs-axis)" : null}
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
          <div
            data-vectorscope-correlation-rail
            className="mt-[var(--ui-chart-axis-gap)] h-3 shrink-0"
          >
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
          {showAxes && (
            <AxisRail
              axis="x"
              labelPolicy="fixed"
              ticks={[
                { key: -1, label: "-1", frac: 0 },
                { key: 0, label: "0", frac: 0.5 },
                { key: 1, label: "+1", frac: 1 },
              ]}
              aria-hidden
              data-vectorscope-correlation-axis
              className={cn(
                CAPTION_TEXT,
                "font-[family-name:var(--ui-font-mono)] tabular-nums",
                "mt-[var(--ui-chart-axis-gap)] h-[var(--ui-chart-x-axis-row-h)] w-full shrink-0"
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
