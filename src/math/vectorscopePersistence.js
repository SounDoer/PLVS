import {
  INV_SQRT2,
  VS_HALF,
  VS_SAFE_INSET,
  VS_EXTENT_FLOOR,
  BASE_PLOT_RADIUS,
} from "./vectorscopeMath.js";

export const PERSISTENCE_WINDOW_MS = 1000;
export const PERSISTENCE_ALPHA_MAX = 0.9;
export const PERSISTENCE_ALPHA_MIN = 0.05;

const VS_VIEWBOX = VS_HALF * 2;

/**
 * Rows from the slab whose age (relative to the newest row's timestamp) is within the
 * window. Oldest first. Empty unless at least 2 rows qualify — a single frame is just the
 * live trace and the caller should fall back to it.
 */
export function selectPersistenceWindow(slab, windowMs = PERSISTENCE_WINDOW_MS) {
  const length = slab?.length ?? 0;
  if (length < 2) return [];
  const newestTs = slab.timestampAt(length - 1);
  if (!Number.isFinite(newestTs)) return [];
  const rows = [];
  for (let i = length - 1; i >= 0; i -= 1) {
    const ts = slab.timestampAt(i);
    if (!Number.isFinite(ts)) break;
    const ageMs = newestTs - ts;
    if (ageMs > windowMs) break;
    const row = slab.rowAt(i);
    if (!row?.pairs?.length) break;
    rows.push({ pairs: row.pairs, ageMs });
  }
  if (rows.length < 2) return [];
  rows.reverse();
  return rows;
}

/**
 * One shared effective plot radius over all pairs in the window (same auto-zoom as
 * buildVectorscopeSvgFromPairs, but window-wide so the display does not pump per frame).
 */
export function computeWindowEffRadius(rows) {
  let maxCheb = 0;
  for (const { pairs } of rows) {
    const n = Math.floor(pairs.length / 2);
    for (let i = 0; i < n; i += 1) {
      const l = Math.max(-1, Math.min(1, pairs[i * 2]));
      const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
      const side = (r - l) * INV_SQRT2;
      const mid = (l + r) * INV_SQRT2;
      const e = Math.max(Math.abs(side), Math.abs(mid));
      if (e > maxCheb) maxCheb = e;
    }
  }
  const extent = Math.max(VS_EXTENT_FLOOR, maxCheb);
  return Math.min(BASE_PLOT_RADIUS, (VS_HALF - VS_SAFE_INSET) / extent);
}

export function persistenceAlpha(ageMs, windowMs = PERSISTENCE_WINDOW_MS) {
  const t = Math.max(0, Math.min(1, ageMs / windowMs));
  return PERSISTENCE_ALPHA_MAX - (PERSISTENCE_ALPHA_MAX - PERSISTENCE_ALPHA_MIN) * t;
}

/**
 * Redraw the whole window onto a 2D context. The caller owns canvas sizing, strokeStyle,
 * and lineWidth; coordinates are projected from the 260x260 plot space to width/height.
 */
export function drawPersistenceWindow(ctx, rows, { width, height, windowMs }) {
  ctx.clearRect(0, 0, width, height);
  const effRadius = computeWindowEffRadius(rows);
  const sx = width / VS_VIEWBOX;
  const sy = height / VS_VIEWBOX;
  for (const { pairs, ageMs } of rows) {
    ctx.globalAlpha = persistenceAlpha(ageMs, windowMs);
    ctx.beginPath();
    const n = Math.floor(pairs.length / 2);
    for (let i = 0; i < n; i += 1) {
      const l = Math.max(-1, Math.min(1, pairs[i * 2]));
      const r = Math.max(-1, Math.min(1, pairs[i * 2 + 1]));
      const side = (r - l) * INV_SQRT2;
      const mid = (l + r) * INV_SQRT2;
      const x = (VS_HALF + side * effRadius) * sx;
      const y = (VS_HALF - mid * effRadius) * sy;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
