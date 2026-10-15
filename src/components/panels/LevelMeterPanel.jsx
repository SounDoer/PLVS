import { usePanelPresentation } from "../../workspace/AudioDataContext.jsx";
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
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
import { fitHorizontalTicks } from "../../lib/fitHorizontalTicks.js";
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
const LEVEL_METER_READOUT_SIZE = "text-[length:min(var(--ui-fs-display),28cqw)]";
const LEVEL_METER_CHANNEL_LABEL =
  "min-w-0 truncate font-[family-name:var(--ui-font-sans)] text-[length:var(--ui-fs-axis)] leading-none text-[color:var(--ui-text-annotation)]";
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
function AnimatedLevelFill({
  value,
  min,
  max,
  fromTopFrac,
  background,
  horizontal = false,
  reversed = false,
}) {
  const reduceMotion = useReducedMotion();
  const clamped = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : null;
  const clipTopFrac = clamped != null ? fromTopFrac(clamped) : 1;
  const targetScaleY = Math.max(0, Math.min(1, 1 - clipTopFrac));
  const spring = useSpring(targetScaleY, {
    stiffness: reduceMotion ? 8000 : 520,
    damping: reduceMotion ? 120 : 42,
    mass: reduceMotion ? 0.08 : 0.35,
  });
  const clipPath = useTransform(spring, (scale) =>
    horizontal
      ? reversed
        ? `inset(0 0 0 ${(1 - scale) * 100}%)`
        : `inset(0 ${(1 - scale) * 100}% 0 0)`
      : reversed
        ? `inset(0 0 ${(1 - scale) * 100}% 0)`
        : `inset(${(1 - scale) * 100}% 0 0 0)`
  );

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

function AnimatedPeakFill({ dbValue, yRange, background, reversed }) {
  return (
    <AnimatedLevelFill
      reversed={reversed}
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
function axisMarkerPlacement(value, yRange, reversed = false) {
  if (!Number.isFinite(value) || formatLevelValue(value) === "-") return null;
  const clamped = Math.max(yRange.min, Math.min(yRange.max, value));
  const frac = rangedFromTopFrac(clamped, yRange.min, yRange.max);
  return {
    frac: reversed ? 1 - frac : frac,
    position: clamped === value ? "middle" : value > yRange.max !== reversed ? "start" : "end",
  };
}

/// Measures axis tracks for marker fading and horizontal text collision avoidance. Both label kinds are
/// `leading-none`, so each is exactly as tall as its font size; reading those off the track keeps
/// the fade in step with the interface size setting. Pass `trackRef` as the track's ref.
function useAxisTrackMetrics(axis = "y", labels = "") {
  const [track, trackRef] = useState(null);
  const [metrics, setMetrics] = useState(null);

  useLayoutEffect(() => {
    if (!track) return undefined;
    const measure = () => {
      const style = getComputedStyle(track);
      const trackPx = track.getBoundingClientRect()[axis === "x" ? "width" : "height"];
      const labelWidth = Math.max(
        0,
        ...Array.from(track.querySelectorAll("span")).map(
          (label) => label.getBoundingClientRect().width
        )
      );
      const tickPx = parseFloat(style.fontSize);
      const markerPx = parseFloat(style.getPropertyValue("--ui-fs-display"));
      if (!(trackPx > 0 && tickPx > 0 && markerPx > 0)) return;
      setMetrics((prev) =>
        prev?.trackPx === trackPx &&
        prev.tickPx === tickPx &&
        prev.markerPx === markerPx &&
        prev.labelWidth === labelWidth
          ? prev
          : { trackPx, tickPx, markerPx, labelWidth }
      );
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    // A font size change also resizes the track: the rail it fills is sized in `ch`.
    const ro = new ResizeObserver(measure);
    ro.observe(track);
    return () => ro.disconnect();
  }, [track, axis, labels]);

  return { trackRef, metrics };
}

/// The marker shares the ticks' right-aligned column, so a tick near the reading would print
/// underneath it. Those ticks fade by how far they clear the marker -- continuously, so a live
/// reading drifting around a tick never makes it blink.
function levelMeterAxisTicks(ticks, yRange, marker, metrics, reversed = false) {
  const markerCenterPx =
    marker && metrics
      ? axisLabelCenterPx(marker.position, marker.frac, metrics.trackPx, metrics.markerPx)
      : null;
  return ticks.map(({ v, lb }, index) => {
    const topFrac = rangedFromTopFrac(v, yRange.min, yRange.max);
    const frac = reversed ? 1 - topFrac : topFrac;
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
 *   reversed?: boolean,
 *   yRange: { min: number, max: number },
 *   dataAttribute?: string,
 *   className: string,
 *   loudnessStatus?: string,
 *   onReset?: (...args: any[]) => any,
 *   resetLabel?: string,
 * }} props
 */
function AxisValueMarker({
  reversed = false,
  value,
  yRange,
  dataAttribute = "data-level-value-marker",
  className,
  loudnessStatus,
  onReset,
  resetLabel,
}) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: onReset ? resetLabel : undefined,
    side: "bottom",
  });
  const placement = axisMarkerPlacement(value, yRange, reversed);
  if (!placement) return null;
  const { frac, position } = placement;
  const outOfRange = position !== "middle";

  // Stops the click from reaching the y-axis drag/zoom handlers underneath.
  const stopAxisInteraction = onReset ? (e) => e.stopPropagation() : undefined;

  return (
    <span
      {...{ [dataAttribute]: "" }}
      data-loudness-status={loudnessStatus}
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
          {value > yRange.max !== reversed ? "▲" : "▼"}
        </span>
      ) : null}
      {onReset ? tipNode : null}
    </span>
  );
}

/** @param {{compact?: boolean, showAxes?: boolean, className?: string}} props */
export function LevelMeterPanel({ showAxes: axesOverride, className } = {}) {
  const { showAxes, fitContainer } = usePanelPresentation(axesOverride);
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
  const direction = normalizedPanelControls.levelMeterOrientation;
  const horizontal = direction === "left-to-right" || direction === "right-to-left";
  const reversed = direction === "right-to-left" || direction === "top-to-bottom";
  const fillBackground = levelMeterBackground({
    direction: horizontal ? (reversed ? "to left" : "to right") : reversed ? "to bottom" : "to top",
    mode: levelMeterMode,
    controls: normalizedPanelControls,
    profileDocument: loudnessProfileDocument,
    viewMin: levelMeterYRange.min,
    viewMax: levelMeterYRange.max,
  });
  const levelMeterYAxis = useAxisInteraction({
    axis: "y",
    reversed,
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

  if (horizontal)
    return (
      <HorizontalLevelMeter
        {...{
          showAxes,
          className,
          displayAudio,
          hasTpMaxValue,
          onResetTpMax,
          normalizedPanelControls,
          onPanelControlsChange,
          channels,
          rmsPlaybackMaxValues,
          playbackMaxValue,
          liveLevelValue,
          modeMeta,
          isPeak,
          isRms,
          isPeakFamily,
          levelMeterYRange,
          modeDefaults,
          fillBackground,
          loudnessProfileDocument,
          profileActive,
        }}
      />
    );

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
    const yAxisWidthClass = showMarker
      ? LEVEL_METER_Y_AXIS_WITH_MARKER
      : showAxes
        ? W_PEAK_TICKS
        : "w-0";
    return (
      <div
        className={cn(
          !fitContainer && PANEL_MIN_PEAK,
          "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
          className
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div
            data-level-meter-grid
            className={cn(
              LEVEL_METER_GRID,
              !fitContainer && PANEL_MIN_PEAK,
              !showAxes && !showMarker && "gap-x-0"
            )}
          >
            <AxisRail
              axis="y"
              inset
              data-level-meter-y-axis
              scaleProps={{ "data-level-meter-y-axis-scale": true, ref: levelMeterTrackRef }}
              className={cn(yAxisWidthClass, "min-h-0 h-full shrink-0 overflow-visible text-right")}
              interaction={showAxes ? levelMeterYAxis : undefined}
              ticks={
                showAxes
                  ? levelMeterAxisTicks(
                      levelMeterTicks,
                      levelMeterYRange,
                      showMarker
                        ? axisMarkerPlacement(readoutValue, levelMeterYRange, reversed)
                        : null,
                      levelMeterTrackMetrics,
                      reversed
                    )
                  : []
              }
            >
              {showMarker ? (
                <AxisValueMarker
                  reversed={reversed}
                  value={readoutValue}
                  yRange={levelMeterYRange}
                  className={loudnessMeterMarkerClass(markerStatus, profileActive)}
                  loudnessStatus={profileActive ? (markerStatus ?? "neutral") : "off"}
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
                    reversed={reversed}
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
                    "@max-[48px]:hidden absolute inset-x-0 justify-center text-[length:var(--ui-fs-display)]",
                    reversed
                      ? "bottom-[var(--ui-meter-label-top-inset)]"
                      : "top-[var(--ui-meter-label-top-inset)]",
                    showMarker ? "hidden" : "flex"
                  )}
                >
                  <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-[color:var(--ui-text-annotation)]">
                    {formatLevelValue(readoutValue)}
                  </span>
                </div>
              </div>
            </div>
            {showAxes && (
              <div data-level-meter-channel-axis className="col-start-2">
                <div data-level-mode-label className={cn(LEVEL_METER_CHANNEL_LABEL, "text-center")}>
                  {modeMeta.meterLabel ?? modeMeta.label}
                </div>
              </div>
            )}
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
    isPeak && showTpMaxMarkerSetting
      ? LEVEL_METER_Y_AXIS_WITH_MARKER
      : showAxes
        ? W_PEAK_TICKS
        : "w-0";
  return (
    <div
      className={cn(
        !fitContainer && PANEL_MIN_PEAK,
        "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]",
        className
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          data-level-meter-grid
          className={cn(
            LEVEL_METER_GRID,
            !fitContainer && PANEL_MIN_PEAK,
            !showAxes && !(isPeak && showTpMaxMarkerSetting) && "gap-x-0"
          )}
        >
          <AxisRail
            axis="y"
            inset
            data-level-meter-y-axis
            scaleProps={{ "data-level-meter-y-axis-scale": true, ref: levelMeterTrackRef }}
            className={cn(
              peakYAxisWidthClass,
              "min-h-0 h-full shrink-0 overflow-visible text-right"
            )}
            interaction={showAxes ? levelMeterYAxis : undefined}
            ticks={
              showAxes
                ? levelMeterAxisTicks(
                    levelMeterTicks,
                    levelMeterYRange,
                    showTpMaxMarker
                      ? axisMarkerPlacement(displayAudio?.tpMax, levelMeterYRange, reversed)
                      : null,
                    levelMeterTrackMetrics,
                    reversed
                  )
                : []
            }
          >
            {showTpMaxMarker ? (
              <AxisValueMarker
                reversed={reversed}
                value={displayAudio?.tpMax}
                yRange={levelMeterYRange}
                dataAttribute="data-level-tp-max-marker"
                className={loudnessMeterMarkerClass(tpMaxStatus, profileActive)}
                loudnessStatus={profileActive ? (tpMaxStatus ?? "neutral") : "off"}
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
                      reversed={reversed}
                      dbValue={c.valueDb}
                      yRange={levelMeterYRange}
                      background={fillBackground}
                    />
                  </div>
                  <div
                    data-peak-value
                    className={cn(
                      "absolute inset-x-0 flex justify-center",
                      reversed
                        ? "bottom-[var(--ui-meter-label-top-inset)]"
                        : "top-[var(--ui-meter-label-top-inset)]",
                      LEVEL_METER_READOUT_SIZE
                    )}
                  >
                    <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-[color:var(--ui-text-annotation)]">
                      {formatLevelValue(readoutValue)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          {showAxes && (
            <div
              data-level-meter-channel-axis
              className="col-start-2 grid grid-cols-[repeat(auto-fit,minmax(0,1fr))]"
              style={{ gap: LEVEL_METER_CHANNEL_GAP }}
            >
              {channels.map((channel, index) => (
                <div
                  key={index}
                  data-peak-channel-label
                  title={channel.label}
                  className={cn(LEVEL_METER_CHANNEL_LABEL, "text-center")}
                >
                  {channel.label}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HorizontalLevelMeter({
  showAxes,
  className,
  displayAudio,
  hasTpMaxValue,
  onResetTpMax,
  normalizedPanelControls: controls,
  onPanelControlsChange,
  channels,
  rmsPlaybackMaxValues,
  playbackMaxValue,
  liveLevelValue,
  modeMeta,
  isPeak,
  isRms,
  isPeakFamily,
  levelMeterYRange: range,
  modeDefaults,
  fillBackground,
  loudnessProfileDocument,
  profileActive,
}) {
  const reversed = controls.levelMeterOrientation === "right-to-left";
  const axis = useAxisInteraction({
    reversed,
    axis: "x",
    min: range.min,
    max: range.max,
    absMin: modeDefaults.min,
    absMax: modeDefaults.max,
    defaultMin: modeDefaults.min,
    defaultMax: modeDefaults.max,
    minSpan: 12,
    scale: "linear",
    onRangeChange: (min, max) =>
      onPanelControlsChange?.(
        normalizePanelControls({
          ...controls,
          ...(isPeakFamily
            ? { levelMeterYMinDb: min, levelMeterYMaxDb: max }
            : { loudnessYMinDb: min, loudnessYMaxDb: max }),
        })
      ),
  });
  const candidates = buildAdaptiveDbTicks(range.min, range.max, axis.axisPx).map(({ v, lb }) => ({
    key: v,
    label: lb,
    frac: reversed
      ? 1 - (v - range.min) / (range.max - range.min)
      : (v - range.min) / (range.max - range.min),
  }));
  const { trackRef, metrics } = useAxisTrackMetrics(
    "x",
    candidates.map((tick) => tick.label).join(",")
  );
  const ticks = metrics
    ? fitHorizontalTicks(candidates, metrics.trackPx, metrics.labelWidth, metrics.tickPx / 2)
    : candidates;
  const rows = isPeakFamily ? channels : [{ label: modeMeta.meterLabel, valueDb: liveLevelValue }];
  const value = isPeak
    ? displayAudio?.tpMax
    : controls.levelMeterPlaybackMax
      ? playbackMaxValue
      : liveLevelValue;
  const marker = isPeak
    ? controls.levelMeterTpMaxMarker && hasTpMaxValue
    : !isRms && controls.levelMeterValueMarker;
  const placement = marker ? axisMarkerPlacement(value, range) : null;
  const status = levelMeterMarkerStatus(
    loudnessProfileDocument,
    isPeak ? "truePeak" : controls.levelMeterMode,
    value
  );
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip: isPeak && marker ? "Click to reset TP Max" : undefined,
    side: "top",
  });
  const [markerWidth, setMarkerWidth] = useState(0);
  const markerVisible = placement != null;
  useLayoutEffect(() => {
    const element = anchorRef.current;
    if (!element) return;
    const measure = () => setMarkerWidth(Math.ceil(element.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver !== "function") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [anchorRef, markerVisible]);
  const markerPercent = placement ? (reversed ? placement.frac : 1 - placement.frac) * 100 : 0;
  return (
    <div
      style={{
        "--level-label-rail": showAxes ? "var(--ui-chart-y-axis-rail-w)" : "0px",
        columnGap: showAxes ? undefined : 0,
      }}
      data-level-meter-orientation={controls.levelMeterOrientation}
      className={cn(
        "grid min-h-0 min-w-0 flex-1 grid-cols-[var(--level-label-rail)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-x-[var(--ui-chart-axis-gap)] overflow-hidden px-[var(--ui-panel-pad-x)] py-[var(--ui-panel-pad-y)]",
        className
      )}
    >
      <div
        data-level-meter-horizontal-rows
        className="col-span-2 grid min-h-0 grid-cols-subgrid auto-rows-[minmax(1.25rem,1fr)] gap-y-[var(--ui-chart-axis-gap)] overflow-y-auto"
      >
        {rows.map((row, i) => (
          <Fragment key={i}>
            <div className="flex min-w-0 items-center justify-end">
              {showAxes && (
                <span data-level-meter-channel-axis>
                  <span
                    data-peak-channel-label={isPeakFamily ? "" : undefined}
                    data-level-mode-label={!isPeakFamily ? "" : undefined}
                    title={row.label}
                    className={LEVEL_METER_CHANNEL_LABEL}
                  >
                    {row.label}
                  </span>
                </span>
              )}
            </div>
            <div className="@container relative min-h-5 min-w-0" data-level-meter-bar-region>
              <AnimatedLevelFill
                horizontal
                reversed={reversed}
                value={row.valueDb}
                min={range.min}
                max={range.max}
                fromTopFrac={(v) => rangedFromTopFrac(v, range.min, range.max)}
                background={fillBackground}
              />
              <div
                className={cn(
                  "relative flex h-full items-center px-1 text-[length:var(--ui-fs-axis)] text-[color:var(--ui-text-annotation)]",
                  reversed ? "justify-start" : "justify-end"
                )}
              >
                <span
                  className={cn(
                    "font-[family-name:var(--ui-font-mono)] tabular-nums",
                    LEVEL_METER_READOUT_SIZE
                  )}
                  data-level-value
                >
                  {formatLevelValue(
                    isRms &&
                      controls.levelMeterPlaybackMax &&
                      Number.isFinite(rmsPlaybackMaxValues[i])
                      ? rmsPlaybackMaxValues[i]
                      : !isPeakFamily && controls.levelMeterPlaybackMax
                        ? playbackMaxValue
                        : row.valueDb
                  )}
                </span>
              </div>
            </div>
          </Fragment>
        ))}
      </div>
      {placement && (
        <div
          className="@container relative col-start-2 h-[var(--ui-fs-display)] shrink-0"
          data-level-meter-horizontal-marker
        >
          <span
            role={isPeak ? "button" : undefined}
            tabIndex={isPeak ? 0 : undefined}
            onKeyDown={(event) => {
              if (isPeak && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onResetTpMax?.();
              }
            }}
            onClick={isPeak ? onResetTpMax : undefined}
            ref={anchorRef}
            onMouseEnter={isPeak ? showTip : undefined}
            onMouseLeave={isPeak ? hideTip : undefined}
            data-level-tp-max-marker={isPeak ? "" : undefined}
            data-loudness-status={profileActive ? (status ?? "neutral") : "off"}
            className={cn(
              "absolute whitespace-nowrap font-[family-name:var(--ui-font-mono)] text-[length:min(var(--ui-fs-display),20cqw)] leading-none tabular-nums",
              loudnessMeterMarkerClass(status, profileActive)
            )}
            style={{
              // Clamp the entire label, including an out-of-range arrow, before either edge.
              // The proportional transform is an in-bounds fallback before the first measurement.
              left: markerWidth
                ? `clamp(0px, calc(${markerPercent}% - ${markerWidth / 2}px), calc(100% - ${markerWidth}px))`
                : `${markerPercent}%`,
              transform: markerWidth ? undefined : `translateX(-${markerPercent}%)`,
            }}
          >
            {value < range.min && (
              <span aria-hidden="true" data-marker-out-of-range="below">
                {reversed ? "▶" : "◀"}
              </span>
            )}
            {formatLevelValue(value)}
            {value > range.max && (
              <span aria-hidden="true" data-marker-out-of-range="above">
                {reversed ? "◀" : "▶"}
              </span>
            )}
            {isPeak ? tipNode : null}
          </span>
        </div>
      )}
      {showAxes && (
        <AxisRail
          axis="x"
          className="col-start-2 h-[var(--ui-chart-x-axis-row-h)] shrink-0"
          interaction={axis}
          scaleProps={{ ref: trackRef }}
          ticks={ticks}
        />
      )}
    </div>
  );
}
