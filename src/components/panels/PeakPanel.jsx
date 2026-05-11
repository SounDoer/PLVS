import { useEffect } from "react";
import { motion, useReducedMotion, useSpring } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { PANEL_MIN_PEAK, W_PEAK_TICKS } from "@/lib/shellLayout";
import { PEAK_TICKS, peakFromTopFrac, PEAK_DB_MIN, PEAK_DB_MAX } from "../../scales";
import { getPeakChannels } from "../../math/peakChannelMath";

function AnimatedPeakFill({ dbValue }) {
  const reduceMotion = useReducedMotion();
  const clamped = Number.isFinite(dbValue) ? Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, dbValue)) : null;
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

function AnimatedHoldLine({ holdDb, lineColor }) {
  const reduceMotion = useReducedMotion();
  const topPct = peakFromTopFrac(Math.max(PEAK_DB_MIN, Math.min(PEAK_DB_MAX, holdDb))) * 100;
  return (
    <motion.div
      className="pointer-events-none absolute inset-x-0 z-[5] border-t"
      initial={false}
      animate={{ top: `${topPct}%` }}
      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 38 }}
      style={{ borderTopColor: lineColor }}
    />
  );
}

export function PeakPanel({
  displayAudio,
  /** @type {import("../../math/peakMeterChannelLabels.js").PeakMeterChannelLabelsContext | undefined} */
  peakLabelContext,
  getSamplePeakLineColor,
  fmt,
  hasTpMaxValue,
  tpMaxText,
}) {
  const channels = getPeakChannels(displayAudio, peakLabelContext);
  return (
    <Card
      className={cn(
        PANEL_MIN_PEAK,
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-card)] border-border/80 bg-card/55 py-[var(--ui-article-pad-y)] pl-[var(--ui-article-pad-x)] pr-[var(--ui-article-pad-x)] text-card-foreground shadow-sm backdrop-blur-md",
      )}
    >
      <CardHeader className="shrink-0 space-y-0 p-0 pb-0">
        <CardTitle className="text-[length:var(--ui-fs-section)] font-semibold text-muted-foreground">
          Peak
        </CardTitle>
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0 pt-[var(--ui-section-title-gap)]">
      <div className={cn("grid min-h-0 flex-1 grid-cols-[auto_1fr] gap-[var(--ui-peak-axis-chart-gap)]", PANEL_MIN_PEAK)}>
        <div
          className={cn(
            W_PEAK_TICKS,
            "relative min-h-0 h-full shrink-0 overflow-visible text-right text-[length:var(--ui-fs-axis-value)] text-muted-foreground",
          )}
        >
          <div className="absolute inset-x-0 top-[var(--ui-peak-display-top-inset)] bottom-[var(--ui-peak-display-bottom-inset)]">
            {PEAK_TICKS.map(({ v, lb }) => (
              <span key={v} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${peakFromTopFrac(v) * 100}%` }}>
                {lb}
              </span>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(0,1fr))] gap-[var(--ui-peak-channel-gap)]">
          {channels.map((c, idx) => (
            <div key={`${idx}-${c.label}`} className="relative h-full min-h-0 rounded-lg bg-[var(--ui-color-inset-bg)] p-0">
              <div className="absolute inset-x-[var(--ui-meter-chart-inset-x)] bottom-[var(--ui-peak-display-bottom-inset)] top-[var(--ui-peak-display-top-inset)]">
                <AnimatedPeakFill dbValue={c.valueDb} />
                {Number.isFinite(c.holdDb) && (
                  <AnimatedHoldLine holdDb={c.holdDb} lineColor={getSamplePeakLineColor(c.holdDb)} />
                )}
              </div>
              <div className="absolute left-[var(--ui-meter-label-left-inset)] right-0 top-[var(--ui-meter-label-top-inset)] text-left text-[length:var(--ui-fs-extra)] text-[color:var(--ui-color-text-secondary)]">
                {c.label}{" "}
                <span className="ui-numeric text-muted-foreground">{fmt(c.valueDb)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-extra)]">
        <div className="shrink-0" style={{ width: "var(--ui-tp-info-left-blank)" }} />
        <div className="flex items-baseline gap-[var(--ui-inline-value-gap)]">
          <span className="text-muted-foreground">TP MAX</span>
          <span
            className={
              hasTpMaxValue
                ? "ui-numeric font-semibold text-[color:var(--ui-color-tp-max)]"
                : "ui-numeric font-semibold text-muted-foreground"
            }
          >
            {tpMaxText}
          </span>
        </div>
      </div>
      </CardContent>
    </Card>
  );
}
