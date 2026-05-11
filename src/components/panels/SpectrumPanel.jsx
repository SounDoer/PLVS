import { useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, CHART_INSET_MIN_H, PANEL_MIN_SPECTRUM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import { FREQ_LABELS, SPEC_Y_TICKS, freqToXFrac, spectrumDbToTopFrac, spectrumDbToYViewBox } from "../../scales";
function buildSpectrumAreaPath(path) {
  if (!path) return "";
  return `${path} L 1000 260 L 0 260 Z`;
}

export function SpectrumPanel({
  displaySpectrumPath,
  displaySpectrumPeakPath,
  channelCount = 0,
  selectedOffset,
  spectrumHover,
  onSpectrumHoverMove,
  onSpectrumHoverLeave,
}) {
  const spectrumSvgRef = useRef(null);
  const reduceMotion = useReducedMotion();
  const displaySpectrumAreaPath = buildSpectrumAreaPath(displaySpectrumPath);
  const isSummedMultichannel = Number.isFinite(channelCount) && channelCount > 2;
  const spectrumPaletteKey = selectedOffset >= 0 ? "snap" : "live";

  return (
    <Card
      className={cn(
        PANEL_MIN_SPECTRUM,
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-[var(--ui-radius-card)] border-border/80 bg-card/55 py-[var(--ui-article-pad-y)] pl-[var(--ui-article-pad-x)] pr-[var(--ui-article-pad-x)] text-card-foreground shadow-sm backdrop-blur-md",
      )}
    >
      <CardHeader className="flex min-w-0 flex-row items-center justify-between gap-2 space-y-0 p-0 pb-0">
        <CardTitle className="min-w-0 truncate text-[length:var(--ui-fs-section)] font-semibold text-muted-foreground">
          Spectrum
        </CardTitle>
        {isSummedMultichannel ? (
          <span
            className={cn(CAPTION_TEXT, "shrink-0")}
            title="All channels (summed): per-band linear power/energy is summed across channels, then converted to dB."
          >
            All channels (summed)
          </span>
        ) : null}
      </CardHeader>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-0 p-0 pt-[var(--ui-section-title-gap)]">
      <div
        className={cn(
          "grid min-h-0 flex-1 grid-cols-[var(--ui-w-spectrum-y-axis)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)_auto] gap-x-[var(--ui-axis-gap-y)] gap-y-[var(--ui-axis-gap-x)] items-stretch",
          PANEL_MIN_SPECTRUM,
        )}
      >
        <div
          className={cn(
            W_SPECTRUM_Y_AXIS,
            "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis-value)] text-muted-foreground",
          )}
        >
          <div className="absolute inset-x-0 top-[var(--ui-spectrum-display-top-inset)] bottom-[var(--ui-spectrum-display-bottom-inset)]">
            {SPEC_Y_TICKS.map(({ v, lb }) => (
              <span key={v} className="absolute right-0 -translate-y-1/2 leading-none" style={{ top: `${spectrumDbToTopFrac(v) * 100}%` }}>
                {lb}
              </span>
            ))}
          </div>
        </div>
        <div className="relative min-h-0 min-w-0">
          <div
            className={cn("relative min-h-0 h-full rounded-lg bg-muted", CHART_INSET_MIN_H)}
            onPointerLeave={onSpectrumHoverLeave}
          >
            <div
              className="absolute inset-0 min-h-0 min-w-0 px-[var(--ui-spectrum-svg-pad)] pt-[var(--ui-spectrum-display-top-inset)] pb-[var(--ui-spectrum-display-bottom-inset)]"
              onPointerMove={(e) => {
                const r = spectrumSvgRef.current?.getBoundingClientRect();
                if (r && onSpectrumHoverMove) onSpectrumHoverMove(e.clientX, r);
              }}
            >
              <svg
                ref={spectrumSvgRef}
                viewBox="0 0 1000 260"
                preserveAspectRatio="none"
                className="block h-full w-full min-h-0 min-w-0"
              >
                <defs>
                  <linearGradient id="spectrumFillLive" x1="0" x2="0" y1="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--ui-chart-spectrum-live)"
                      stopOpacity="var(--ui-sp-fill-top, 0.18)"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--ui-chart-spectrum-live)"
                      stopOpacity="var(--ui-sp-fill-bottom, 0.02)"
                    />
                  </linearGradient>
                  <linearGradient id="spectrumFillSnap" x1="0" x2="0" y1="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--ui-chart-spectrum-snap)"
                      stopOpacity="var(--ui-sp-fill-top, 0.18)"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--ui-chart-spectrum-snap)"
                      stopOpacity="var(--ui-sp-fill-bottom, 0.02)"
                    />
                  </linearGradient>
                </defs>
                <g pointerEvents="none" aria-hidden>
                  {SPEC_Y_TICKS.map(({ v }) => (
                    <line
                      key={`sp-grid-h-${v}`}
                      x1={0}
                      x2={1000}
                      y1={spectrumDbToYViewBox(v)}
                      y2={spectrumDbToYViewBox(v)}
                      stroke="var(--border)"
                      strokeWidth={1}
                      vectorEffect="non-scaling-stroke"
                      style={{ strokeOpacity: "var(--ui-spectrum-grid-h)" }}
                    />
                  ))}
                  {FREQ_LABELS.map(([f]) => {
                    const x = freqToXFrac(f) * 1000;
                    return (
                      <line
                        key={`sp-grid-v-${f}`}
                        x1={x}
                        x2={x}
                        y1={0}
                        y2={260}
                        stroke="var(--border)"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                        style={{ strokeOpacity: "var(--ui-spectrum-grid-v)" }}
                      />
                    );
                  })}
                </g>
                {displaySpectrumPath ? (
                  <AnimatePresence mode="sync">
                    <motion.g
                      key={spectrumPaletteKey}
                      initial={reduceMotion ? false : { opacity: 0.88 }}
                      animate={{ opacity: 1 }}
                      exit={reduceMotion ? { opacity: 1 } : { opacity: 0.82 }}
                      transition={{ duration: reduceMotion ? 0 : 0.18, ease: "easeOut" }}
                    >
                      <path
                        d={displaySpectrumAreaPath}
                        fill={selectedOffset >= 0 ? "url(#spectrumFillSnap)" : "url(#spectrumFillLive)"}
                      />
                      <path
                        d={displaySpectrumPath}
                        fill="none"
                        stroke={selectedOffset >= 0 ? "var(--ui-chart-spectrum-snap)" : "var(--ui-chart-spectrum-live)"}
                        strokeWidth="var(--ui-sp-stroke-w)"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {displaySpectrumPeakPath ? (
                        <path
                          d={displaySpectrumPeakPath}
                          fill="none"
                          stroke="var(--ui-chart-spectrum-snap)"
                          strokeWidth="var(--ui-sp-stroke-w-inner)"
                          strokeDasharray="8 6"
                          opacity="0.8"
                        />
                      ) : null}
                    </motion.g>
                  </AnimatePresence>
                ) : null}
              </svg>
            </div>
            {spectrumHover ? (
              <div className="pointer-events-none absolute inset-[var(--ui-spectrum-svg-pad)] top-[var(--ui-spectrum-display-top-inset)] bottom-[var(--ui-spectrum-display-bottom-inset)] z-10">
                <div
                  className="absolute bottom-0 top-0 border-l border-dashed border-muted-foreground/55"
                  style={{ left: `${spectrumHover.leftPct}%` }}
                />
                <div
                  className="absolute left-0 right-0 border-t border-dashed border-muted-foreground/40"
                  style={{ top: `${spectrumHover.topPct}%` }}
                />
                <div
                  className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-[color:var(--ui-chart-spectrum-live)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ui-chart-spectrum-live)_22%,transparent)]"
                  style={{
                    left: `${spectrumHover.leftPct}%`,
                    top: `${spectrumHover.topPct}%`,
                    backgroundColor: selectedOffset >= 0 ? "var(--ui-chart-spectrum-snap)" : "var(--ui-chart-spectrum-live)",
                  }}
                />
                <div className="absolute left-[var(--ui-hud-inset)] top-[var(--ui-hud-inset)] rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis-value)] text-muted-foreground shadow-sm">
                  <div>{spectrumHover.freqLabel}</div>
                  <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">{spectrumHover.dbLabel}</div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        <div />
        <div className={cn(CAPTION_TEXT, "relative h-[var(--ui-chart-x-axis-row-h)] w-full")}>
          <div className="absolute inset-x-[var(--ui-spectrum-svg-pad)] top-0 h-full">
            {FREQ_LABELS.map(([f, lb]) => (
              <span key={f} className="absolute top-0 -translate-x-1/2 whitespace-nowrap" style={{ left: `${freqToXFrac(f) * 100}%` }}>
                {lb}
              </span>
            ))}
          </div>
        </div>

        <div />
        <div />
      </div>
      </CardContent>
    </Card>
  );
}
