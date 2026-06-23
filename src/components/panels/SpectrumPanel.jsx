import { useRef } from "react";
import { useAudioData } from "../../workspace/AudioDataContext.jsx";
import { spectrumRequestKeyFromControls } from "../../analysis/analysisRequests.js";
import { buildSpectrumDataSnapshot } from "../../lib/FrameIntake.js";
import {
  SnapshotEmptyState,
  SNAPSHOT_NO_DATA_MESSAGE,
  ANALYSIS_OVER_CAP_MESSAGE,
} from "./SnapshotEmptyState.jsx";
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
  const {
    selectedOffset,
    displayAudio,
    panelControls,
    resolveSpectrumSnapshotForKey,
    analysisStatus,
    historyChartInteractive,
    totalSamples,
    captureCurrentSnapshot,
  } = useAudioData();
  const spectrumPeakHold = panelControls?.spectrumPeakHold ?? false;
  const spectrumKey = spectrumRequestKeyFromControls(panelControls);
  const isOverCap = analysisStatus === "overCap";
  const isSnapshot = selectedOffset >= 0;
  // In snapshot mode each panel reads history for its own request key; in live mode it reads the
  // request-keyed live result.
  const snapResolved = isSnapshot ? resolveSpectrumSnapshotForKey?.(spectrumKey) : null;
  const snapshotMissing = snapResolved?.missing === true;
  const liveSpectrumResult = isSnapshot ? null : displayAudio?.spectrumResultsByKey?.[spectrumKey];
  let panelSpectrumPath;
  let panelSpectrumPeakPath;
  let panelSpectrumPathB;
  let panelSpectrumPeakPathB;
  let panelSpectrumData;
  if (isSnapshot) {
    panelSpectrumPath = snapResolved?.path ?? "";
    panelSpectrumPeakPath = "";
    panelSpectrumPathB = snapResolved?.pathB ?? "";
    panelSpectrumPeakPathB = "";
    panelSpectrumData = snapResolved?.data ?? null;
  } else if (liveSpectrumResult) {
    panelSpectrumPath = liveSpectrumResult.path;
    panelSpectrumPeakPath = liveSpectrumResult.peakPath;
    panelSpectrumPathB = liveSpectrumResult.pathB;
    panelSpectrumPeakPathB = liveSpectrumResult.peakPathB;
    panelSpectrumData = buildSpectrumDataSnapshot({
      spectrumBandCentersHz: liveSpectrumResult.bandCentersHz,
      spectrumSmoothDb: liveSpectrumResult.smoothDb,
      spectrumSmoothDbB: liveSpectrumResult.smoothDbB,
    });
  } else {
    // Live but no per-key result yet: pending treatment (empty chart) until this request's first
    // frame arrives. Showing another request's curve here would be wrong for this panel's key.
    panelSpectrumPath = "";
    panelSpectrumPeakPath = "";
    panelSpectrumPathB = "";
    panelSpectrumPeakPathB = "";
    panelSpectrumData = null;
  }
  const spectrumSvgRef = useRef(null);
  const {
    hover: spectrumHover,
    onMove,
    onLeave: onSpectrumHoverLeave,
  } = useChartHover((xFrac) => {
    const data = panelSpectrumData;
    if (!data?.bands?.length || !data?.dbList?.length) return null;
    const nearestIdx = computeSpectrumHoverIndex(xFrac, data.bands);
    const band = data.bands[nearestIdx];
    const db = data.dbList[nearestIdx];
    if (!band || !Number.isFinite(db)) return null;
    const dbB = data.dbListB?.[nearestIdx];
    return {
      leftPct: freqToXFrac(band.fCenter) * 100,
      topPct: spectrumDbToTopFrac(db) * 100,
      freqLabel: formatSpectrumFreq(band.fCenter),
      dbLabel: `${db.toFixed(1)} dB`,
      dbLabelB: Number.isFinite(dbB) ? `${dbB.toFixed(1)} dB` : null,
      noteLabel: freqToNote(band.fCenter),
    };
  });
  const reduceMotion = useReducedMotion();
  // Peak-hold renders as a filled area up to the peak contour (the live curve stays a solid line
  // on top). When peak hold is off, the fill follows the live curve as before.
  const peakFillActive = spectrumPeakHold && !!panelSpectrumPeakPath;
  const displaySpectrumAreaPath = buildSpectrumAreaPath(
    peakFillActive ? panelSpectrumPeakPath : panelSpectrumPath
  );
  const displaySpectrumAreaPathB =
    spectrumPeakHold && panelSpectrumPeakPathB ? buildSpectrumAreaPath(panelSpectrumPeakPathB) : "";
  const spectrumPaletteKey = selectedOffset >= 0 ? "snap" : "live";
  const canCaptureCurrentSnapshot = historyChartInteractive && totalSamples > 0;

  if (isOverCap || snapshotMissing) {
    return (
      <div
        className={cn(
          PANEL_MIN_SPECTRUM,
          "flex min-h-0 flex-1 flex-col overflow-hidden py-[var(--ui-panel-pad-y)] pl-[var(--ui-panel-pad-x)] pr-[var(--ui-panel-pad-x)]"
        )}
      >
        <SnapshotEmptyState
          message={isOverCap ? ANALYSIS_OVER_CAP_MESSAGE : SNAPSHOT_NO_DATA_MESSAGE}
        />
      </div>
    );
  }

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
              data-testid="spectrum-chart"
              className="relative min-h-0 h-full rounded-lg bg-muted"
              onPointerLeave={onSpectrumHoverLeave}
              onClick={() => {
                if (!canCaptureCurrentSnapshot) return;
                captureCurrentSnapshot?.();
              }}
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
                        stopColor="var(--ui-spectrum-primary)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-primary)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                    <linearGradient id="spectrumFillSnap" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-primary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-primary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                    <linearGradient id="spectrumFillLiveB" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-secondary)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-secondary)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
                      />
                    </linearGradient>
                    <linearGradient id="spectrumFillSnapB" x1="0" x2="0" y1="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="var(--ui-spectrum-secondary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
                      />
                      <stop
                        offset="100%"
                        stopColor="var(--ui-spectrum-secondary-snap)"
                        stopOpacity="var(--ui-spectrum-fill-bottom-opacity, 0.02)"
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
                        style={{ strokeOpacity: "var(--ui-spectrum-grid-opacity)" }}
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
                          style={{ strokeOpacity: "var(--ui-spectrum-grid-opacity)" }}
                        />
                      );
                    })}
                  </g>
                  {panelSpectrumPath ? (
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
                        {displaySpectrumAreaPathB ? (
                          <path
                            d={displaySpectrumAreaPathB}
                            fill={
                              selectedOffset >= 0
                                ? "url(#spectrumFillSnapB)"
                                : "url(#spectrumFillLiveB)"
                            }
                          />
                        ) : null}
                        <path
                          d={panelSpectrumPath}
                          fill="none"
                          stroke={
                            selectedOffset >= 0
                              ? "var(--ui-spectrum-primary-snap)"
                              : "var(--ui-spectrum-primary)"
                          }
                          strokeWidth="var(--ui-spectrum-stroke-width)"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        {panelSpectrumPathB ? (
                          <path
                            d={panelSpectrumPathB}
                            fill="none"
                            stroke={
                              selectedOffset >= 0
                                ? "var(--ui-spectrum-secondary-snap)"
                                : "var(--ui-spectrum-secondary)"
                            }
                            strokeWidth="var(--ui-spectrum-stroke-width)"
                            strokeLinecap="round"
                            strokeLinejoin="round"
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
                    className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-background bg-[color:var(--ui-spectrum-primary)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--ui-spectrum-primary)_22%,transparent)]"
                    style={{
                      left: `${spectrumHover.leftPct}%`,
                      top: `${spectrumHover.topPct}%`,
                      backgroundColor:
                        selectedOffset >= 0
                          ? "var(--ui-spectrum-primary-snap)"
                          : "var(--ui-spectrum-primary)",
                    }}
                  />
                  <div className="absolute left-[var(--ui-chart-hud-inset)] top-[var(--ui-chart-hud-inset)] rounded border border-border bg-secondary px-2 py-1 text-[length:var(--ui-fs-axis)] text-muted-foreground shadow-sm">
                    <div className="font-[family-name:var(--ui-font-mono)] tabular-nums">
                      {spectrumHover.freqLabel}
                    </div>
                    <div
                      className="font-[family-name:var(--ui-font-mono)] tabular-nums"
                      style={
                        spectrumHover.dbLabelB
                          ? {
                              color:
                                selectedOffset >= 0
                                  ? "var(--ui-spectrum-primary-snap)"
                                  : "var(--ui-spectrum-primary)",
                            }
                          : undefined
                      }
                    >
                      {spectrumHover.dbLabel}
                    </div>
                    {spectrumHover.dbLabelB ? (
                      <div
                        className="font-[family-name:var(--ui-font-mono)] tabular-nums"
                        style={{
                          color:
                            selectedOffset >= 0
                              ? "var(--ui-spectrum-secondary-snap)"
                              : "var(--ui-spectrum-secondary)",
                        }}
                      >
                        {spectrumHover.dbLabelB}
                      </div>
                    ) : null}
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
