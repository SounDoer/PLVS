import { useEffect, useRef } from "react";
import { buildYToBand } from "../math/spectrogramMath.js";
import { inWindowRange } from "../math/spectrogramTimeline.js";
import { buildProjection, projectPoint, clampViewParams } from "../math/spectrogram3dProjection.js";
import { sampleWaterfallGrid } from "../math/spectrogram3dGrid.js";

// Cost tracks the product of these two, so they can be traded against each other while tuning:
// more ridges reads as denser time resolution, more points as finer spectral detail.
const RIDGE_TARGET_DIVISOR = 14;
const RIDGE_MIN = 24;
const RIDGE_MAX = 140;
const POINT_TARGET_DIVISOR = 6;
const POINT_MIN = 60;
const POINT_MAX = 320;
const GRADIENT_STOPS = 32;

function ridgeCountFor(widthPx) {
  return Math.round(Math.min(RIDGE_MAX, Math.max(RIDGE_MIN, widthPx / RIDGE_TARGET_DIVISOR)));
}

function pointCountFor(widthPx) {
  return Math.round(Math.min(POINT_MAX, Math.max(POINT_MIN, widthPx / POINT_TARGET_DIVISOR)));
}

function cssVar(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/** Opaque fill colour is what performs the hidden-line removal, so it must not be transparent. */
function resolveSurface(canvas) {
  let node = canvas.parentElement;
  while (node) {
    const bg = getComputedStyle(node).backgroundColor;
    if (bg && bg !== "transparent" && !bg.startsWith("rgba(0, 0, 0, 0)")) return bg;
    node = node.parentElement;
  }
  return cssVar(canvas, "--background", "#000");
}

function buildColorGradient(ctx, colormapLut, heightPx) {
  const gradient = ctx.createLinearGradient(0, 0, 0, -heightPx);
  for (let s = 0; s <= GRADIENT_STOPS; s++) {
    const frac = s / GRADIENT_STOPS;
    const idx = Math.round(frac * 255) * 3;
    gradient.addColorStop(
      frac,
      `rgb(${colormapLut[idx]},${colormapLut[idx + 1]},${colormapLut[idx + 2]})`
    );
  }
  return gradient;
}

export function useSpectrogram3dCanvas({
  canvasRef,
  snapRef,
  oldestMs,
  newestMs,
  sampleMs,
  selectedOffset,
  selectionXFrac,
  frozenSnaps,
  colormapLut,
  minHz = 20,
  maxHz = 20000,
  azimuthDeg,
  elevationDeg,
  heightGain,
  colorize,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({ pointCount: 0, minHz: 0, maxHz: 0, bands: null, yToBand: null });

  useEffect(() => {
    paramsRef.current = {
      oldestMs,
      newestMs,
      sampleMs,
      selectedOffset,
      selectionXFrac,
      frozenSnaps,
      colormapLut,
      minHz,
      maxHz,
      azimuthDeg,
      elevationDeg,
      heightGain,
      colorize,
    };
  }, [
    oldestMs,
    newestMs,
    sampleMs,
    selectedOffset,
    selectionXFrac,
    frozenSnaps,
    colormapLut,
    minHz,
    maxHz,
    azimuthDeg,
    elevationDeg,
    heightGain,
    colorize,
  ]);

  useEffect(() => {
    function draw() {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      const W = canvas.width;
      const H = canvas.height;
      if (W === 0 || H === 0) return;

      const p = paramsRef.current;
      if (!p.colormapLut || p.colormapLut.length < 256 * 3) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const snaps = p.frozenSnaps ?? snapRef.current;
      const span =
        Number.isFinite(p.oldestMs) && Number.isFinite(p.newestMs) ? p.newestMs - p.oldestMs : 0;

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const newest = snaps && snaps.length > 0 ? snaps.rowAt(snaps.length - 1) : null;
      const bands = newest?.bands;
      if (!bands || bands.length === 0 || span <= 0) return;

      const view = clampViewParams({
        azimuthDeg: p.azimuthDeg,
        elevationDeg: p.elevationDeg,
        heightGain: p.heightGain,
      });
      const proj = buildProjection({
        azimuthDeg: view.azimuthDeg,
        elevationDeg: view.elevationDeg,
        width: W,
        height: H,
      });

      const pointCount = pointCountFor(W);
      const cache = cacheRef.current;
      if (
        cache.pointCount !== pointCount ||
        cache.minHz !== p.minHz ||
        cache.maxHz !== p.maxHz ||
        cache.bands !== bands
      ) {
        cache.yToBand = buildYToBand(bands, pointCount, p.minHz, p.maxHz);
        cache.pointCount = pointCount;
        cache.minHz = p.minHz;
        cache.maxHz = p.maxHz;
        cache.bands = bands;
      }

      const { startIdx, endIdx } = inWindowRange(snaps, p.oldestMs, p.newestMs);
      if (endIdx < startIdx) return;

      const ridgeCount = ridgeCountFor(W);
      const grid = sampleWaterfallGrid({
        view: snaps,
        startIdx,
        endIdx,
        oldestMs: p.oldestMs,
        span,
        sampleMs: p.sampleMs,
        ridgeCount,
        yToBand: cache.yToBand,
      });

      const surface = resolveSurface(canvas);
      const ink = cssVar(canvas, "--muted-foreground", "#888");
      const selection = cssVar(canvas, "--ui-loudness-selection", ink);
      const heightPx = proj.heightScale * view.heightGain;

      // Colorize builds ONE gradient per repaint. It is expressed in a sheared space where every
      // ridge baseline is horizontal — the projection is affine, so all baselines share a slope and
      // a single shear flattens them together. Per ridge only a translate is then needed.
      //
      // At azimuth 0 and 180 the frequency axis has no horizontal extent, so baselineSlope is
      // +/-Infinity. That is a legitimate degenerate view, not an error — but feeding it to
      // setTransform would corrupt the canvas matrix, so fall back to a monochrome stroke for
      // those angles rather than shearing by infinity.
      const canShear = Number.isFinite(proj.baselineSlope);
      let gradient = null;
      if (p.colorize && canShear) {
        ctx.setTransform(1, proj.baselineSlope, 0, 1, 0, 0);
        gradient = buildColorGradient(ctx, p.colormapLut, heightPx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
      }

      // Scrub feedback: a vertical line through a 3D scene means nothing, so the selected ridge is
      // highlighted instead. selectionXFrac is the same 0..1 window fraction the 2D selection line
      // uses, so both modes mark the same moment.
      const selectedRidge =
        p.selectedOffset >= 0 && Number.isFinite(p.selectionXFrac)
          ? Math.min(ridgeCount - 1, Math.max(0, Math.round(p.selectionXFrac * (ridgeCount - 1))))
          : -1;

      ctx.lineJoin = "round";
      ctx.lineWidth = 1;

      // Painter's algorithm: far ridges first so nearer ones occlude them. Direction depends on
      // azimuth, which is why buildProjection reports it rather than assuming it.
      const first = proj.ridgeOrderAscending ? 0 : ridgeCount - 1;
      const step = proj.ridgeOrderAscending ? 1 : -1;
      for (let n = 0; n < ridgeCount; n++) {
        const r = first + n * step;
        if (!grid.present[r]) continue;
        const tFrac = (r + 0.5) / ridgeCount;
        const base = r * grid.pointCount;

        ctx.beginPath();
        for (let q = 0; q < grid.pointCount; q++) {
          const fFrac = q / (grid.pointCount - 1);
          const pt = projectPoint(tFrac, fFrac, grid.heights[base + q] * view.heightGain, proj);
          if (q === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
        const endBase = projectPoint(tFrac, 1, 0, proj);
        const startBase = projectPoint(tFrac, 0, 0, proj);
        ctx.lineTo(endBase.x, endBase.y);
        ctx.lineTo(startBase.x, startBase.y);
        ctx.closePath();

        ctx.fillStyle = surface;
        ctx.fill();

        if (r === selectedRidge) {
          ctx.strokeStyle = selection;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.lineWidth = 1;
        } else if (gradient) {
          // Order matters and is easy to get wrong: the transform must be in effect WHEN the
          // gradient is used as strokeStyle and when stroke() runs, because gradient coordinates
          // resolve against the CTM at paint time. Setting strokeStyle inside save/restore and
          // stroking after the restore silently reverts it.
          ctx.save();
          ctx.transform(1, proj.baselineSlope, 0, 1, 0, 0);
          ctx.translate(0, startBase.y - proj.baselineSlope * startBase.x);
          ctx.strokeStyle = gradient;
          ctx.stroke();
          ctx.restore();
        } else {
          ctx.strokeStyle = ink;
          ctx.stroke();
        }
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef]);
}
