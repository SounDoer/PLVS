import { useLayoutEffect, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { UI_PREFERENCES } from "../../uiPreferences";
import { getPeakMeterChannelLabels } from "../../math/peakMeterChannelLabels.js";

const VS_VIEW = 260;
/** Alpha of inset-bg overlay per frame; UI path updates ~15 Hz (every other Tauri frame), so keep moderate. */
const VS_PERSIST_FADE_ALPHA = 0.11;

/**
 * Live Lissajous only: fade previous canvas pixels then stroke the latest Rust-built polyline (`Path2D`).
 * Snapshot / history uses SVG paths in the parent instead (no persistence smear on static traces).
 */
function VectorscopePersistenceCanvas({ path, pairKey, strokeCssVar, strokeWidth, axisOpacity }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const pathRef = useRef(path);
  const lastPairRef = useRef(null);
  pathRef.current = path;

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const paint = () => {
      const dPath = pathRef.current;
      const pairChanged = lastPairRef.current !== pairKey;
      if (pairChanged) lastPairRef.current = pairKey;

      const rect = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const wPx = Math.max(1, Math.floor(rect.width * dpr));
      const hPx = Math.max(1, Math.floor(rect.height * dpr));
      const resized = canvas.width !== wPx || canvas.height !== hPx;
      if (resized) {
        canvas.width = wPx;
        canvas.height = hPx;
      }

      const cs = getComputedStyle(wrap);
      const stroke = cs.getPropertyValue(strokeCssVar).trim() || "#007aff";
      const bg = cs.getPropertyValue("--ui-color-inset-bg").trim() || "#18181b";

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.scale(rect.width / VS_VIEW, rect.height / VS_VIEW);

      const hasPolyline = typeof dPath === "string" && dPath.includes(" L ");
      if (resized || pairChanged || !hasPolyline) {
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, VS_VIEW, VS_VIEW);
        if (!hasPolyline) return;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = bg;
        ctx.globalAlpha = VS_PERSIST_FADE_ALPHA;
        ctx.fillRect(0, 0, VS_VIEW, VS_VIEW);
        ctx.globalAlpha = 1;
      }

      let p2d;
      try {
        p2d = new Path2D(dPath);
      } catch {
        return;
      }

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = stroke;

      ctx.globalAlpha = axisOpacity * 0.22;
      ctx.lineWidth = strokeWidth * 3;
      ctx.stroke(p2d);

      ctx.globalAlpha = axisOpacity * 0.42;
      ctx.lineWidth = strokeWidth * 2.25;
      ctx.shadowBlur = 14;
      ctx.shadowColor = stroke;
      ctx.stroke(p2d);
      ctx.shadowBlur = 0;
      ctx.shadowColor = "transparent";

      ctx.globalAlpha = axisOpacity;
      ctx.lineWidth = strokeWidth;
      ctx.stroke(p2d);
      ctx.globalAlpha = 1;
    };

    paint();
    const ro = new ResizeObserver(() => paint());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [path, pairKey, strokeCssVar, strokeWidth, axisOpacity]);

  return (
    <div ref={wrapRef} className="absolute inset-0 z-[1] min-h-0 min-w-0">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden />
    </div>
  );
}

export function VectorscopePanel({
  vsGridDiagInset,
  vsGridDiagFar,
  displayVectorPath,
  selectedOffset,
  correlation,
  channelCount = 0,
  /** @type {import("../../math/peakMeterChannelLabels.js").PeakMeterChannelLabelsContext | undefined} */
  peakLabelContext,
  pairX = 0,
  pairY = 1,
}) {
  // Before metering (0 ch) or waiting for a multichannel layout, show standard L/R for the default 0–1 pair
  // instead of generic Ch 1 / Ch 2.
  const labelChannelCount =
    Number.isFinite(channelCount) && channelCount >= 2 ? Math.floor(Number(channelCount)) : 2;
  const stripLabels = getPeakMeterChannelLabels(labelChannelCount, peakLabelContext || {});
  const px = Number.isFinite(pairX) ? Math.max(0, Math.floor(Number(pairX))) : 0;
  const py = Number.isFinite(pairY) ? Math.max(0, Math.floor(Number(pairY))) : 1;
  const reduceMotion = useReducedMotion();
  const isLive = selectedOffset < 0;
  const usePersistence = isLive && !reduceMotion;
  const vs = UI_PREFERENCES.modules.vector.charts.vectorscope;
  const pairKey = `${px}-${py}`;
  const axisXLabel = stripLabels[px] ?? `Ch ${px + 1}`;
  const axisYLabel = stripLabels[py] ?? `Ch ${py + 1}`;
  return (
    <article className="ui-article ui-min-h-spectrum flex-1">
      <div className="flex min-w-0 items-baseline justify-between gap-3">
        <div className="ui-section-title ui-section-title-main min-w-0">Vectorscope</div>
      </div>
      <div className="relative min-h-0 flex-1 rounded-lg bg-[var(--ui-color-inset-bg)]">
        <div className="absolute inset-[var(--ui-chart-outer-inset)] z-0 min-h-0 min-w-0 overflow-hidden">
          <svg
            className="pointer-events-none absolute inset-0 z-0 block h-full w-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden
          >
            <line
              x1={vsGridDiagInset}
              y1={vsGridDiagInset}
              x2={vsGridDiagFar}
              y2={vsGridDiagFar}
              stroke="var(--ui-vs-grid-diag-stroke)"
              strokeWidth="0.35"
              strokeDasharray="var(--ui-vs-grid-diag-dash)"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1={vsGridDiagFar}
              y1={vsGridDiagInset}
              x2={vsGridDiagInset}
              y2={vsGridDiagFar}
              stroke="var(--ui-vs-grid-diag-stroke)"
              strokeWidth="0.35"
              strokeDasharray="var(--ui-vs-grid-diag-dash)"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
          {usePersistence ? (
            <>
              <VectorscopePersistenceCanvas
                path={displayVectorPath || ""}
                pairKey={pairKey}
                strokeCssVar="--ui-chart-vectorscope-live"
                strokeWidth={vs.strokeWidth}
                axisOpacity={vs.axisOpacity}
              />
              <svg
                viewBox="0 0 260 260"
                preserveAspectRatio="none"
                className="pointer-events-none absolute inset-0 z-[2] block h-full w-full"
                aria-hidden
              >
                <circle cx="130" cy="130" r="2" fill="var(--ui-chart-vectorscope-live)" />
              </svg>
            </>
          ) : (
            <svg
              viewBox="0 0 260 260"
              preserveAspectRatio="none"
              className="absolute inset-0 z-[1] block h-full w-full"
            >
              <path
                d={displayVectorPath || "M 130 130 L 130 130"}
                fill="none"
                stroke={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
                strokeWidth={vs.strokeWidth * 3}
                opacity={vs.axisOpacity * 0.22}
                strokeLinecap="round"
              />
              <path
                d={displayVectorPath || "M 130 130 L 130 130"}
                fill="none"
                stroke={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
                strokeWidth={vs.strokeWidth}
                opacity={vs.axisOpacity}
              />
              <circle
                cx="130"
                cy="130"
                r="2"
                fill={selectedOffset >= 0 ? "var(--ui-chart-vectorscope-snap)" : "var(--ui-chart-vectorscope-live)"}
              />
            </svg>
          )}
        </div>
        <span className="ui-caption absolute left-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]">{axisXLabel}</span>
        <span className="ui-caption absolute right-[var(--ui-vector-corner-inset)] top-[var(--ui-vector-corner-inset)]">{axisYLabel}</span>
      </div>
      <div className="mt-[var(--ui-panel-footer-gap)] flex shrink-0 items-baseline justify-start text-[length:var(--ui-fs-extra)]">
        <div className="shrink-0" style={{ width: "var(--ui-corr-info-left-blank)" }} />
        <div className="flex items-baseline gap-[var(--ui-inline-value-gap)]">
          <span className="text-[color:var(--ui-color-text-muted)]">CORRELATION</span>
          <span
            className={
              Number.isFinite(correlation)
                ? "ui-numeric font-semibold text-[color:var(--ui-color-tp-max)]"
                : "ui-numeric font-semibold text-[color:var(--ui-color-text-muted)]"
            }
          >
            {Number.isFinite(correlation) ? correlation.toFixed(2) : "-"}
          </span>
        </div>
      </div>
    </article>
  );
}
