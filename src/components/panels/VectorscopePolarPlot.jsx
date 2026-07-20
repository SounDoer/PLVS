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
const PEAK_ALPHA = 0.35;
const SIGNAL_FLOOR_LINEAR = 10 ** (-90 / 20);
const POLAR_LEVEL_FIXED_EXTENT = Math.SQRT2;
const POLAR_LEVEL_FLOOR_DB = -48;
const POLAR_LEVEL_WEDGE_WIDTH_RATIO = 0.5;

function resolveTraceColors(style) {
  const traceColor = style.getPropertyValue("--ui-vectorscope-trace").trim() || "#7dd3fc";
  const gridColor = style.getPropertyValue("--ui-vectorscope-grid-stroke").trim() || traceColor;
  return { traceColor, gridColor };
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
  ctx.globalAlpha = 1;
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

function polarLevelRadius(value, extent, geometry) {
  const levelDb =
    value > 0 ? 20 * Math.log10(value / Math.max(extent, 1e-9)) : POLAR_LEVEL_FLOOR_DB;
  const normalized = Math.max(
    0,
    Math.min(1, (levelDb - POLAR_LEVEL_FLOOR_DB) / -POLAR_LEVEL_FLOOR_DB)
  );
  return normalized * geometry.radius;
}

function envelopePoint(index, value, count, extent, geometry) {
  const angle = -Math.PI / 2 + (index / Math.max(1, count - 1)) * Math.PI;
  const radius = polarLevelRadius(value, extent, geometry);
  return {
    x: geometry.centerX + Math.sin(angle) * radius,
    y: geometry.baselineY - Math.cos(angle) * radius,
  };
}

function traceLevelWedge(ctx, index, value, count, extent, geometry) {
  const binAngle = Math.PI / Math.max(1, count - 1);
  const centerAngle = -Math.PI / 2 + index * binAngle;
  const halfWidth = (binAngle * POLAR_LEVEL_WEDGE_WIDTH_RATIO) / 2;
  const startAngle = Math.max(-Math.PI / 2, centerAngle - halfWidth);
  const endAngle = Math.min(Math.PI / 2, centerAngle + halfWidth);
  const radius = polarLevelRadius(value, extent, geometry);
  if (radius <= 0) return false;

  ctx.beginPath();
  ctx.moveTo(geometry.centerX, geometry.baselineY);
  ctx.lineTo(
    geometry.centerX + Math.sin(startAngle) * radius,
    geometry.baselineY - Math.cos(startAngle) * radius
  );
  ctx.lineTo(
    geometry.centerX + Math.sin(endAngle) * radius,
    geometry.baselineY - Math.cos(endAngle) * radius
  );
  ctx.closePath();
  return true;
}

function traceEnvelope(ctx, envelope, extent, geometry) {
  if (!envelope?.length) return false;

  ctx.beginPath();
  const first = envelopePoint(0, envelope[0], envelope.length, extent, geometry);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < envelope.length; index += 1) {
    const point = envelopePoint(index, envelope[index], envelope.length, extent, geometry);
    ctx.lineTo(point.x, point.y);
  }
  return true;
}

function drawPolarLevel(ctx, envelope, held, extent, geometry, wedgeColor, lineWidth) {
  ctx.fillStyle = wedgeColor;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 1;
  for (let index = 0; index < envelope.length; index += 1) {
    if (traceLevelWedge(ctx, index, envelope[index], envelope.length, extent, geometry)) {
      ctx.fill();
    }
  }
  if (held && traceEnvelope(ctx, held, extent, geometry)) {
    ctx.strokeStyle = wedgeColor;
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
    const style = getComputedStyle(canvas);
    const { traceColor, gridColor } = resolveTraceColors(style);
    const lineWidth =
      (parseFloat(style.getPropertyValue("--ui-vectorscope-stroke-width")) || 1) * dpr;
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, geometry, gridColor, Math.max(0.5 * dpr, lineWidth * 0.5));

    const newestTimestamp = effectiveRows.at(-1)?.timestampMs;
    const now = Number.isFinite(newestTimestamp) ? newestTimestamp : performance.now();
    const elapsedMs = Number.isFinite(lastTimestampRef.current)
      ? Math.max(0, now - lastTimestampRef.current)
      : 0;
    lastTimestampRef.current = now;

    if (effectiveRows.length === 0) return;
    if (mode === "polarSample") {
      const targetExtent = polarWindowExtent(effectiveRows);
      extentRef.current = snapshot
        ? targetExtent
        : updatePolarExtent(extentRef.current, targetExtent, elapsedMs, hasSignal);
      const extent = extentRef.current ?? targetExtent;
      drawPolarSample(ctx, effectiveRows, extent, geometry, traceColor, dpr, snapshot);
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
      POLAR_LEVEL_FIXED_EXTENT,
      geometry,
      traceColor,
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
