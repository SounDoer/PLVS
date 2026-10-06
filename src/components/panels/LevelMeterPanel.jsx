import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import { useFrameData, usePanelInstanceData } from "../../workspace/AudioDataContext.jsx";
import { motion, useReducedMotion, useSpring, useTransform } from "framer-motion";
import { cn } from "@/lib/utils";
import { useHoverTip } from "@/components/HoverTip";
import { PANEL_MIN_PEAK, W_PEAK_TICKS } from "@/lib/shellLayout";
import {
  LOUDNESS_DB_MAX,
  LOUDNESS_DB_MIN,
  PEAK_DB_MAX,
  PEAK_DB_MIN,
  buildAdaptiveDbTicks,
  rangedFromTopFrac,
} from "../../config/scales";
import { getPeakChannels } from "../../math/peakChannelMath";
import { fmtMetric } from "../../math/formatMath";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";
import {
  useLevelMeterPlaybackMax,
  useLevelMeterPlaybackMaxChannels,
} from "../../hooks/useLevelMeterPlaybackMax.js";
import { useLoudnessProfile } from "../../hooks/LoudnessProfileContext.jsx";
import { loudnessProfileEvaluate } from "../../lib/loudnessProfileEvaluate.js";
import { levelMeterBackground, levelMeterMarkerStatus } from "../../lib/levelMeterColors.js";
import { loudnessMeterMarkerClass } from "../../lib/loudnessProfileStatusClasses.js";
import { axisLabelCenterPx, tickOpacityNearMarker } from "../../lib/axisMarkerFade.js";
import { AxisRail, tickPosition } from "./AxisRail.jsx";

const LEVEL_MODE_META = {
  peak: { label: "Peak", unit: "dBFS" },
  rms: { label: "RMS", unit: "dBFS", field: "rmsDb" },
  momentary: { label: "Momentary", meterLabel: "M", unit: "LUFS", field: "momentary" },
  shortTerm: { label: "Short-term", meterLabel: "ST", unit: "LUFS", field: "shortTerm" },
};

// The marker is placed by an inline `top`, so the endpoints shift the label off that anchor with
// a transform rather than a second positioning property, which would fight the inline one.
const LEVEL_METER_VALUE_MARKER_POSITION = {
  start: "translate-y-0",
  middle: "-translate-y-1/2",
  end: "-translate-y-full",
};

// Anchored right like the axis tick labels, so the reading and the ticks end on the same column.
const LEVEL_METER_VALUE_MARKER_BASE =
  "absolute right-0 whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-display)] leading-none tabular-nums";
// Sized in the marker's own font, not the rail's: five monospace characters at 0.6em each, the
// widest reading fmtMetric prints ("-16.9"). A `ch` width measures the narrower tick font, and the
// overflow it left ate the panel's whole left padding.
const LEVEL_METER_Y_AXIS_WITH_MARKER = "w-[calc(var(--ui-fs-display)*3)]";
const LEVEL_METER_BAR_INSET_X = "0.1rem";
const LEVEL_METER_CHANNEL_GAP = "0.15rem";
const LEVEL_METER_GRID =
  "grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-[var(--ui-chart-axis-gap)]";

/**
 * @param {string} position
 */
function levelMeterValueMarkerClass(position) {
  return `${LEVEL_METER_VALUE_MARKER_BASE} ${LEVEL_METER_VALUE_MARKER_POSITION[position]}`;
}

/// `background` is a CSS background-image laid over the whole bar; the fill reveals it from the
/// bottom.
function AnimatedLevelFill({ value, min, max, fromTopFrac, background }) {
  const reduceMotion = useReducedMotion();
  const clamped = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : null;
  const clipTopFrac = clamped != null ? fromTopFrac(clamped) : 1;
  const targetScaleY = Math.max(0, Math.min(1, 1 - clipTopFrac));
  const spring = useSpring(targetScaleY, {
    stiffness: reduceMotion ? 8000 : 520,
    damping: reduceMotion ? 120 : 42,
    mass: reduceMotion ? 0.08 : 0.35,
  });
  const clipPath = useTransform(spring, (scale) => `inset(${(1 - scale) * 100}% 0 0 0)`);

  useEffect(() => {
    spring.set(targetScaleY);
  }, [spring, targetScaleY]);

  if (clamped == null) return null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* The gradient spans the whole bar and is clipped from the top, so each colour stays on
          its own level; scaling it would squeeze the full ramp into every fill. */}
      <motion.div
        data-level-meter-gradient={background}
        className="absolute inset-0"
        style={{ clipPath, backgroundImage: background }}
      />
    </div>
  );
}

function AnimatedPeakFill({ dbValue, yRange, background }) {
  return (
    <AnimatedLevelFill
      value={dbValue}
      min={yRange.min}
      max={yRange.max}
      fromTopFrac={(v) => rangedFromTopFrac(v, yRange.min, yRange.max)}
      background={background}
    />
  );
}

/**
 * @param {number} value
 */
function formatLevelValue(value) {
  return fmtMetric(value);
}

/// Where a readout marker sits on the axis, or null for a reading with nothing printable --
/// silence, or the out-of-range sentinel -- which has no position worth pinning. Everything else
/// stays visible: a TP Max hidden because the user zoomed past it takes its reset click with it,
/// and the reading most likely to leave the range is the hot one.
function axisMarkerPlacement(value, yRange) {
  if (!Number.isFinite(value) || formatLevelValue(value) === "-") return null;
  const clamped = Math.max(yRange.min, Math.min(yRange.max, value));
  return {
    frac: rangedFromTopFrac(clamped, yRange.min, yRange.max),
    position: clamped === value ? "middle" : value > yRange.max ? "start" : "end",
  };
}

/// Measures the y-axis tick track for fading ticks under a readout marker. Both label kinds are
/// `leading-none`, so each is exactly as tall as its font size; reading those off the track keeps
/// the fade in step with the interface size setting. Pass `trackRef` as the track's ref.
function useAxisTrackMetrics() {
  const [track, trackRef] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useLayoutEffect(() => {
    if (!track) return undefined;
    const measure = () => {
      const style = getComputedStyle(track);
      const trackPx = track.getBoundingClientRect().height;
      const tickPx = parseFloat(style.fontSize);
      const markerPx = parseFloat(style.getPropertyValue("--ui-fs-display"));
      if (!(trackPx > 0 && tickPx > 0 && markerPx > 0)) return;
      setMetrics((prev) =>
        prev?.trackPx === trackPx && prev.tickPx === tickPx && prev.markerPx === markerPx
          ? prev
          : { trackPx, tickPx, markerPx }
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    // A font size change also resizes the track: the rail it fills is sized in `ch`.
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [track]);

  return { trackRef, metrics };
}

/// The marker shares the ticks' right-aligned column, so a tick near the reading would print
/// underneath it. Those ticks fade by how far they clear the marker -- continuously, so a live
/// reading drifting around a tick never makes it blink.
function levelMeterAxisTicks(ticks, yRange, marker, metrics) {
  const markerCenterPx =
    marker && metrics
      ? axisLabelCenterPx(marker.position, marker.frac, metrics.trackPx, metrics.markerPx)
      : null;
  return ticks.map(({ v, lb }, index) => {
    const frac = rangedFromTopFrac(v, yRange.min, yRange.max);
    const tick = { key: v, label: lb, frac };
    if (markerCenterPx == null) return tick;
    const tickCenterPx = axisLabelCenterPx(
      tickPosition(index, frac, ticks.length),
      frac,
      metrics.trackPx,
      metrics.tickPx
    );
    const opacity = tickOpacityNearMarker(
      tickCenterPx,
      metrics.tickPx,
      markerCenterPx,
      metrics.markerPx
    );
    return opacity < 1 ? { ...tick, opacity: Math.round(opacity * 100) / 100 } : tick;
  });
}

/**
 * @param {{
 *   value: number,
 *   yRange: any,
 *   dataAttribute?: string,
 *   className: string,
 *   onReset?: (...args: any[]) => any,
 *   resetLabel?: string,
 * }} props
 */
function AxisValueMarker({
  value,
  yRange,
  dataAttribute = "data-level-value-marker",
  className,
  onReset,
  resetLabel,
}) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: onReset ? resetLabel : undefined,
    side: "bottom",
  });
  const placement = axisMarkerPlacement(value, yRange);
  if (!placement) return null;
  const { frac, position } = placement;
  const outOfRange = position !== "middle";

  // Stops the click from reaching the y-axis drag/zoom handlers underneath.
  const stopAxisInteraction = onReset ? (e) => e.stopPropagation() : undefined;

  return (
    <span
      {...{ [dataAttribute]: "" }}
      ref={onReset ? anchorRef : undefined}
      className={cn(
        onReset ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
        "z-10 font-semibold text-primary",
        levelMeterValueMarkerClass(position),
        className
      )}
      style={{ top: `${frac * 100}%` }}
      onMouseDown={stopAxisInteraction}
      onDoubleClick={stopAxisInteraction}
      onClick={
        onReset
          ? (e) => {
              e.stopPropagation();
              onReset(e);
            }
          : undefined
      }
      onMouseEnter={onReset ? showTip : undefined}
      onMouseLeave={onReset ? hideTip : undefined}
    >
      {formatLevelValue(value)}
      {outOfRange ? (
        // The arrow says the pinned position is not a real place on the scale, and which way the
        // reading actually left the range. Taken out of flow rather than merely zero-width: the
        // marker is right-aligned, so anything the arrow contributes to the line -- its margin
        // included -- would shift the digits off the tick column. Decorative to a screen reader,
        // which already gets the value.
        <span
          aria-hidden="true"
          data-marker-out-of-range={value > yRange.max ? "above" : "below"}
          className="absolute left-full ml-[0.3ch]"
        >
          {value > yRange.max ? "▲" : "▼"}
        </span>
      ) : null}
      {onReset ? tipNode : null}
    </span>
  );
}

export function LevelMeterPanel() {
  const { displayAudio, peakLabelContext, hasTpMaxValue, onResetTpMax } = useFrameData();
  const { panelControls, onPanelControlsChange } = usePanelInstanceData();
  const { document: loudnessProfileDocument } = useLoudnessProfile();
  // With no profile the readout markers keep their accent colour; under one they follow the same
  // status the Stats panel shows, so a metric never reads as fine here and hot there.
  const profileActive = Boolean(loudnessProfileDocument);
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const levelMeterMode = normalizedPanelControls.levelMeterMode;
  const showPlaybackMax = normalizedPanelControls.levelMeterPlaybackMax;
  const showLevelValueMarker = normalizedPanelControls.levelMeterValueMarker;
  const showTpMaxMarkerSetting = normalizedPanelControls.levelMeterTpMaxMarker;
  const modeMeta = LEVEL_MODE_META[levelMeterMode] ?? LEVEL_MODE_META.peak;
  const isPeak = levelMeterMode === "peak";
  const isRms = levelMeterMode === "rms";
  const isPeakFamily = isPeak || isRms;
  // Peak-family modes keep their own dBFS range; the loudness-family modes (M/ST) share the
  // LoudnessPanel's LUFS Y range so zooming one rescales the other.
  const modeDefaults = isPeakFamily
    ? { min: PEAK_DB_MIN, max: PEAK_DB_MAX }
    : { min: LOUDNESS_DB_MIN, max: LOUDNESS_DB_MAX };
  const levelMeterYRange = isPeakFamily
    ? {
        min: normalizedPanelControls.levelMeterYMinDb,
        max: normalizedPanelControls.levelMeterYMaxDb,
      }
    : {
        min: normalizedPanelControls.loudnessYMinDb,
        max: normalizedPanelControls.loudnessYMaxDb,
      };
  const fillBackground = levelMeterBackground({
    mode: levelMeterMode,
    controls: normalizedPanelControls,
    profileDocument: loudnessProfileDocument,
    viewMin: levelMeterYRange.min,
    viewMax: levelMeterYRange.max,
  });
  const levelMeterYAxis = useAxisInteraction({
    axis: "y",
    min: levelMeterYRange.min,
    max: levelMeterYRange.max,
    absMin: modeDefaults.min,
    absMax: modeDefaults.max,
    defaultMin: modeDefaults.min,
    defaultMax: modeDefaults.max,
    minSpan: 12,
    scale: "linear",
    onRangeChange: useCallback(
      (newMin, newMax) => {
        const rangeKeys = isPeakFamily
          ? { levelMeterYMinDb: newMin, levelMeterYMaxDb: newMax }
          : { loudnessYMinDb: newMin, loudnessYMaxDb: newMax };
        onPanelControlsChange?.(
          normalizePanelControls({ ...normalizedPanelControls, ...rangeKeys })
        );
      },
      [isPeakFamily, normalizedPanelControls, onPanelControlsChange]
    ),
  });
  const { trackRef: levelMeterTrackRef, metrics: levelMeterTrackMetrics } = useAxisTrackMetrics();
  const levelMeterTicks = buildAdaptiveDbTicks(
    levelMeterYRange.min,
    levelMeterYRange.max,
    levelMeterYAxis.axisPx
  );
  const liveLevelValue = displayAudio?.[modeMeta.field];
  const playbackMaxValue = useLevelMeterPlaybackMax({
    enabled: !isPeakFamily && showPlaybackMax,
    mode: levelMeterMode,
    value: liveLevelValue,
    displayAudio,
  });
  const channels = getPeakChannels(displayAudio, peakLabelContext, isRms ? "rmsDb" : "peakDb");
  const channelValues = useMemo(() => channels.map((channel) => channel.valueDb), [channels]);
  const rmsPlaybackMaxValues = useLevelMeterPlaybackMaxChannels({
    enabled: isRms && showPlaybackMax,
    mode: levelMeterMode,
    values: channelValues,
  });

  if (!isPeakFamily) {
    const readoutValue = showPlaybackMax ? playbackMaxValue : liveLevelValue;
    const showMarker = showLevelValueMarker && Number.isFinite(readoutValue);
    // The metric's own rules as its Stats row judges them, plus its Max ceilings as the bar colour
    // at the marker does -- see levelMeterMarkerStatus.
    const markerStatus = levelMeterMarkerStatus(
      loudnessProfileDocument,
      levelMeterMode,
      readoutValue
    );
    const yAxisWidthClass = showMarker ? LEVEL_METER_Y_AXIS_WITH_MARKER : W_PEAK_TICKS;
    return (
      <div
        className={cn(
          PANEL_MIN_PEAK,
          "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div data-level-meter-grid className={cn(LEVEL_METER_GRID, PANEL_MIN_PEAK)}>
            <AxisRail
              axis="y"
              inset
              data-level-meter-y-axis
              scaleProps={{ "data-level-meter-y-axis-scale": true, ref: levelMeterTrackRef }}
              className={cn(yAxisWidthClass, "min-h-0 h-full shrink-0 overflow-visible text-right")}
              interaction={levelMeterYAxis}
              ticks={levelMeterAxisTicks(
                levelMeterTicks,
                levelMeterYRange,
                showMarker ? axisMarkerPlacement(readoutValue, levelMeterYRange) : null,
                levelMeterTrackMetrics
              )}
            >
              {showMarker ? (
                <AxisValueMarker
                  value={readoutValue}
                  yRange={levelMeterYRange}
                  className={loudnessMeterMarkerClass(markerStatus, profileActive)}
                />
              ) : null}
            </AxisRail>
            <div data-level-meter-bar-region className="grid grid-cols-[minmax(0,1fr)]">
              <div className="@container relative h-full min-h-0 p-0">
                <div
                  data-level-meter-bar-fill
                  data-level-meter-fill-value={formatLevelValue(liveLevelValue)}
                  className="absolute inset-x-[var(--ui-level-meter-bar-inset-x)] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]"
                  style={{
                    "--ui-level-meter-bar-inset-x": LEVEL_METER_BAR_INSET_X,
                  }}
                >
                  <AnimatedLevelFill
                    value={liveLevelValue}
                    min={levelMeterYRange.min}
                    max={levelMeterYRange.max}
                    fromTopFrac={(v) =>
                      rangedFromTopFrac(v, levelMeterYRange.min, levelMeterYRange.max)
                    }
                    background={fillBackground}
                  />
                </div>
                <div
                  data-level-value
                  className={cn(
                    "@max-[48px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] justify-center text-[length:var(--ui-fs-display)]",
                    showMarker ? "hidden" : "flex"
                  )}
                >
                  <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-[color:var(--ui-text-annotation)]">
                    {formatLevelValue(readoutValue)}
                  </span>
                </div>
                <div
                  data-level-mode-label
                  className="@max-[24px]:hidden absolute inset-x-0 bottom-[var(--ui-chart-inset-bottom)] text-center text-[length:var(--ui-fs-display)] text-[color:var(--ui-text-annotation)]"
                >
                  {modeMeta.meterLabel ?? modeMeta.label}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const showTpMaxMarker = isPeak && showTpMaxMarkerSetting && hasTpMaxValue;
  // The marker follows the active Loudness Profile rather than holding a second opinion about
  // what counts as too hot. Evaluating through the shared rule engine is what keeps the two
  // from drifting; with no profile there is no limit, so the readout keeps its accent colour.
  const tpMaxStatus = loudnessProfileEvaluate(loudnessProfileDocument, {
    values: { truePeak: displayAudio?.tpMax },
  }).truePeak;
  const peakYAxisWidthClass =
    isPeak && showTpMaxMarkerSetting ? LEVEL_METER_Y_AXIS_WITH_MARKER : W_PEAK_TICKS;
  return (
    <div
      className={cn(
        PANEL_MIN_PEAK,
        "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div data-level-meter-grid className={cn(LEVEL_METER_GRID, PANEL_MIN_PEAK)}>
          <AxisRail
            axis="y"
            inset
            data-level-meter-y-axis
            scaleProps={{ "data-level-meter-y-axis-scale": true, ref: levelMeterTrackRef }}
            className={cn(
              peakYAxisWidthClass,
              "min-h-0 h-full shrink-0 overflow-visible text-right"
            )}
            interaction={levelMeterYAxis}
            ticks={levelMeterAxisTicks(
              levelMeterTicks,
              levelMeterYRange,
              showTpMaxMarker ? axisMarkerPlacement(displayAudio?.tpMax, levelMeterYRange) : null,
              levelMeterTrackMetrics
            )}
          >
            {showTpMaxMarker ? (
              <AxisValueMarker
                value={displayAudio?.tpMax}
                yRange={levelMeterYRange}
                dataAttribute="data-level-tp-max-marker"
                className={loudnessMeterMarkerClass(tpMaxStatus, profileActive)}
                onReset={onResetTpMax}
                resetLabel="Click to reset TP Max"
              />
            ) : null}
          </AxisRail>
          <div
            data-level-meter-bar-region
            data-level-meter-channel-grid
            className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-[var(--ui-level-meter-channel-gap)]"
            style={{
              "--ui-level-meter-channel-gap": LEVEL_METER_CHANNEL_GAP,
            }}
          >
            {channels.map((c, idx) => {
              const readoutValue =
                isRms && showPlaybackMax && Number.isFinite(rmsPlaybackMaxValues[idx])
                  ? rmsPlaybackMaxValues[idx]
                  : c.valueDb;
              return (
                <div key={`${idx}-${c.label}`} className="@container relative h-full min-h-0 p-0">
                  <div
                    data-level-meter-bar-fill
                    data-level-meter-fill-value={formatLevelValue(c.valueDb)}
                    className="absolute inset-x-[var(--ui-level-meter-bar-inset-x)] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]"
                    style={{
                      "--ui-level-meter-bar-inset-x": LEVEL_METER_BAR_INSET_X,
                    }}
                  >
                    <AnimatedPeakFill
                      dbValue={c.valueDb}
                      yRange={levelMeterYRange}
                      background={fillBackground}
                    />
                  </div>
                  <div
                    data-peak-value
                    className="@max-[48px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] flex justify-center text-[length:var(--ui-fs-display)]"
                  >
                    <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-[color:var(--ui-text-annotation)]">
                      {formatLevelValue(readoutValue)}
                    </span>
                  </div>
                  <div
                    data-peak-channel-label
                    className="@max-[24px]:hidden absolute inset-x-0 bottom-[var(--ui-chart-inset-bottom)] text-center text-[length:var(--ui-fs-display)] text-[color:var(--ui-text-annotation)]"
                  >
                    {c.label}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
