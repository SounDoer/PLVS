import { useEffect } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";
import { PANEL_MIN_PEAK, W_PEAK_TICKS } from "@/lib/shellLayout";
import { axisLabelClass } from "@/lib/axisLabelClasses.js";
import {
  LOUDNESS_DB_MAX,
  LOUDNESS_DB_MIN,
  LOUDNESS_TICKS,
  PEAK_DB_MAX,
  PEAK_DB_MIN,
  PEAK_TICKS,
  loudnessFromTopFrac,
  peakFromTopFrac,
} from "../../config/scales";
import { getPeakChannels, getPeakChannelSpacingScale } from "../../math/peakChannelMath";

const LEVEL_MODE_META = {
  peak: { label: "Peak", unit: "dBFS" },
  momentary: { label: "M", unit: "LUFS", field: "momentary" },
  shortTerm: { label: "ST", unit: "LUFS", field: "shortTerm" },
};

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

function AnimatedPeakFill({ dbValue }) {
  return (
    <AnimatedLevelFill
      value={dbValue}
      min={PEAK_DB_MIN}
      max={PEAK_DB_MAX}
      fromTopFrac={peakFromTopFrac}
    />
  );
}

function formatLevelValue(value) {
  return Number.isFinite(value) ? value.toFixed(1) : "-";
}

function CurrentValueMarker({ value }) {
  if (!Number.isFinite(value)) return null;

  return (
    <span
      data-level-value-marker
      className="pointer-events-none absolute right-0 z-10 -translate-y-1/2 whitespace-nowrap text-right font-[family-name:var(--ui-font-mono)] font-semibold leading-none text-primary tabular-nums"
      style={{ top: `${loudnessFromTopFrac(value) * 100}%` }}
    >
      {formatLevelValue(value)}
    </span>
  );
}

export function LevelMeterPanel() {
  const { displayAudio, peakLabelContext, fmt, hasTpMaxValue, panelControls, tpMaxText } =
    useAudioData();
  const levelMeterMode = panelControls?.levelMeterMode ?? "peak";
  const showLevelValueMarker = panelControls?.levelMeterValueMarker ?? true;
  const modeMeta = LEVEL_MODE_META[levelMeterMode] ?? LEVEL_MODE_META.peak;

  if (levelMeterMode !== "peak") {
    const levelValue = displayAudio?.[modeMeta.field];
    return (
      <div
        className={cn(
          PANEL_MIN_PEAK,
          "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <div className="flex min-h-0 flex-1 flex-col gap-0">
          <div
            className={cn(
              "grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-[var(--ui-chart-axis-gap)]",
              PANEL_MIN_PEAK
            )}
          >
            <div
              className={cn(
                W_PEAK_TICKS,
                "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis)] text-muted-foreground"
              )}
            >
              <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
                {LOUDNESS_TICKS.map(({ v, lb }, i) => {
                  if (i === 0) {
                    return (
                      <span key={v} className={axisLabelClass("y", "start")}>
                        {lb}
                      </span>
                    );
                  }
                  if (i === LOUDNESS_TICKS.length - 1) {
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
                      style={{ top: `${loudnessFromTopFrac(v) * 100}%` }}
                    >
                      {lb}
                    </span>
                  );
                })}
                {showLevelValueMarker ? <CurrentValueMarker value={levelValue} /> : null}
              </div>
            </div>
            <div className="grid grid-cols-[minmax(0,1fr)]">
              <div className="relative h-full min-h-0 p-0">
                <div className="absolute inset-x-[var(--ui-meter-chart-inset-x)] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]">
                  <AnimatedLevelFill
                    value={levelValue}
                    min={LOUDNESS_DB_MIN}
                    max={LOUDNESS_DB_MAX}
                    fromTopFrac={loudnessFromTopFrac}
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
          <div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-center text-[length:var(--ui-fs-display)]">
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
  const channelSpacingScale = getPeakChannelSpacingScale(channels.length);
  return (
    <div
      className={cn(
        PANEL_MIN_PEAK,
        "@container flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[auto_minmax(0,1fr)] gap-[var(--ui-chart-axis-gap)]",
            PANEL_MIN_PEAK
          )}
        >
          <div
            className={cn(
              W_PEAK_TICKS,
              "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis)] text-muted-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
              {PEAK_TICKS.map(({ v, lb }, i) => {
                if (i === 0) {
                  return (
                    <span key={v} className={axisLabelClass("y", "start")}>
                      {lb}
                    </span>
                  );
                }
                if (i === PEAK_TICKS.length - 1) {
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
                    style={{ top: `${peakFromTopFrac(v) * 100}%` }}
                  >
                    {lb}
                  </span>
                );
              })}
            </div>
          </div>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-[calc(var(--ui-peak-channel-gap)*var(--ui-peak-channel-spacing-scale))]"
            style={{ "--ui-peak-channel-spacing-scale": channelSpacingScale }}
          >
            {channels.map((c, idx) => (
              <div key={`${idx}-${c.label}`} className="relative h-full min-h-0 p-0">
                <div className="absolute inset-x-[calc(var(--ui-meter-chart-inset-x)*var(--ui-peak-channel-spacing-scale))] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]">
                  <AnimatedPeakFill dbValue={c.valueDb} />
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
        <div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-center text-[length:var(--ui-fs-display)]">
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
