import { useCallback, useMemo, useRef } from "react";
import {
  useFrameData,
  useHistoryData,
  usePanelInstanceData,
} from "../../workspace/AudioDataContext.jsx";
import { stereoMapRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { deriveStereoMapRow, STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";
import { StereoMapPlot } from "./StereoMapPlot.jsx";
import {
  SnapshotEmptyState,
  SNAPSHOT_NO_DATA_MESSAGE,
  ANALYSIS_OVER_CAP_MESSAGE,
} from "./SnapshotEmptyState.jsx";
import { useChartHover } from "../../hooks/useChartHover";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import { useAxisSize } from "../../hooks/useAxisSize";
import {
  computeStereoMapHoverIndex,
  formatSpectrumFreq,
  formatStereoMapValue,
  formatStereoMapHoldValue,
  formatStereoMapEnergy,
} from "../../math/hoverMath";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import {
  buildAdaptiveDbTicks,
  buildAdaptiveFreqTicks,
  rangedFreqToXFrac,
  rangedFromTopFrac,
} from "../../config/scales";
import { computeLogPan, computeLogZoom, pixelToLogValue } from "../../math/axisInteractionMath.js";

export const STEREO_MAP_MONO_MESSAGE = "Mono input — Stereo Map requires a channel pair.";

const CHART_ZOOM_IN_FACTOR = 0.85;
const CHART_ZOOM_OUT_FACTOR = 1.18;
const CHART_WHEEL_PAN_SCALE = 0.5;

function rangeForMode(mode, controls) {
  if (mode === STEREO_MAP_MODES.MONO_LOSS_DB) {
    return { lowerBound: controls.stereoMapMonoLossYMinDb, upperBound: 0 };
  }
  if (mode === STEREO_MAP_MODES.MS_RATIO_DB) {
    return {
      lowerBound: controls.stereoMapMsRatioYMinDb,
      upperBound: controls.stereoMapMsRatioYMaxDb,
    };
  }
  // Position and Correlation always show their complete normalized range; zooming is disabled.
  return { lowerBound: -1, upperBound: 1 };
}

function yTicksForMode(mode, range, firstLabel, secondLabel, yAxisPx) {
  if (mode === STEREO_MAP_MODES.POSITION) {
    return [
      { v: 1, lb: firstLabel },
      { v: -1, lb: secondLabel },
    ];
  }
  if (mode === STEREO_MAP_MODES.CORRELATION) {
    return [
      { v: 1, lb: "+1" },
      { v: 0, lb: "0" },
      { v: -1, lb: "-1" },
    ];
  }
  return buildAdaptiveDbTicks(range.lowerBound, range.upperBound, yAxisPx);
}

function formatPositionHoldLabel(holdValues, index, range, firstLabel, secondLabel) {
  if (!holdValues) return null;
  const parts = [
    formatStereoMapHoldValue(
      STEREO_MAP_MODES.POSITION,
      holdValues.maximum?.[index] ?? null,
      range,
      {
        firstLabel,
        secondLabel,
      }
    ),
    formatStereoMapHoldValue(
      STEREO_MAP_MODES.POSITION,
      holdValues.minimum?.[index] ?? null,
      range,
      {
        firstLabel,
        secondLabel,
      }
    ),
  ].filter((label) => label !== "-");
  return parts.length ? parts.join(" / ") : null;
}

export function StereoMapPanel() {
  const { channelCount = 0, peakLabelContext, displayAudio } = useFrameData();
  const {
    selectedOffset,
    resolveStereoMapSnapshotForKey,
    historyChartInteractive,
    getStereoMapHistoryForKey,
    totalSamples,
    setSelectedOffset,
    captureCurrentSnapshot,
  } = useHistoryData();
  const { panelControls, analysisStatus, onPanelControlsChange } = usePanelInstanceData();
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const mode = normalizedPanelControls.stereoMapMode;
  const holdVisible = normalizedPanelControls.stereoMapHold;
  const stereoMapKey = stereoMapRequestKeyFromControls(panelControls);
  const isOverCap = analysisStatus === "overCap";
  const isSnapshot = selectedOffset >= 0;
  // channelCount is 0 before capture has reported real device info (see appRuntimeDerivations.js) —
  // that's "not started yet", not a mono device, so it must fall through to the normal empty chart
  // rather than the mono message.
  const isMono = Number.isFinite(channelCount) && channelCount > 0 && channelCount < 2;

  const range = useMemo(
    () => rangeForMode(mode, normalizedPanelControls),
    [mode, normalizedPanelControls]
  );

  const updatePanelControlsRange = useCallback(
    (next) => {
      onPanelControlsChange?.(normalizePanelControls({ ...normalizedPanelControls, ...next }));
    },
    [normalizedPanelControls, onPanelControlsChange]
  );

  // Stereo Map's y axis is not zoom/pan interactive (Position and Correlation are fixed-range; the
  // dB modes take their bounds from panel settings), but it still labels adaptive ticks, so it
  // measures its rail for the tick spacing budget without taking the interaction handlers.
  const yAxis = useAxisSize("y");
  const stereoMapXAxis = useAxisInteraction({
    axis: "x",
    min: normalizedPanelControls.stereoMapXMinFreq,
    max: normalizedPanelControls.stereoMapXMaxFreq,
    absMin: 20,
    absMax: 20000,
    defaultMin: 20,
    defaultMax: 20000,
    minSpan: 1,
    scale: "log",
    onRangeChange: useCallback(
      (newMin, newMax) =>
        updatePanelControlsRange({ stereoMapXMinFreq: newMin, stereoMapXMaxFreq: newMax }),
      [updatePanelControlsRange]
    ),
  });
  const xMinHz = normalizedPanelControls.stereoMapXMinFreq;
  const xMaxHz = normalizedPanelControls.stereoMapXMaxFreq;
  const freqTicks = buildAdaptiveFreqTicks(xMinHz, xMaxHz, stereoMapXAxis.axisPx);

  const pair = normalizedPanelControls.stereoMapPair;
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const channelLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const firstIndex = Number.isFinite(pair?.x) ? Math.max(0, Math.floor(pair.x)) : 0;
  const secondIndex = Number.isFinite(pair?.y) ? Math.max(0, Math.floor(pair.y)) : 1;
  const firstLabel = channelLabels[firstIndex] ?? `Ch ${firstIndex + 1}`;
  const secondLabel = channelLabels[secondIndex] ?? `Ch ${secondIndex + 1}`;

  const yTicks = yTicksForMode(mode, range, firstLabel, secondLabel, yAxis.axisPx);

  const snapResolved = isSnapshot
    ? resolveStereoMapSnapshotForKey?.(stereoMapKey, mode, range, { withHold: holdVisible })
    : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveRow = isSnapshot ? null : displayAudio?.stereoMapResultsByKey?.[stereoMapKey];

  let bandCentersHz = [];
  let points = [];
  let energyDb = [];
  let holdValues = null;
  if (isSnapshot) {
    if (!snapshotMissing && snapResolved?.derived) {
      bandCentersHz = snapResolved.derived.bandCentersHz ?? [];
      points = snapResolved.derived.points ?? [];
      energyDb = snapResolved.derived.energyDb ?? [];
    }
    holdValues = snapResolved?.hold ?? null;
  } else {
    // Live Hold accumulates once per Analysis Key, in the shared StereoMapHistorySlab this key's
    // FrameIntake instance already owns (see StereoMapHistorySlab#liveHoldValues) — the same
    // object every Workspace/Dock instance on this key reads via getStereoMapHistoryForKey. Reading
    // from it here, rather than accumulating a private copy, is what makes two panels (or a panel
    // and a future Dock module) on the same key agree on Hold. Global Clear replaces the whole
    // per-key Map in FrameIntake, so the next live tick hands back a brand-new, empty slab with no
    // extra bookkeeping needed on this end.
    holdValues = getStereoMapHistoryForKey?.(stereoMapKey)?.liveHoldValues()?.[mode] ?? null;
    if (liveRow) {
      const derived = deriveStereoMapRow(mode, liveRow, range);
      bandCentersHz = derived.bandCentersHz;
      points = derived.points;
      energyDb = derived.energyDb;
    }
    // Live but no per-key result yet: pending treatment (empty chart) until this request's first
    // frame arrives, matching Spectrum/Vectorscope — never fall back to another request's data.
  }

  const {
    hover: stereoMapHover,
    onMove,
    onLeave,
  } = useChartHover(
    (xFrac) => {
      if (!bandCentersHz.length) return null;
      const index = computeStereoMapHoverIndex(xFrac, bandCentersHz, xMinHz, xMaxHz);
      const point = points[index];
      const hz = bandCentersHz[index];
      if (!point || !Number.isFinite(hz)) return null;
      const holdLabel = holdVisible
        ? mode === STEREO_MAP_MODES.POSITION
          ? formatPositionHoldLabel(holdValues, index, range, firstLabel, secondLabel)
          : formatStereoMapHoldValue(mode, holdValues?.[index] ?? null, range, {
              firstLabel,
              secondLabel,
            })
        : null;
      return {
        leftPct: rangedFreqToXFrac(hz, xMinHz, xMaxHz) * 100,
        topPct:
          rangedFromTopFrac(
            point.state === "invalid" ? 0 : point.value,
            range.lowerBound,
            range.upperBound
          ) * 100,
        freqLabel: formatSpectrumFreq(hz),
        valueLabel: formatStereoMapValue(mode, point, { firstLabel, secondLabel }),
        energyLabel: formatStereoMapEnergy(energyDb[index]),
        holdLabel,
      };
    },
    isSnapshot ? null : liveRow
  );

  const chartSvgRef = useRef(null);
  const chartDragRef = useRef(null);
  const suppressChartClickRef = useRef(false);

  const zoomStereoMapXFromChart = useCallback(
    (e, factor) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const px = width - Math.max(0, Math.min(width, e.clientX - rect.left));
      const next = computeLogZoom({
        min: xMinHz,
        max: xMaxHz,
        absMin: 20,
        absMax: 20000,
        minOctaves: 1,
        anchor: pixelToLogValue(px, width, xMinHz, xMaxHz),
        factor,
      });
      updatePanelControlsRange({ stereoMapXMinFreq: next.min, stereoMapXMaxFreq: next.max });
    },
    [updatePanelControlsRange, xMaxHz, xMinHz]
  );

  const panStereoMapXFromChart = useCallback((rect, deltaPx, startRange) => {
    const next = computeLogPan({
      min: startRange.stereoMapXMinFreq,
      max: startRange.stereoMapXMaxFreq,
      absMin: 20,
      absMax: 20000,
      deltaPx,
      axisPx: Math.max(1, rect.width),
    });
    return { stereoMapXMinFreq: next.min, stereoMapXMaxFreq: next.max };
  }, []);

  const onChartWheel = useCallback(
    (e) => {
      if (!historyChartInteractive) return;
      e.preventDefault();
      zoomStereoMapXFromChart(e, e.deltaY > 0 ? CHART_ZOOM_OUT_FACTOR : CHART_ZOOM_IN_FACTOR);
    },
    [historyChartInteractive, zoomStereoMapXFromChart]
  );

  const onChartPointerDown = useCallback(
    (e) => {
      if (!historyChartInteractive || !e.ctrlKey || (e.button != null && e.button !== 0)) return;
      e.preventDefault();
      suppressChartClickRef.current = true;
      chartDragRef.current = {
        startX: e.clientX,
        startRange: { stereoMapXMinFreq: xMinHz, stereoMapXMaxFreq: xMaxHz },
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch (_) {}
    },
    [historyChartInteractive, xMaxHz, xMinHz]
  );

  const onChartPointerMove = useCallback(
    (e) => {
      const drag = chartDragRef.current;
      if (!drag) return false;
      const rect = e.currentTarget.getBoundingClientRect();
      const dx = e.clientX - drag.startX;
      updatePanelControlsRange(
        panStereoMapXFromChart(rect, -dx * CHART_WHEEL_PAN_SCALE * 2, drag.startRange)
      );
      return true;
    },
    [panStereoMapXFromChart, updatePanelControlsRange]
  );

  const onChartPointerUp = useCallback((e) => {
    const wasDragging = !!chartDragRef.current;
    chartDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (wasDragging) {
      window.setTimeout(() => {
        suppressChartClickRef.current = false;
      }, 0);
    }
  }, []);

  const canCaptureCurrentSnapshot = historyChartInteractive && totalSamples > 0;
  const paletteKey = isSnapshot ? "snap" : "live";

  if (isMono) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <SnapshotEmptyState message={STEREO_MAP_MONO_MESSAGE} />
      </div>
    );
  }

  if (isOverCap || snapshotMissing) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
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
        "relative flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div className="grid min-h-0 flex-1 grid-cols-[var(--ui-chart-y-axis-rail-w)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch">
          <div
            ref={yAxis.axisRef}
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-0 bottom-0">
              {yTicks.map(({ v, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={v} className={axisLabelClass("y", "start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === yTicks.length - 1) {
                  return (
                    <span key={v} className={axisLabelClass("y", "end")}>
                      {lb}
                    </span>
                  );
                }
                return (
                  <span
                    key={v}
                    className={axisLabelClass("y", "middle")}
                    style={{
                      top: `${rangedFromTopFrac(v, range.lowerBound, range.upperBound) * 100}%`,
                    }}
                  >
                    {lb}
                  </span>
                );
              })}
            </div>
          </div>
          <div className="relative min-h-0 min-w-0">
            <div
              data-testid="stereo-map-chart"
              className="relative min-h-0 h-full"
              onPointerLeave={() => {
                onLeave();
              }}
              onClick={() => {
                if (suppressChartClickRef.current) {
                  suppressChartClickRef.current = false;
                  return;
                }
                if (!canCaptureCurrentSnapshot) return;
                captureCurrentSnapshot?.();
              }}
              onDoubleClick={() => {
                if (!historyChartInteractive) return;
                setSelectedOffset?.(-1);
              }}
              onWheel={onChartWheel}
              onPointerDown={onChartPointerDown}
              onPointerMove={(e) => {
                if (onChartPointerMove(e)) return;
                const r = chartSvgRef.current?.getBoundingClientRect();
                if (r) onMove(e.clientX, e.clientY, r);
              }}
              onPointerUp={onChartPointerUp}
              onPointerCancel={onChartPointerUp}
            >
              <div className="absolute inset-0 min-h-0 min-w-0" ref={chartSvgRef}>
                <StereoMapPlot
                  mode={mode}
                  bandCentersHz={bandCentersHz}
                  points={points}
                  holdValues={holdValues}
                  holdVisible={holdVisible}
                  range={range}
                  xMinHz={xMinHz}
                  xMaxHz={xMaxHz}
                  paletteKey={paletteKey}
                />
              </div>
              {stereoMapHover ? (
                <div className="pointer-events-none absolute inset-0 z-10">
                  <div
                    className="absolute bottom-0 top-0 border-l border-dashed border-muted-foreground/55"
                    style={{ left: `${stereoMapHover.leftPct}%` }}
                  />
                  <div
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-[color:var(--ui-stereo-map-primary)]"
                    style={{ left: `${stereoMapHover.leftPct}%`, top: `${stereoMapHover.topPct}%` }}
                  />
                  <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded-xs border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {stereoMapHover.freqLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {stereoMapHover.valueLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {stereoMapHover.energyLabel}
                    </div>
                    {stereoMapHover.holdLabel ? (
                      <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                        Max hold: {stereoMapHover.holdLabel}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div />
          <div
            {...stereoMapXAxis.axisHandlers}
            ref={stereoMapXAxis.axisRef}
            style={{ cursor: stereoMapXAxis.cursorStyle }}
            className={cn(
              CAPTION_TEXT,
              "relative h-[var(--ui-chart-x-axis-row-h)] w-full transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              stereoMapXAxis.isActive && "text-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-0 h-full">
              {freqTicks.map(({ v: f, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={f} className={axisLabelClass("x", "start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === freqTicks.length - 1) {
                  return (
                    <span key={f} className={axisLabelClass("x", "end")}>
                      {lb}
                    </span>
                  );
                }
                return (
                  <span
                    key={f}
                    className={axisLabelClass("x", "middle")}
                    style={{ left: `${rangedFreqToXFrac(f, xMinHz, xMaxHz) * 100}%` }}
                  >
                    {lb}
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
