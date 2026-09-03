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
import { AxisRail } from "./AxisRail.jsx";
import { useAxisViewport } from "../../workspace/axisViewportHooks.js";
import { StereoMapPlot } from "./StereoMapPlot.jsx";
import { SnapshotEmptyState, SNAPSHOT_NO_DATA_MESSAGE } from "./SnapshotEmptyState.jsx";
import { useChartHover } from "../../hooks/useChartHover";
import { useAxisActivePulse } from "../../hooks/useAxisActivePulse";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import { useAxisSize } from "../../hooks/useAxisSize";
import {
  computeStereoMapHoverIndex,
  formatSpectrumFreq,
  formatStereoMapValue,
  formatStereoMapHoldValue,
} from "../../math/hoverMath";
import { cn } from "@/lib/utils";
import { PANEL_MIN_SPECTRUM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import {
  buildAdaptiveDbTicks,
  buildAdaptiveFreqTicks,
  rangedFreqToXFrac,
  rangedFromTopFrac,
} from "../../config/scales";
import {
  anchorFromPointer,
  panRange,
  zoomRange,
  FREQUENCY_VIEWPORT,
  WHEEL_PAN_SCALE,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "../../math/axisInteractionMath.js";
import { beginPanelCpuSample, finishPanelCpuSample } from "../../dev/panelCpuProfiler.js";

export const STEREO_MAP_MONO_MESSAGE = "Mono input — Stereo Map requires a channel pair.";

// The y axis is only editable in the two dB modes, and neither is a free interval. Mono Loss tops
// out at 0 because a loss cannot be a gain; M/S Ratio is read against 0, which therefore has to stay
// on screen. Position and Correlation always show their whole normalized range, so they get no
// gestures at all -- a rail that lights up under the cursor but refuses to move would be a lie.
const Y_VIEWPORT_BY_MODE = {
  [STEREO_MAP_MODES.MONO_LOSS_DB]: {
    absMin: -60,
    absMax: 0,
    defaultMin: -24,
    defaultMax: 0,
    minSpan: 6,
    scale: "linear",
    pinnedMax: true,
    keys: { min: "stereoMapMonoLossYMinDb" },
  },
  [STEREO_MAP_MODES.MS_RATIO_DB]: {
    absMin: -96,
    absMax: 48,
    defaultMin: -48,
    defaultMax: 24,
    minSpan: 6,
    scale: "linear",
    mustInclude: 0,
    keys: { min: "stereoMapMsRatioYMinDb", max: "stereoMapMsRatioYMaxDb" },
  },
};

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
  const { panelControls, onPanelControlsChange } = usePanelInstanceData();
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const mode = normalizedPanelControls.stereoMapMode;
  const holdVisible = normalizedPanelControls.stereoMapHold;
  const stereoMapKey = stereoMapRequestKeyFromControls(panelControls);
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
  const yViewport = Y_VIEWPORT_BY_MODE[mode];
  const passiveYAxis = useAxisSize("y");
  const editableYAxis = useAxisInteraction({
    axis: "y",
    min: range.lowerBound,
    max: range.upperBound,
    absMin: yViewport?.absMin ?? -1,
    absMax: yViewport?.absMax ?? 1,
    defaultMin: yViewport?.defaultMin ?? -1,
    defaultMax: yViewport?.defaultMax ?? 1,
    minSpan: yViewport?.minSpan ?? 0,
    scale: "linear",
    pinnedMax: yViewport?.pinnedMax ?? false,
    mustInclude: yViewport?.mustInclude,
    onRangeChange: useCallback(
      (newMin, newMax) => {
        const keys = Y_VIEWPORT_BY_MODE[mode]?.keys;
        if (!keys) return;
        updatePanelControlsRange({
          [keys.min]: newMin,
          ...(keys.max ? { [keys.max]: newMax } : null),
        });
      },
      [mode, updatePanelControlsRange]
    ),
  });
  const frequencyViewport = useAxisViewport("frequency", {
    minKey: "stereoMapXMinFreq",
    maxKey: "stereoMapXMaxFreq",
  });
  const xMinHz = frequencyViewport.min;
  const xMaxHz = frequencyViewport.max;
  const setFrequencyRange = frequencyViewport.setRange;
  const stereoMapXAxis = useAxisInteraction({
    axis: "x",
    min: xMinHz,
    max: xMaxHz,
    ...FREQUENCY_VIEWPORT,
    defaultMin: FREQUENCY_VIEWPORT.absMin,
    defaultMax: FREQUENCY_VIEWPORT.absMax,
    onRangeChange: useCallback(
      (newMin, newMax) => setFrequencyRange(newMin, newMax),
      [setFrequencyRange]
    ),
  });
  const freqTicks = buildAdaptiveFreqTicks(xMinHz, xMaxHz, stereoMapXAxis.axisPx);

  const pair = normalizedPanelControls.stereoMapPair;
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const channelLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const firstIndex = Number.isFinite(pair?.x) ? Math.max(0, Math.floor(pair.x)) : 0;
  const secondIndex = Number.isFinite(pair?.y) ? Math.max(0, Math.floor(pair.y)) : 1;
  const firstLabel = channelLabels[firstIndex] ?? `Ch ${firstIndex + 1}`;
  const secondLabel = channelLabels[secondIndex] ?? `Ch ${secondIndex + 1}`;

  const yTicks = yTicksForMode(
    mode,
    range,
    firstLabel,
    secondLabel,
    (yViewport ? editableYAxis : passiveYAxis).axisPx
  );

  const snapResolved = isSnapshot
    ? resolveStereoMapSnapshotForKey?.(stereoMapKey, mode, range, { withHold: holdVisible })
    : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveRow = isSnapshot ? null : displayAudio?.stereoMapResultsByKey?.[stereoMapKey];
  const liveDerived = useMemo(() => {
    if (!liveRow) return null;
    const startedAt = beginPanelCpuSample();
    const derived = deriveStereoMapRow(mode, liveRow, range);
    finishPanelCpuSample("stereoMap", "deriveLiveRow", startedAt);
    return derived;
  }, [liveRow, mode, range]);
  const liveHistory = isSnapshot ? null : getStereoMapHistoryForKey?.(stereoMapKey);
  const liveHistoryVersion = liveHistory?.version ?? 0;

  let bandCentersHz = [];
  let points = [];
  let holdValues = null;
  if (isSnapshot) {
    if (!snapshotMissing && snapResolved?.derived) {
      bandCentersHz = snapResolved.derived.bandCentersHz ?? [];
      points = snapResolved.derived.points ?? [];
    }
    holdValues = snapResolved?.hold ?? null;
  } else {
    // Live Hold accumulates once per Analysis Key, in the packed mode-history slab this key's
    // FrameIntake instance already owns (see StereoMapModeHistorySlab#liveHoldValues) — the same
    // object every Workspace/Dock instance on this key reads via getStereoMapHistoryForKey. Reading
    // from it here, rather than accumulating a private copy, is what makes two panels (or a panel
    // and a future Dock module) on the same key agree on Hold. Global Clear replaces the whole
    // per-key Map in FrameIntake, so the next live tick hands back a brand-new, empty slab with no
    // extra bookkeeping needed on this end.
    holdValues = liveHistory?.liveHoldValues()?.[mode] ?? null;
    if (liveDerived) {
      bandCentersHz = liveDerived.bandCentersHz;
      points = liveDerived.points;
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
        holdLabel,
      };
    },
    isSnapshot ? null : liveRow
  );

  const chartSvgRef = useRef(null);
  const chartDragRef = useRef(null);
  const suppressChartClickRef = useRef(false);
  const { active: chartXAxisActive, pulse: pulseChartXAxis } = useAxisActivePulse();

  const zoomStereoMapXFromChart = useCallback(
    (e, factor) => {
      const next = zoomRange({
        min: xMinHz,
        max: xMaxHz,
        ...FREQUENCY_VIEWPORT,
        anchor: anchorFromPointer({
          rect: e.currentTarget.getBoundingClientRect(),
          clientX: e.clientX,
          axis: "x",
          scale: FREQUENCY_VIEWPORT.scale,
          min: xMinHz,
          max: xMaxHz,
        }),
        factor,
      });
      setFrequencyRange(next.min, next.max);
      pulseChartXAxis();
    },
    [pulseChartXAxis, setFrequencyRange, xMaxHz, xMinHz]
  );

  const panStereoMapXFromChart = useCallback((rect, deltaPx, startRange) => {
    const next = panRange({
      min: startRange.min,
      max: startRange.max,
      ...FREQUENCY_VIEWPORT,
      deltaPx,
      axisPx: Math.max(1, rect.width),
    });
    return next;
  }, []);

  const onChartWheel = useCallback(
    (e) => {
      if (!historyChartInteractive) return;
      e.preventDefault();
      // A trackpad's horizontal swipe pans the frequency axis, matching the spectrum. Pick by
      // magnitude, not truthiness: a trackpad puts noise-scale values on the idle axis.
      if (Number.isFinite(e.deltaX) && Math.abs(e.deltaX) > Math.abs(e.deltaY ?? 0)) {
        const rect = e.currentTarget.getBoundingClientRect();
        const panned = panStereoMapXFromChart(rect, e.deltaX * WHEEL_PAN_SCALE, {
          min: xMinHz,
          max: xMaxHz,
        });
        setFrequencyRange(panned.min, panned.max);
        pulseChartXAxis();
        return;
      }
      zoomStereoMapXFromChart(e, e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR);
    },
    [
      historyChartInteractive,
      panStereoMapXFromChart,
      pulseChartXAxis,
      setFrequencyRange,
      xMaxHz,
      xMinHz,
      zoomStereoMapXFromChart,
    ]
  );

  const onChartPointerDown = useCallback(
    (e) => {
      if (!historyChartInteractive || !e.ctrlKey || (e.button != null && e.button !== 0)) return;
      e.preventDefault();
      suppressChartClickRef.current = true;
      chartDragRef.current = {
        startX: e.clientX,
        startRange: { min: xMinHz, max: xMaxHz },
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
      const panned = panStereoMapXFromChart(rect, -dx, drag.startRange);
      setFrequencyRange(panned.min, panned.max);
      pulseChartXAxis();
      return true;
    },
    [panStereoMapXFromChart, pulseChartXAxis, setFrequencyRange]
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

  if (snapshotMissing) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <SnapshotEmptyState message={SNAPSHOT_NO_DATA_MESSAGE} />
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
          <AxisRail
            axis="y"
            className={cn(W_SPECTRUM_Y_AXIS, "min-h-0 shrink-0")}
            interaction={yViewport ? editableYAxis : undefined}
            railRef={passiveYAxis.axisRef}
            ticks={yTicks.map(({ v, lb }) => ({
              key: v,
              label: lb,
              frac: rangedFromTopFrac(v, range.lowerBound, range.upperBound),
            }))}
          />
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
                  sourceVersion={isSnapshot ? selectedOffset : liveHistoryVersion}
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
          <AxisRail
            axis="x"
            className="h-[var(--ui-chart-x-axis-row-h)] w-full"
            interaction={stereoMapXAxis}
            active={chartXAxisActive}
            ticks={freqTicks.map(({ v: f, lb }) => ({
              key: f,
              label: lb,
              frac: rangedFreqToXFrac(f, xMinHz, xMaxHz),
            }))}
          />
        </div>
      </div>
    </div>
  );
}
