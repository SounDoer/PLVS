import { useLayoutEffect, useMemo, useRef } from "react";

import {
  aggregatePolarLevel,
  polarSampleAlpha,
  POLAR_LEVEL_WINDOW_MS,
  projectPairToPolar,
  updatePolarLevelEnvelope,
  updatePolarMaxHold,
} from "../../math/vectorscopePolarMath.js";
import { DEFAULT_VECTORSCOPE_CANVAS_COLORS } from "../../theme/themeCanvasSelectors.js";
import { readCssNumber } from "../../theme/cssTokens.js";
import { useObservedCanvasSize } from "../../hooks/useObservedCanvasSize.js";

const PLOT_PADDING_CSS_PX = 10;
const POINT_RADIUS_CSS_PX = 1.15;
const PEAK_ALPHA = 0.35;
const SIGNAL_FLOOR_LINEAR = 10 ** (-90 / 20);
const POLAR_FIXED_EXTENT = Math.SQRT2;
const POLAR_FLOOR_DB = -48;

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

function fixedDbRadius(value, geometry) {
  const levelDb = value > 0 ? 20 * Math.log10(value / POLAR_FIXED_EXTENT) : POLAR_FLOOR_DB;
  const normalized = Math.max(0, Math.min(1, (levelDb - POLAR_FLOOR_DB) / -POLAR_FLOOR_DB));
  return normalized * geometry.radius;
}

function projectedSamplePoint(point, geometry) {
  const radius = fixedDbRadius(point.radius, geometry);
  return {
    x: geometry.centerX + Math.sin(point.angle) * radius,
    y: geometry.baselineY - Math.cos(point.angle) * radius,
  };
}

function drawPolarSample(ctx, rows, geometry, color, dpr, snapshot) {
  ctx.fillStyle = color;
  const pointRadius = POINT_RADIUS_CSS_PX * dpr;
  for (const row of rows) {
    ctx.globalAlpha = snapshot ? 0.9 : polarSampleAlpha(row.ageMs);
    for (let index = 0; index + 1 < row.pairs.length; index += 2) {
      const point = projectPairToPolar(row.pairs[index], row.pairs[index + 1]);
      if (point.radius <= SIGNAL_FLOOR_LINEAR) continue;
      const projected = projectedSamplePoint(point, geometry);
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, pointRadius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function polarLevelRadius(value, geometry) {
  // Use the exact same fixed dB transfer as Polar Sample. With per-direction peak aggregation this
  // makes the level fan the filled outer envelope of the Sample dot cloud: identical radial scale,
  // so the two modes are visually consistent. dB (not linear) compresses the wide dynamic range so
  // quiet material still reaches out instead of collapsing to a tiny central blob.
  return fixedDbRadius(value, geometry);
}

function envelopePoint(index, value, count, geometry) {
  const angle = -Math.PI / 2 + (index / Math.max(1, count - 1)) * Math.PI;
  const radius = polarLevelRadius(value, geometry);
  return {
    x: geometry.centerX + Math.sin(angle) * radius,
    y: geometry.baselineY - Math.cos(angle) * radius,
  };
}

function traceLevelFan(ctx, envelope, geometry) {
  if (!envelope?.length) return false;

  ctx.beginPath();
  ctx.moveTo(geometry.centerX, geometry.baselineY);
  for (let index = 0; index < envelope.length; index += 1) {
    const point = envelopePoint(index, envelope[index], envelope.length, geometry);
    ctx.lineTo(point.x, point.y);
  }
  ctx.lineTo(geometry.centerX, geometry.baselineY);
  ctx.closePath();
  return true;
}

function traceEnvelope(ctx, envelope, geometry) {
  if (!envelope?.length) return false;

  ctx.beginPath();
  const first = envelopePoint(0, envelope[0], envelope.length, geometry);
  ctx.moveTo(first.x, first.y);
  for (let index = 1; index < envelope.length; index += 1) {
    const point = envelopePoint(index, envelope[index], envelope.length, geometry);
    ctx.lineTo(point.x, point.y);
  }
  return true;
}

function drawPolarLevel(ctx, envelope, held, geometry, wedgeColor, lineWidth) {
  ctx.fillStyle = wedgeColor;
  ctx.lineWidth = lineWidth;
  ctx.globalAlpha = 1;
  if (traceLevelFan(ctx, envelope, geometry)) {
    ctx.fill();
  }
  if (held && traceEnvelope(ctx, held, geometry)) {
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
  snapshotMaxHold = null,
  firstLabel,
  secondLabel,
  showLabels = true,
  maxHoldEnabled = false,
  maxHoldResetKey = 0,
  resetEpoch = 0,
  identityKey = "",
  colors = DEFAULT_VECTORSCOPE_CANVAS_COLORS,
  enabled = true,
}) {
  const canvasRef = useRef(null);
  const envelopeRef = useRef(null);
  const maxHoldRef = useRef(null);
  const lastTimestampRef = useRef(null);
  const stateIdentityRef = useRef("");
  const maxHoldResetKeyRef = useRef(maxHoldResetKey);
  const snapshot = snapshotPairs != null;
  const effectiveRows = useMemo(
    () => (snapshot ? [{ pairs: snapshotPairs, ageMs: 0, timestampMs: 0 }] : rows),
    [rows, snapshot, snapshotPairs]
  );
  const canvasSize = useObservedCanvasSize(canvasRef, enabled);
  // Max hold is a pure overlay: enabling/disabling it must not disturb the live envelope, and
  // updatePolarMaxHold already discards held values when disabled and reseeds from the current
  // envelope when re-enabled. So it stays out of the state-reset identity (including it here would
  // wipe envelopeRef on every toggle and pop the live fill). It still affects the drawn output, so
  // it is part of the redraw signature below.
  const stateIdentity = `${mode}:${identityKey}:${resetEpoch}`;

  useLayoutEffect(() => {
    if (!enabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;
    const { dpr, width, height } = canvasSize;
    if (width <= 0 || height <= 0) return;

    if (stateIdentityRef.current !== stateIdentity) {
      stateIdentityRef.current = stateIdentity;
      envelopeRef.current = null;
      maxHoldRef.current = null;
      lastTimestampRef.current = null;
    }

    // A per-instance reset nonce clears only the Max hold — the live envelope and timestamp are
    // left alone so the fan does not jump. The live path's updatePolarMaxHold then reseeds the
    // hold from the current envelope. In snapshot the hold is drawn from snapshotMaxHold, so this
    // has no visible effect there.
    if (maxHoldResetKeyRef.current !== maxHoldResetKey) {
      maxHoldResetKeyRef.current = maxHoldResetKey;
      maxHoldRef.current = null;
    }

    const traceColor = snapshot ? colors.snapshot : colors.trace;
    const gridColor = colors.grid;
    const lineWidth = (readCssNumber(canvas, "--ui-vectorscope-stroke-width", 1) || 1) * dpr;
    const newestTimestamp = effectiveRows.at(-1)?.timestampMs;

    const geometry = plotGeometry(width, height, PLOT_PADDING_CSS_PX * dpr);
    ctx.clearRect(0, 0, width, height);
    drawGrid(ctx, geometry, gridColor, Math.max(0.5 * dpr, lineWidth * 0.5));

    if (effectiveRows.length === 0) return;
    if (mode === "polarSample") {
      drawPolarSample(ctx, effectiveRows, geometry, traceColor, dpr, snapshot);
      return;
    }

    if (snapshot) {
      // A snapshot is a look-back at stored history, so it must not touch the live envelope or
      // max-hold accumulators (which represent the live period since Clear) — leaving them frozen
      // lets both resume seamlessly on return to live. Draw the selected row's settled fan directly
      // and overlay the Max hold reconstructed for the scrubbed moment (grows/recedes with the
      // history up to that row), supplied by the panel; the live runtime hold is not shown here.
      const snapshotEnvelope = aggregatePolarLevel(effectiveRows);
      const held = maxHoldEnabled ? (snapshotMaxHold ?? null) : null;
      drawPolarLevel(ctx, snapshotEnvelope, held, geometry, traceColor, lineWidth);
      return;
    }

    const now = Number.isFinite(newestTimestamp) ? newestTimestamp : performance.now();
    const elapsedMs = Number.isFinite(lastTimestampRef.current)
      ? Math.max(0, now - lastTimestampRef.current)
      : 0;
    lastTimestampRef.current = now;

    const levelRows = effectiveRows.filter(
      (row) => !Number.isFinite(row.ageMs) || row.ageMs <= POLAR_LEVEL_WINDOW_MS
    );
    const targetEnvelope = aggregatePolarLevel(levelRows);
    envelopeRef.current = updatePolarLevelEnvelope(envelopeRef.current, targetEnvelope, elapsedMs);
    maxHoldRef.current = updatePolarMaxHold(maxHoldRef.current, envelopeRef.current, {
      enabled: maxHoldEnabled,
    });
    drawPolarLevel(ctx, envelopeRef.current, maxHoldRef.current, geometry, traceColor, lineWidth);
  }, [
    canvasSize,
    colors,
    effectiveRows,
    enabled,
    maxHoldEnabled,
    maxHoldResetKey,
    mode,
    snapshot,
    snapshotMaxHold,
    stateIdentity,
  ]);

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
