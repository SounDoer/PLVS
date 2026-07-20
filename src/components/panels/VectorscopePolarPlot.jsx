import { useLayoutEffect, useRef } from "react";

import {
  aggregatePolarLevel,
  polarSampleAlpha,
  polarWindowExtent,
  projectPairToPolar,
  updatePolarExtent,
  updatePolarLevelEnvelope,
  updatePolarPeakHold,
} from "../../math/vectorscopePolarMath.js";

const PLOT_PADDING_CSS_PX = 10;
const POINT_RADIUS_CSS_PX = 1.15;
const ARC_ALPHA = 0.35;
const FILL_ALPHA = 0.2;
const OUTLINE_ALPHA = 0.86;
const PEAK_ALPHA = 0.58;
const SIGNAL_FLOOR_LINEAR = 10 ** (-90 / 20);

function resolveTraceColor(element) {
  return getComputedStyle(element).getPropertyValue("--ui-vectorscope-trace").trim() || "#7dd3fc";
}

function resizeCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  return { dpr, width, height };
}

function plotGeometry(width, height, padding) {
  const radius = Math.max(1, Math.min(width / 2 - padding, height - padding * 2));
  return { centerX: width / 2, baselineY: height - padding, radius };
}

function drawGrid(ctx, geometry, color, lineWidth) {
  const { centerX, baselineY, radius } = geometry;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = ARC_ALPHA;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.arc(centerX, baselineY, radius, Math.PI, 0);
  ctx.moveTo(centerX - radius, baselineY);
  ctx.lineTo(centerX + radius, baselineY);
  ctx.stroke();
  ctx.restore();
}

function projectedCanvasPoint(point, extent, geometry) {
  const scale = geometry.radius / Math.max(extent, 1e-9);
  return {
    x: geometry.centerX + point.x * scale,
    y: geometry.baselineY - point.y * scale,
  };
}

function drawPolarSample(ctx, rows, extent, geometry, color, dpr, snapshot) {
  ctx.fillStyle = color;
  const pointRadius = POINT_RADIUS_CSS_PX * dpr;
  for (const row of rows) {
    ctx.globalAlpha = snapshot ? 0.9 : polarSampleAlpha(row.ageMs);
    for (let index = 0; index + 1 < row.pairs.length; index += 2) {
      const point = projectPairToPolar(row.pairs[index], row.pairs[index + 1]);
      if (point.radius <= SIGNAL_FLOOR_LINEAR) continue;
      const projected = projectedCanvasPoint(point, extent, geometry);
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function envelopePoint(index, value, count, extent, geometry) {
  const angle = -Math.PI / 2 + (index / Math.max(1, count - 1)) * Math.PI;
  const normalizedRadius = value / Math.max(extent, 1e-9);
  return {
    x: geometry.centerX + Math.sin(angle) * normalizedRadius * geometry.radius,
    y: geometry.baselineY - Math.cos(angle) * normalizedRadius * geometry.radius,
  };
}

function traceEnvelope(ctx, envelope, extent, geometry) {
  ctx.beginPath();
  ctx.moveTo(geometry.centerX, geometry.baselineY);
  for (let index = 0; index < envelope.length; index += 1) {
    const point = envelopePoint(index, envelope[index], envelope.length, extent, geometry);
    ctx.lineTo(point.x, point.y);
  }
  ctx.closePath();
}

function drawPolarLevel(ctx, envelope, held, extent, geometry, color, lineWidth) {
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  traceEnvelope(ctx, envelope, extent, geometry);
  ctx.globalAlpha = FILL_ALPHA;
  ctx.fill();
  ctx.globalAlpha = OUTLINE_ALPHA;
  ctx.stroke();
  if (held) {
    traceEnvelope(ctx, held, extent, geometry);
    ctx.globalAlpha = PEAK_ALPHA;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export function VectorscopePolarPlot({
  mode,
  rows = [],
  snapshotPairs = null,
  hasSignal = false,
  firstLabel,
  secondLabel,
  showLabels = true,
  peakHoldEnabled = false,
  resetEpoch = 0,
  identityKey = "",
}) {
  const canvasRef = useRef(null);
  const extentRef = useRef(null);
  const envelopeRef = useRef(null);
  const peakHoldRef = useRef(null);
  const lastTimestampRef = useRef(null);
  const stateIdentityRef = useRef("");
  const snapshot = snapshotPairs != null;
  const effectiveRows = snapshot ? [{ pairs: snapshotPairs, ageMs: 0, timestampMs: 0 }] : rows;
  const stateIdentity = `${mode}:${identityKey}:${resetEpoch}:${peakHoldEnabled}`;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;

    if (stateIdentityRef.current !== stateIdentity) {
      stateIdentityRef.current = stateIdentity;
      extentRef.current = null;
      envelopeRef.current = null;
      peakHoldRef.current = null;
      lastTimestampRef.current = null;
    }

    const { dpr, width, height } = resizeCanvas(canvas);
    const geometry = plotGeometry(width, height, PLOT_PADDING_CSS_PX * dpr);
    const color = resolveTraceColor(canvas);
    const lineWidth =
      (parseFloat(getComputedStyle(canvas).getPropertyValue("--ui-vectorscope-stroke-width")) ||
        1) * dpr;
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, geometry, color, Math.max(0.5 * dpr, lineWidth * 0.5));

    const newestTimestamp = effectiveRows.at(-1)?.timestampMs;
    const now = Number.isFinite(newestTimestamp) ? newestTimestamp : performance.now();
    const elapsedMs = Number.isFinite(lastTimestampRef.current)
      ? Math.max(0, now - lastTimestampRef.current)
      : 0;
    lastTimestampRef.current = now;

    if (effectiveRows.length === 0) return;
    const targetExtent = polarWindowExtent(effectiveRows);
    extentRef.current = snapshot
      ? targetExtent
      : updatePolarExtent(extentRef.current, targetExtent, elapsedMs, hasSignal);
    const extent = extentRef.current ?? targetExtent;

    if (mode === "polarSample") {
      drawPolarSample(ctx, effectiveRows, extent, geometry, color, dpr, snapshot);
      return;
    }

    const targetEnvelope = aggregatePolarLevel(effectiveRows);
    envelopeRef.current = updatePolarLevelEnvelope(envelopeRef.current, targetEnvelope, elapsedMs, {
      settled: snapshot,
    });
    peakHoldRef.current = updatePolarPeakHold(peakHoldRef.current, envelopeRef.current, {
      enabled: peakHoldEnabled && !snapshot,
    });
    drawPolarLevel(
      ctx,
      envelopeRef.current,
      peakHoldRef.current,
      extent,
      geometry,
      color,
      lineWidth
    );
  });

  return (
    <div data-vectorscope-polar={mode} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
      {showLabels ? (
        <>
          <span className="pointer-events-none absolute bottom-0 left-0 max-w-[42%] truncate text-[length:var(--ui-fs-axis)] font-medium text-muted-foreground">
            {firstLabel}
          </span>
          <span className="pointer-events-none absolute bottom-0 right-0 max-w-[42%] truncate text-right text-[length:var(--ui-fs-axis)] font-medium text-muted-foreground">
            {secondLabel}
          </span>
        </>
      ) : null}
    </div>
  );
}
