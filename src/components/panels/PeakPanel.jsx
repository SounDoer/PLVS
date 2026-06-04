import { useEffect } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { cn } from "@/lib/utils";
import { PANEL_MIN_PEAK, W_PEAK_TICKS } from "@/lib/shellLayout";
import { PEAK_TICKS, peakFromTopFrac, PEAK_DB_MIN, PEAK_DB_MAX } from "../../config/scales";
import { getPeakChannels, getPeakChannelSpacingScale } from "../../math/peakChannelMath";

function AnimatedPeakFill({ dbValue }) {
  const reduceMotion = useReducedMotion();
  const clamped = Number.isFinite(dbValue)
    ? Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, dbValue))
    : null;
  const clipTopFrac = clamped != null ? peakFromTopFrac(clamped) : 1;
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
    <div className="absolute inset-0 overflow-hidden rounded-md">
      <motion.div
        className="meter-gradient absolute inset-0 will-change-transform"
        style={{ scaleY: spring, transformOrigin: "bottom" }}
      />
    </div>
  );
}

export function PeakPanel() {
  const { displayAudio, peakLabelContext, fmt, hasTpMaxValue, tpMaxText } = useAudioData();
  const channels = getPeakChannels(displayAudio, peakLabelContext);
  const channelSpacingScale = getPeakChannelSpacingScale(channels.length);
  return (
    <div
      className={cn(
        PANEL_MIN_PEAK,
        "@container flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[auto_1fr] gap-[var(--ui-peak-axis-chart-gap)]",
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
              {PEAK_TICKS.map(({ v, lb }) => (
                <span
                  key={v}
                  className="absolute right-0 -translate-y-1/2 leading-none"
                  style={{ top: `${peakFromTopFrac(v) * 100}%` }}
                >
                  {lb}
                </span>
              ))}
            </div>
          </div>
          <div
            className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-[calc(var(--ui-peak-channel-gap)*var(--ui-peak-channel-spacing-scale))]"
            style={{ "--ui-peak-channel-spacing-scale": channelSpacingScale }}
          >
            {channels.map((c, idx) => (
              <div
                key={`${idx}-${c.label}`}
                className="relative h-full min-h-0 rounded-lg bg-muted p-0"
              >
                <div className="absolute inset-x-[calc(var(--ui-meter-chart-inset-x)*var(--ui-peak-channel-spacing-scale))] bottom-[var(--ui-chart-inset-bottom)] top-[var(--ui-chart-inset-top)]">
                  <AnimatedPeakFill dbValue={c.valueDb} />
                </div>
                <div className="@max-[220px]:hidden absolute inset-x-0 top-[var(--ui-meter-label-top-inset)] text-center text-[length:var(--ui-fs-display)] text-muted-foreground">
                  {c.label}{" "}
                  <span className="font-[family-name:var(--ui-font-mono)] tabular-nums text-muted-foreground">
                    {fmt(c.valueDb)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="@max-[220px]:hidden mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-center text-[length:var(--ui-fs-display)]">
          <div className="flex items-baseline gap-[var(--ui-metric-inline-gap)]">
            <span className="text-muted-foreground">TP MAX</span>
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
