import { useCallback, useEffect, useMemo } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";
import { PANEL_METRIC_FOOTER, PANEL_MIN_PEAK, W_PEAK_TICKS } from "@/lib/shellLayout";
import {
  LOUDNESS_DB_MAX,
  LOUDNESS_DB_MIN,
  LOUDNESS_TICKS,
  PEAK_DB_MAX,
  PEAK_DB_MIN,
  PEAK_TICKS,
  buildAdaptiveDbTicks,
  rangedFromTopFrac,
} from "../../config/scales";
import { getPeakChannels } from "../../math/peakChannelMath";
import { normalizePanelControls } from "../../lib/panelControls.js";
import { useAxisInteraction } from "../../hooks/useAxisInteraction";

const LEVEL_MODE_META = {
  peak: { label: "Peak", unit: "dBFS" },
  momentary: { label: "M", unit: "LUFS", field: "momentary" },
  shortTerm: { label: "ST", unit: "LUFS", field: "shortTerm" },
};

const LEVEL_METER_Y_LABEL_POSITION = {
  start: "top-0",
  middle: "-translate-y-1/2",
  end: "bottom-0",
};

const LEVEL_METER_Y_LABEL_BASE =
  "absolute left-0 whitespace-nowrap text-left font-[family-name:var(--ui-font-mono)] leading-none tabular-nums";
const LEVEL_METER_Y_AXIS_WITH_MARKER = "w-[5ch]";
const LEVEL_METER_BAR_INSET_X = "0.1rem";
const LEVEL_METER_CHANNEL_GAP = "0.15rem";
const LEVEL_METER_GRID =
  "grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] grid-rows-[minmax(0,1fr)] gap-[var(--ui-chart-axis-gap)]";

function levelMeterYAxisLabelClass(position) {
  return `${LEVEL_METER_Y_LABEL_BASE} ${LEVEL_METER_Y_LABEL_POSITION[position]}`;
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
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

function CurrentValueMarker({ value, yRange }) {
  if (!Number.isFinite(value) || value < yRange.min) return null;

  return (
    <span
      data-level-value-marker
      className={cn(
        "pointer-events-none z-10 font-semibold text-primary",
        levelMeterYAxisLabelClass("middle")
      )}
      style={{ top: `${rangedFromTopFrac(value, yRange.min, yRange.max) * 100}%` }}
    >
      {formatLevelValue(value)}
    </span>
  );
}

export function LevelMeterPanel() {
  const {
    displayAudio,
    peakLabelContext,
    fmt,
    hasTpMaxValue,
    panelControls,
    tpMaxText,
    onPanelControlsChange,
  } = useAudioData();
  const normalizedPanelControls = useMemo(
    () => normalizePanelControls(panelControls),
    [panelControls]
  );
  const levelMeterMode = normalizedPanelControls.levelMeterMode;
  const showLevelValueMarker = normalizedPanelControls.levelMeterValueMarker;
  const modeMeta = LEVEL_MODE_META[levelMeterMode] ?? LEVEL_MODE_META.peak;
  const isPeak = levelMeterMode === "peak";
  // Peak mode keeps its own dBFS range; the loudness-family modes (M/ST) share the
  // LoudnessPanel's LUFS Y range so zooming one rescales the other.
  const modeDefaults = isPeak
    ? { min: PEAK_DB_MIN, max: PEAK_DB_MAX }
    : { min: LOUDNESS_DB_MIN, max: LOUDNESS_DB_MAX };
  const levelMeterYRange = isPeak
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
        const rangeKeys = isPeak
          ? { levelMeterYMinDb: newMin, levelMeterYMaxDb: newMax }
          : { loudnessYMinDb: newMin, loudnessYMaxDb: newMax };
        onPanelControlsChange?.(
          normalizePanelControls({ ...normalizedPanelControls, ...rangeKeys })
        );
      },
      [isPeak, normalizedPanelControls, onPanelControlsChange]
    ),
  });
  const isDefaultLevelMeterRange =
    levelMeterYRange.min === modeDefaults.min && levelMeterYRange.max === modeDefaults.max;
  const levelMeterTicks = isDefaultLevelMeterRange
    ? isPeak
      ? PEAK_TICKS
      : LOUDNESS_TICKS
    : buildAdaptiveDbTicks(levelMeterYRange.min, levelMeterYRange.max, levelMeterYAxis.axisPx);

  if (levelMeterMode !== "peak") {
    const levelValue = displayAudio?.[modeMeta.field];
    const showMarker = showLevelValueMarker && Number.isFinite(levelValue);
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
                "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis)] text-muted-foreground"
              )}
            >
              <div
                data-level-meter-y-axis-scale
                className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]"
              >
                {levelMeterTicks.map(({ v, lb }, i) => {
                  if (i === 0) {
                    return (
                      <span key={v} className={levelMeterYAxisLabelClass("start")}>
                        {lb}
                      </span>
                    );
                  }
                  if (i === levelMeterTicks.length - 1) {
                    return (
                      <span key={v} className={levelMeterYAxisLabelClass("end")}>
                        {lb}
                      </span>
                    );
                  }
                  return (
                    <span
                      key={v}
                      className={levelMeterYAxisLabelClass("middle")}
                      style={{
                        top: `${rangedFromTopFrac(v, levelMeterYRange.min, levelMeterYRange.max) * 100}%`,
                      }}
                    >
                      {lb}
                    </span>
                  );
                })}
                {showMarker ? (
                  <CurrentValueMarker value={levelValue} yRange={levelMeterYRange} />
                ) : null}
              </div>
            </div>
            <div data-level-meter-bar-region className="grid grid-cols-[minmax(0,1fr)]">
              <div className="relative h-full min-h-0 p-0">
                <div
                  data-level-meter-bar-fill
                  className="absolute inset-x-[var(--ui-level-meter-bar-inset-x)] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]"
                  style={{
                    "--ui-level-meter-bar-inset-x": LEVEL_METER_BAR_INSET_X,
                  }}
                >
                  <AnimatedLevelFill
                    value={levelValue}
                    min={levelMeterYRange.min}
                    max={levelMeterYRange.max}
                    fromTopFrac={(v) =>
                      rangedFromTopFrac(v, levelMeterYRange.min, levelMeterYRange.max)
                    }
                  />
                </div>
                <div
                  data-level-value
                  className="@max-[220px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] flex justify-center text-[length:var(--ui-fs-display)]"
                >
                  <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-muted-foreground">
                    {formatLevelValue(levelValue)}
                  </span>
                </div>
                <div
                  data-level-mode-label
                  className="@max-[220px]:hidden absolute inset-x-0 bottom-[var(--ui-chart-inset-bottom)] text-center text-[length:var(--ui-fs-display)] text-muted-foreground"
                >
                  {modeMeta.label}
                </div>
              </div>
            </div>
          </div>
          <div data-level-meter-footer className={PANEL_METRIC_FOOTER}>
            <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
              <span className="text-muted-foreground">{modeMeta.label}</span>
              <span
                className={cn(
                  "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold",
                  Number.isFinite(levelValue) ? "text-foreground" : "text-muted-foreground"
                )}
              >
                {formatLevelValue(levelValue)}
              </span>
              <span className="text-muted-foreground">{modeMeta.unit}</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const channels = getPeakChannels(displayAudio, peakLabelContext);
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
              W_PEAK_TICKS,
              "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis)] text-muted-foreground"
            )}
          >
            <div
              data-level-meter-y-axis-scale
              className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]"
            >
              {levelMeterTicks.map(({ v, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={v} className={levelMeterYAxisLabelClass("start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === levelMeterTicks.length - 1) {
                  return (
                    <span key={v} className={levelMeterYAxisLabelClass("end")}>
                      {lb}
                    </span>
                  );
                }
                return (
                  <span
                    key={v}
                    className={levelMeterYAxisLabelClass("middle")}
                    style={{
                      top: `${rangedFromTopFrac(v, levelMeterYRange.min, levelMeterYRange.max) * 100}%`,
                    }}
                  >
                    {lb}
                  </span>
                );
              })}
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
            {channels.map((c, idx) => (
              <div key={`${idx}-${c.label}`} className="relative h-full min-h-0 p-0">
                <div
                  data-level-meter-bar-fill
                  className="absolute inset-x-[var(--ui-level-meter-bar-inset-x)] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]"
                  style={{
                    "--ui-level-meter-bar-inset-x": LEVEL_METER_BAR_INSET_X,
                  }}
                >
                  <AnimatedPeakFill dbValue={c.valueDb} yRange={levelMeterYRange} />
                </div>
                <div
                  data-peak-value
                  className="@max-[220px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] flex justify-center text-[length:var(--ui-fs-display)]"
                >
                  <span className="w-[5ch] whitespace-nowrap text-center font-[family-name:var(--ui-font-mono)] tabular-nums text-muted-foreground">
                    {fmt(c.valueDb)}
                  </span>
                </div>
                <div
                  data-peak-channel-label
                  className="@max-[220px]:hidden absolute inset-x-0 bottom-[var(--ui-chart-inset-bottom)] text-center text-[length:var(--ui-fs-display)] text-muted-foreground"
                >
                  {c.label}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div data-level-meter-footer className={PANEL_METRIC_FOOTER}>
          <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
            <span className="text-muted-foreground">TP Max</span>
            <span
              className={
                hasTpMaxValue
                  ? "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-[color:var(--ui-signal-tp-max)]"
                  : "font-[family-name:var(--ui-font-mono)] tabular-nums font-semibold text-muted-foreground"
              }
            >
              {tpMaxText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
