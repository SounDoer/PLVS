import { useRef } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { useChartHover } from "../../hooks/useChartHover";
import { computeSpectrumHoverIndex, formatSpectrumFreq, freqToNote } from "../../math/hoverMath";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { CAPTION_TEXT, PANEL_MIN_SPECTRUM, W_SPECTRUM_Y_AXIS } from "@/lib/shellLayout";
import {
  FREQ_LABELS,
  SPEC_Y_TICKS,
  freqToXFrac,
  spectrumDbToTopFrac,
  spectrumDbToYViewBox,
} from "../../config/scales";

function buildSpectrumAreaPath(path) {
  if (!path) return "";
  return `${path} L 1000 260 L 0 260 Z`;
}

export function SpectrumPanel({ compact = false }) {
  const { displaySpectrumPath, displaySpectrumPeakPath, selectedOffset, displaySpectrumData } =
    useAudioData();
  const spectrumSvgRef = useRef(null);
  const {
    hover: spectrumHover,
    onMove,
    onLeave: onSpectrumHoverLeave,
  } = useChartHover((xFrac) => {
    const data = displaySpectrumData;
    if (!data?.bands?.length || !data?.dbList?.length) return null;
    const nearestIdx = computeSpectrumHoverIndex(xFrac, data.bands);
    const band = data.bands[nearestIdx];
    const db = data.dbList[nearestIdx];
    if (!band || !Number.isFinite(db)) return null;
    return {
      leftPct: freqToXFrac(band.fCenter) * 100,
      topPct: spectrumDbToTopFrac(db) * 100,
      freqLabel: formatSpectrumFreq(band.fCenter),
      dbLabel: `${db.toFixed(1)} dB`,
      noteLabel: freqToNote(band.fCenter),
    };
  });
  const reduceMotion = useReducedMotion();
  const displaySpectrumAreaPath = buildSpectrumAreaPath(displaySpectrumPath);
  const spectrumPaletteKey = selectedOffset >= 0 ? "snap" : "live";

  return (
    <div
      className={cn(
        PANEL_MIN_SPECTRUM,
        "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
      )}
    >
      <div className="flex min-h-0 flex-1 flex-col gap-0">
        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-[var(--ui-w-spectrum-y-axis)_minmax(0,1fr)] grid-rows-[minmax(0,1fr)_var(--ui-chart-x-axis-row-h)] gap-x-[var(--ui-chart-axis-gap)] gap-y-[var(--ui-chart-axis-gap)] items-stretch"
          )}
        >
          <div
            className={cn(
              W_SPECTRUM_Y_AXIS,
              "relative min-h-0 shrink-0 text-[length:var(--ui-fs-axis)] text-muted-foreground"
            )}
          >
            <div className="absolute inset-x-0 top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)]">
              {SPEC_Y_TICKS.map(({ v, lb }) => (
                <span
                  key={v}
                  className="absolute right-0 -translate-y-1/2 leading-none"
                  style={{ top: `${spectrumDbToTopFrac(v) * 100}%` }}
                >
                  {lb}
                </span>
              ))}
            </div>
          </div>
          <div className="relative min-h-0 min-w-0">
            <div
              className="relative min-h-0 h-full rounded-lg bg-muted"
              onPointerLeave={onSpectrumHoverLeave}
            >
              <div
                className="absolute inset-0 min-h-0 min-w-0 px-[var(--ui-chart-pad)] pt-[var(--ui-chart-inset-top)] pb-[var(--ui-chart-inset-bottom)]"
                onPointerMove={(e) => {
                  const r = spectrumSvgRef.current?.getBoundingClientRect();
                  if (r) onMove(e.clientX, e.clientY, r);
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
                          fill={
                            selectedOffset >= 0
                              ? "url(#spectrumFillSnap)"
                              : "url(#spectrumFillLive)"
                          }
                        />
                        <path
                          d={displaySpectrumPath}
                          fill="none"
                          stroke={
                            selectedOffset >= 0
                              ? "var(--ui-chart-spectrum-snap)"
                              : "var(--ui-chart-spectrum-live)"
                          }
                          strokeWidth="var(--ui-sp-stroke-w)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {displaySpectrumPeakPath ? (
                          <path
                            d={displaySpectrumPeakPath}
                            fill="none"
                            stroke="var(--ui-chart-spectrum-live)"
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
                <div className="pointer-events-none absolute inset-[var(--ui-chart-pad)] top-[var(--ui-chart-inset-top)] bottom-[var(--ui-chart-inset-bottom)] z-10">
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
                      backgroundColor:
                        selectedOffset >= 0
                          ? "var(--ui-chart-spectrum-snap)"
                          : "var(--ui-chart-spectrum-live)",
                    }}
                  />
                  <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.freqLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.dbLabel}
                    </div>
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.noteLabel}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div />
          <div className={cn(CAPTION_TEXT, "relative h-[var(--ui-chart-x-axis-row-h)] w-full")}>
            <div className="absolute inset-x-[var(--ui-chart-pad)] top-0 h-full">
              {FREQ_LABELS.map(([f, lb]) => (
                <span
                  key={f}
                  className="absolute top-0 -translate-x-1/2 whitespace-nowrap"
                  style={{ left: `${freqToXFrac(f) * 100}%` }}
                >
                  {lb}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
