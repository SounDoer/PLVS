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
const GRADIENT_STOPS = 16;
const RIDGE_ALPHA = 0.5;

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

/**
 * A ridge's colour ramp, running from its own baseline up to full height.
 *
 * Iso-colour lines must be parallel to the baseline, and the baseline is sloped, so the gradient
 * axis is the baseline's perpendicular rather than plain vertical. With baseline direction
 * `(fx, fy)` and perpendicular `n = (-fy, fx)`, the endpoint that makes the gradient parameter
 * equal the normalised height is `startBase + k * n` for `k = -heightPx * fx / (fx^2 + fy^2)`.
 *
 * Sanity check: a horizontal baseline (`fy = 0`) reduces to a plain vertical ramp of `heightPx`.
 * A vertical one (`fx = 0`, azimuth 0 or 180) degenerates to `k = 0` — the same degenerate view the
 * caller already guards against.
 *
 * Built per ridge rather than once per repaint. An earlier design shared a single gradient across
 * all ridges by shearing the canvas so every baseline became horizontal. That is exact, but it is
 * incompatible with Path2D, which resolves its coordinates against the CTM at paint time -- a shear
 * applied before stroking moves the curve, not just the gradient. Deriving the axis from the
 * baseline's perpendicular gets the same result without touching the transform at all.
 */
function buildRidgeGradient(ctx, colormapLut, startBase, proj, heightPx) {
  const denom = proj.fx * proj.fx + proj.fy * proj.fy;
  const k = (-heightPx * proj.fx) / denom;
  const gradient = ctx.createLinearGradient(
    startBase.x,
    startBase.y,
    startBase.x - k * proj.fy,
    startBase.y + k * proj.fx
  );
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

const FLOOR_DIVISIONS = 4;
const AXIS_FONT_CSS_PX = 10;

function drawFloor(ctx, proj, ink, dpr) {
  ctx.save();
  ctx.strokeStyle = ink;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = dpr;

  const corner = (t, f) => projectPoint(t, f, 0, proj);
  ctx.beginPath();
  const c0 = corner(0, 0);
  ctx.moveTo(c0.x, c0.y);
  for (const [t, f] of [
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const c = corner(t, f);
    ctx.lineTo(c.x, c.y);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.globalAlpha = 0.16;
  ctx.beginPath();
  for (let i = 1; i < FLOOR_DIVISIONS; i++) {
    const k = i / FLOOR_DIVISIONS;
    const a = corner(k, 0);
    const b = corner(k, 1);
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    const c = corner(0, k);
    const d = corner(1, k);
    ctx.moveTo(c.x, c.y);
    ctx.lineTo(d.x, d.y);
  }
  ctx.stroke();
  ctx.restore();
}

/**
 * Axis names drawn along their own projected edge.
 *
 * Font size is multiplied by the device pixel ratio because the canvas coordinate system is
 * device pixels (see useCanvasSize / the DPI note in AGENTS.md), not CSS pixels. The ratio is
 * derived from the canvas's own dimensions rather than read from window.devicePixelRatio, because
 * useCanvasSize accepts options that can cap the ratio per axis, and reading the global would then
 * disagree with reality.
 *
 * This also means labels follow the Windows Accessibility text-size factor, which
 * devicePixelRatio already includes inside the webview. That is correct behaviour and must not be
 * "fixed" later.
 *
 * ctx.font does not resolve CSS custom properties -- an unresolvable value is silently ignored,
 * leaving the previous font -- so the font family is resolved via getComputedStyle (the cssVar
 * helper above) before being interpolated into the font string.
 */
function drawAxisLabels(ctx, proj, ink, dpr) {
  const fontFamily = cssVar(ctx.canvas, "--ui-font-mono", "monospace");
  const edges = [
    { label: "Time", from: [0, 0], to: [1, 0] },
    { label: "Frequency", from: [1, 0], to: [1, 1] },
  ];
  ctx.save();
  ctx.fillStyle = ink;
  ctx.globalAlpha = 0.75;
  ctx.font = `${AXIS_FONT_CSS_PX * dpr}px ${fontFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const edge of edges) {
    const a = projectPoint(edge.from[0], edge.from[1], 0, proj);
    const b = projectPoint(edge.to[0], edge.to[1], 0, proj);
    // atan2 alone can land past +/-90 degrees, which renders the label upside down; flip to the
    // opposite direction along the same line to keep it upright.
    let angle = Math.atan2(b.y - a.y, b.x - a.x);
    if (angle > Math.PI / 2) angle -= Math.PI;
    else if (angle < -Math.PI / 2) angle += Math.PI;
    ctx.save();
    ctx.translate((a.x + b.x) / 2, (a.y + b.y) / 2);
    ctx.rotate(angle);
    ctx.fillText(edge.label, 0, 4 * dpr);
    ctx.restore();
  }
  ctx.restore();
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
  const lastPaintRef = useRef({
    len: -1,
    version: -1,
    oldestMs: NaN,
    newestMs: NaN,
    sel: -1,
    W: 0,
    H: 0,
    minHz: 20,
    maxHz: 20000,
    colormapLut: null,
    azimuthDeg: NaN,
    elevationDeg: NaN,
    heightGain: NaN,
    colorize: undefined,
    selectionXFrac: NaN,
  });

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

      const snaps = p.frozenSnaps ?? snapRef.current;
      const len = snaps ? snaps.length : 0;
      const version = snaps?.version ?? 0;

      // Spectrum frames land at 25 Hz while requestAnimationFrame ticks at up to 60 Hz, so most
      // frames have nothing new to show. Repainting a 3D mesh is far more expensive than the 2D
      // heatmap blit, which makes this skip more important here, not less: redraw only when
      // something that can change the picture actually moved, including the view (azimuth,
      // elevation, height gain, colorize) and the scrub position, not just the data.
      const last = lastPaintRef.current;
      if (
        last.len === len &&
        last.version === version &&
        last.oldestMs === p.oldestMs &&
        last.newestMs === p.newestMs &&
        last.sel === p.selectedOffset &&
        last.W === W &&
        last.H === H &&
        last.minHz === p.minHz &&
        last.maxHz === p.maxHz &&
        last.colormapLut === p.colormapLut &&
        last.azimuthDeg === p.azimuthDeg &&
        last.elevationDeg === p.elevationDeg &&
        last.heightGain === p.heightGain &&
        last.colorize === p.colorize &&
        last.selectionXFrac === p.selectionXFrac
      )
        return;
      lastPaintRef.current = {
        len,
        version,
        oldestMs: p.oldestMs,
        newestMs: p.newestMs,
        sel: p.selectedOffset,
        W,
        H,
        minHz: p.minHz,
        maxHz: p.maxHz,
        colormapLut: p.colormapLut,
        azimuthDeg: p.azimuthDeg,
        elevationDeg: p.elevationDeg,
        heightGain: p.heightGain,
        colorize: p.colorize,
        selectionXFrac: p.selectionXFrac,
      };

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

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

      const ink = cssVar(canvas, "--muted-foreground", "#888");
      const selection = cssVar(canvas, "--ui-loudness-selection", ink);
      const heightPx = proj.heightScale * view.heightGain;

      const dpr = Math.max(1, W / Math.max(1, canvas.clientWidth));

      drawFloor(ctx, proj, ink, dpr);
      drawAxisLabels(ctx, proj, ink, dpr);

      // At azimuth 0 and 180 the frequency axis has no projected horizontal extent, so a ridge's
      // colour ramp degenerates. That is a legitimate view, not an error — fall back to a
      // monochrome stroke at those angles instead of dividing into it.
      const canColorize = p.colorize && Math.abs(proj.fx) > 1e-6;

      // Scrub feedback: a vertical line through a 3D scene means nothing, so the selected ridge is
      // highlighted instead. selectionXFrac is the same 0..1 window fraction the 2D selection line
      // uses, so both modes mark the same moment.
      const selectedRidge =
        p.selectedOffset >= 0 && Number.isFinite(p.selectionXFrac)
          ? Math.min(ridgeCount - 1, Math.max(0, Math.round(p.selectionXFrac * (ridgeCount - 1))))
          : -1;

      ctx.lineJoin = "round";
      // Line widths are in the canvas coordinate system, which useCanvasSize sizes in DEVICE
      // pixels. A literal 1 is therefore a sub-CSS-pixel hairline on any scaled display, and the
      // whole mesh washes out. Same trap as ctx.font below — both must scale by dpr.
      ctx.lineWidth = dpr;

      // Line waterfall: ridges are stroked, never filled.
      //
      // An earlier design filled each ridge opaquely so it would occlude the ones behind it
      // (hidden-line removal). That reads well only when successive ridges separate enough
      // vertically on screen, which needs a high elevation angle. PLVS panels are wide and short,
      // which forces a low elevation, and there the front ridge's fill swallows the entire
      // interior of the surface: you see an outline and nothing else. Unfilled strokes let the
      // density of the ridges themselves carry the surface.
      //
      // Dropping the fill also removes all overdraw, which was the largest unknown in the design's
      // performance model, and removes the need to resolve an opaque surface colour at all.
      const first = proj.ridgeOrderAscending ? 0 : ridgeCount - 1;
      const step = proj.ridgeOrderAscending ? 1 : -1;
      for (let n = 0; n < ridgeCount; n++) {
        const r = first + n * step;
        if (!grid.present[r]) continue;
        const tFrac = (r + 0.5) / ridgeCount;
        const base = r * grid.pointCount;

        const curve = new Path2D();
        for (let q = 0; q < grid.pointCount; q++) {
          const fFrac = q / (grid.pointCount - 1);
          const pt = projectPoint(tFrac, fFrac, grid.heights[base + q] * view.heightGain, proj);
          if (q === 0) curve.moveTo(pt.x, pt.y);
          else curve.lineTo(pt.x, pt.y);
        }
        const startBase = projectPoint(tFrac, 0, 0, proj);

        if (r === selectedRidge) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = selection;
          ctx.lineWidth = dpr * 2;
          ctx.stroke(curve);
          ctx.lineWidth = dpr;
        } else {
          // Partial alpha is what makes an unfilled waterfall read as a surface: where ridges
          // overlap they accumulate, so dense regions darken and the eye recovers the depth the
          // missing occlusion would have given. At full opacity it flattens into a tangle.
          ctx.globalAlpha = RIDGE_ALPHA;
          ctx.strokeStyle = canColorize
            ? buildRidgeGradient(ctx, p.colormapLut, startBase, proj, heightPx)
            : ink;
          ctx.stroke(curve);
        }
        ctx.globalAlpha = 1;
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef]);
}
