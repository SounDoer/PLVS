import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrameData, usePanelInstanceData } from "../../workspace/AudioDataContext.jsx";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";
import { useHoverTip } from "@/components/HoverTip";
import { PANEL_MIN_PEAK, W_PEAK_TICKS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
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

const LEVEL_MODE_META = {
  peak: { label: "Peak", unit: "dBFS" },
  rms: { label: "RMS", unit: "dBFS", field: "rmsDb" },
  momentary: { label: "Momentary", meterLabel: "M", unit: "LUFS", field: "momentary" },
  shortTerm: { label: "Short-term", meterLabel: "ST", unit: "LUFS", field: "shortTerm" },
};

const LEVEL_METER_VALUE_MARKER_POSITION = {
  start: "top-0",
  middle: "-translate-y-1/2",
  end: "bottom-0",
};

const LEVEL_METER_VALUE_MARKER_BASE =
  "absolute left-0 whitespace-nowrap text-left font-[family-name:var(--ui-font-mono)] text-[length:var(--ui-fs-display)] leading-none tabular-nums";
const LEVEL_METER_Y_AXIS_WITH_MARKER = "w-[5ch]";
const LEVEL_METER_BAR_INSET_X = "0.1rem";
const LEVEL_METER_CHANNEL_GAP = "0.15rem";
const PLAYBACK_SIGNAL_FLOOR_DB = -70;
const PLAYBACK_SILENCE_HOLD_MS = 350;
const LEVEL_METER_GRID =
  "grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-[var(--ui-chart-axis-gap)]";

function levelMeterValueMarkerClass(position) {
  return `${LEVEL_METER_VALUE_MARKER_BASE} ${LEVEL_METER_VALUE_MARKER_POSITION[position]}`;
}

function AnimatedLevelFill({ value, min, max, fromTopFrac }) {
  const reduceMotion = useReducedMotion();
  const clamped = Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : null;
  const clipTopFrac = clamped != null ? fromTopFrac(clamped) : 1;
  const targetScaleY = Math.max(0, Math.min(1, 1 - clipTopFrac));
  const spring = useSpring(targetScaleY, {
    stiffness: reduceMotion ? 8000 : 520,
    damping: reduceMotion ? 120 : 42,
    mass: reduceMotion ? 0.08 : 0.35,
  });

  useEffect(() => {
    spring.set(targetScaleY);
  }, [spring, targetScaleY]);

  if (clamped == null) return null;

  return (
    <div className="absolute inset-0 overflow-hidden">
      <motion.div
        className="meter-gradient absolute inset-0 will-change-transform"
        style={{ scaleY: spring, transformOrigin: "bottom" }}
      />
    </div>
  );
}

function AnimatedPeakFill({ dbValue, yRange }) {
  return (
    <AnimatedLevelFill
      value={dbValue}
      min={yRange.min}
      max={yRange.max}
      fromTopFrac={(v) => rangedFromTopFrac(v, yRange.min, yRange.max)}
    />
  );
}

function formatLevelValue(value) {
  return fmtMetric(value);
}

function hasPlaybackSignal(displayAudio) {
  const peakDb = displayAudio?.peakDb;
  if (Array.isArray(peakDb)) {
    return peakDb.some((v) => Number.isFinite(v) && v > PLAYBACK_SIGNAL_FLOOR_DB);
  }
  return false;
}

function hasValueSignal(values) {
  if (Array.isArray(values)) {
    return values.some((v) => Number.isFinite(v) && v > PLAYBACK_SIGNAL_FLOOR_DB);
  }
  return Number.isFinite(values) && values > PLAYBACK_SIGNAL_FLOOR_DB;
}

function usePlaybackMaxReadout({ enabled, mode, value, displayAudio }) {
  const [playbackMax, setPlaybackMax] = useState(-Infinity);
  const trackerRef = useRef({
    mode,
    active: false,
    silentSince: null,
    playbackMax: -Infinity,
  });

  const signalKey = Array.isArray(displayAudio?.peakDb) ? displayAudio.peakDb.join("|") : "";

  useEffect(() => {
    const tracker = trackerRef.current;
    if (tracker.mode !== mode) {
      tracker.mode = mode;
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = -Infinity;
      setPlaybackMax(-Infinity);
    }

    if (!enabled) {
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = -Infinity;
      setPlaybackMax(-Infinity);
      return;
    }

    const now = Date.now();
    const audible = hasPlaybackSignal(displayAudio);
    const silenceElapsed =
      tracker.silentSince != null && now - tracker.silentSince >= PLAYBACK_SILENCE_HOLD_MS;

    if (audible) {
      const startsNewPlayback = !tracker.active || silenceElapsed;
      tracker.active = true;
      tracker.silentSince = null;
      const nextMax = startsNewPlayback
        ? value
        : Number.isFinite(value)
          ? Math.max(tracker.playbackMax, value)
          : tracker.playbackMax;
      tracker.playbackMax = Number.isFinite(nextMax) ? nextMax : -Infinity;
      setPlaybackMax(tracker.playbackMax);
      return;
    }

    if (tracker.active && tracker.silentSince == null) {
      tracker.silentSince = now;
    }
  }, [displayAudio, enabled, mode, signalKey, value]);

  return playbackMax;
}

function usePlaybackMaxChannels({ enabled, mode, values }) {
  const [playbackMax, setPlaybackMax] = useState([]);
  const trackerRef = useRef({
    mode,
    active: false,
    silentSince: null,
    playbackMax: [],
  });

  const valuesKey = Array.isArray(values) ? values.join("|") : "";

  useEffect(() => {
    const tracker = trackerRef.current;
    if (tracker.mode !== mode) {
      tracker.mode = mode;
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = [];
      setPlaybackMax([]);
    }

    if (!enabled) {
      tracker.active = false;
      tracker.silentSince = null;
      tracker.playbackMax = [];
      setPlaybackMax([]);
      return;
    }

    const now = Date.now();
    const hasSignal = hasValueSignal(values);
    const silenceElapsed =
      tracker.silentSince != null && now - tracker.silentSince >= PLAYBACK_SILENCE_HOLD_MS;
    if (hasSignal) {
      const startsNewPlayback = !tracker.active || silenceElapsed;
      tracker.active = true;
      tracker.silentSince = null;
      const next = values.map((value, index) => {
        if (startsNewPlayback) {
          return Number.isFinite(value) ? value : -Infinity;
        }
        const previous = Number.isFinite(tracker.playbackMax[index])
          ? tracker.playbackMax[index]
          : -Infinity;
        return Number.isFinite(value) ? Math.max(previous, value) : previous;
      });
      const changed =
        next.length !== tracker.playbackMax.length ||
        next.some((value, index) => !Object.is(value, tracker.playbackMax[index]));
      tracker.playbackMax = next;
      if (changed) setPlaybackMax(next);
      return;
    } else if (tracker.active) {
      if (tracker.silentSince == null) {
        tracker.silentSince = now;
      } else if (silenceElapsed) {
        tracker.active = false;
        tracker.silentSince = null;
        tracker.playbackMax = [];
        setPlaybackMax([]);
      }
    }
  }, [enabled, mode, valuesKey]);

  return playbackMax;
}

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
  if (!Number.isFinite(value) || value < yRange.min || value > yRange.max) return null;

  // Stops the click from reaching the y-axis drag/zoom handlers underneath.
  const stopAxisInteraction = onReset ? (e) => e.stopPropagation() : undefined;

  return (
    <span
      {...{ [dataAttribute]: "" }}
      ref={onReset ? anchorRef : undefined}
      className={cn(
        onReset ? "pointer-events-auto cursor-pointer" : "pointer-events-none",
        "z-10 font-semibold text-primary",
        levelMeterValueMarkerClass("middle"),
        className
      )}
      style={{ top: `${rangedFromTopFrac(value, yRange.min, yRange.max) * 100}%` }}
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
      {onReset ? tipNode : null}
    </span>
  );
}

export function LevelMeterPanel() {
  const { displayAudio, peakLabelContext, hasTpMaxValue, onResetTpMax } = useFrameData();
  const { panelControls, onPanelControlsChange } = usePanelInstanceData();
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
  const levelMeterTicks = buildAdaptiveDbTicks(
    levelMeterYRange.min,
    levelMeterYRange.max,
    levelMeterYAxis.axisPx
  );
  const liveLevelValue = displayAudio?.[modeMeta.field];
  const playbackMaxValue = usePlaybackMaxReadout({
    enabled: !isPeakFamily && showPlaybackMax,
    mode: levelMeterMode,
    value: liveLevelValue,
    displayAudio,
  });
  const channels = getPeakChannels(displayAudio, peakLabelContext, isRms ? "rmsDb" : "peakDb");
  const channelValues = useMemo(() => channels.map((channel) => channel.valueDb), [channels]);
  const rmsPlaybackMaxValues = usePlaybackMaxChannels({
    enabled: isRms && showPlaybackMax,
    mode: levelMeterMode,
    values: channelValues,
  });

  if (!isPeakFamily) {
    const readoutValue = showPlaybackMax ? playbackMaxValue : liveLevelValue;
    const showMarker = showLevelValueMarker && Number.isFinite(readoutValue);
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
            <div
              data-level-meter-y-axis
              ref={levelMeterYAxis.axisRef}
              {...levelMeterYAxis.axisHandlers}
              style={{ cursor: levelMeterYAxis.cursorStyle }}
              className={cn(
                yAxisWidthClass,
                "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
                levelMeterYAxis.isActive && "text-foreground"
              )}
            >
              <div
                data-level-meter-y-axis-scale
                className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]"
              >
                {levelMeterTicks.map(({ v, lb }, i) => {
                  if (i === 0) {
                    return (
                      <span key={v} className={axisLabelClass("y", "start")}>
                        {lb}
                      </span>
                    );
                  }
                  if (i === levelMeterTicks.length - 1) {
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
                        top: `${rangedFromTopFrac(v, levelMeterYRange.min, levelMeterYRange.max) * 100}%`,
                      }}
                    >
                      {lb}
                    </span>
                  );
                })}
                {showMarker ? (
                  <AxisValueMarker value={readoutValue} yRange={levelMeterYRange} />
                ) : null}
              </div>
            </div>
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
                  />
                </div>
                <div
                  data-level-value
                  className={cn(
                    "@max-[48px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] justify-center text-[length:var(--ui-fs-display)]",
                    showMarker ? "hidden" : "flex"
                  )}
                >
                  <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-muted-foreground">
                    {formatLevelValue(readoutValue)}
                  </span>
                </div>
                <div
                  data-level-mode-label
                  className="@max-[24px]:hidden absolute inset-x-0 bottom-[var(--ui-chart-inset-bottom)] text-center text-[length:var(--ui-fs-display)] text-muted-foreground"
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
          <div
            data-level-meter-y-axis
            ref={levelMeterYAxis.axisRef}
            {...levelMeterYAxis.axisHandlers}
            style={{ cursor: levelMeterYAxis.cursorStyle }}
            className={cn(
              peakYAxisWidthClass,
              "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis)] text-muted-foreground transition-colors hover:bg-[color:color-mix(in_srgb,var(--muted)_34%,transparent)]",
              levelMeterYAxis.isActive && "text-foreground"
            )}
          >
            <div
              data-level-meter-y-axis-scale
              className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]"
            >
              {levelMeterTicks.map(({ v, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={v} className={axisLabelClass("y", "start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === levelMeterTicks.length - 1) {
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
                      top: `${rangedFromTopFrac(v, levelMeterYRange.min, levelMeterYRange.max) * 100}%`,
                    }}
                  >
                    {lb}
                  </span>
                );
              })}
              {showTpMaxMarker ? (
                <AxisValueMarker
                  value={displayAudio?.tpMax}
                  yRange={levelMeterYRange}
                  dataAttribute="data-level-tp-max-marker"
                  className="text-[color:var(--ui-signal-tp-max)]"
                  onReset={onResetTpMax}
                  resetLabel="Click to reset TP Max"
                />
              ) : null}
            </div>
          </div>
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
                    <AnimatedPeakFill dbValue={c.valueDb} yRange={levelMeterYRange} />
                  </div>
                  <div
                    data-peak-value
                    className="@max-[48px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] flex justify-center text-[length:var(--ui-fs-display)]"
                  >
                    <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-muted-foreground">
                      {formatLevelValue(readoutValue)}
                    </span>
                  </div>
                  <div
                    data-peak-channel-label
                    className="@max-[24px]:hidden absolute inset-x-0 bottom-[var(--ui-chart-inset-bottom)] text-center text-[length:var(--ui-fs-display)] text-muted-foreground"
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
