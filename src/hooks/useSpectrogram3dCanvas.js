import { useEffect, useRef } from "react";
import { buildYToBand } from "../math/spectrogramMath.js";
import { inWindowRange } from "../math/spectrogramTimeline.js";
import {
  buildProjection,
  projectPoint,
  clampViewParams,
  labelEdges,
} from "../math/spectrogram3dProjection.js";
import { sampleWaterfallGrid } from "../math/spectrogram3dGrid.js";
import { spectrogramColorFracFromHeight } from "../theme/spectrogramColormap.js";
import {
  buildRowLut,
  buildSurfaceLut,
  columnFloorSpan,
  columnStrideFor,
  packArgb,
  rasterizeSurface,
  smoothGridFrequency,
  smoothGridTime,
} from "../math/spectrogram3dSurface.js";

// Cost tracks the product of these two, so they can be traded against each other while tuning:
// more ridges reads as denser time resolution, more points as finer spectral detail.
const RIDGE_TARGET_DIVISOR = 14;
const RIDGE_MIN = 24;
const RIDGE_MAX = 140;
const POINT_TARGET_DIVISOR = 6;
const POINT_MIN = 60;
const POINT_MAX = 320;
const GRADIENT_STOPS = 16;
// How many ridge spacings the old-end fade is spread over. Enough to read as a dissolve rather
// than a blink, short enough that it costs almost none of the visible history.
const EDGE_FADE_RIDGES = 2.5;

function ridgeCountFor(widthPx) {
  return Math.round(Math.min(RIDGE_MAX, Math.max(RIDGE_MIN, widthPx / RIDGE_TARGET_DIVISOR)));
}

function pointCountFor(widthPx) {
  return Math.round(Math.min(POINT_MAX, Math.max(POINT_MIN, widthPx / POINT_TARGET_DIVISOR)));
}

/**
 * The most samples any single column takes along the time axis, which is the ceiling on how many
 * grid rows Surface can resolve. Rows past it add grid-build cost without adding a resolvable
 * sample -- see the precondition on `rasterizeSurface`. (Interpolation between rows keeps a
 * sub-row window slide smooth; the cap is about not paying for rows no column can show, not about
 * the re-binding shimmer nearest-row sampling had.)
 *
 * The maximum is the column through the floor's centre, because that is the longest chord, so this
 * is one `columnFloorSpan` call rather than a scan. Lines does not need it: it strokes each ridge
 * as a path rather than point-sampling per column, so its ridge count is bounded only by cost.
 */
function surfaceRowCap(proj, height) {
  const span = columnFloorSpan(Math.round(proj.originX), proj, height);
  return span ? span.steps : 1;
}

function cssVar(el, name, fallback) {
  const value = getComputedStyle(el).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * Rows within this multiple of the decimation stride count as covering a sample; see buildRowLut.
 * Scaled by the STRIDE, not by the mean row spacing: at capture start the few captured rows all
 * sit at the newest end of a full-width window, and a tolerance derived from `span / count` grows
 * with the emptiness -- count = 2 makes it 1.5x the whole window, so the two frames get held
 * across time they contain no data for, which renders as giant extruded ridges. The stride is
 * independent of how much history exists, so the empty region stays the hole it is in 2D.
 */
const ROW_LUT_SIZE = 1024;
const ROW_GAP_TOLERANCE = 1.5;

/**
 * Resolve a CSS colour string to a packed ARGB word.
 *
 * The per-pixel renderer cannot ask the canvas to parse a colour per sample, and the theme's values
 * may be `oklch()`, which no amount of string handling will convert. So the canvas parses it once:
 * fill a single pixel and read it back. Cached on the string, because the only thing that changes it
 * is a theme switch.
 */
function makeArgbResolver() {
  let lastCss = null;
  let lastArgb = packArgb(255, 255, 255, 255);
  return (ctx, css) => {
    if (css === lastCss) return lastArgb;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    ctx.restore();
    lastCss = css;
    lastArgb = packArgb(r, g, b, a);
    return lastArgb;
  };
}

/**
 * A reused offscreen canvas plus a Uint32 view over its ImageData.
 *
 * The surface is composited with `drawImage` rather than `putImageData` because putImageData
 * OVERWRITES, alpha included -- writing the surface straight to the main canvas would erase the
 * floor grid drawn beneath it. Rebuilt only on resize.
 */
function ensureOffscreen(ref, width, height) {
  const current = ref.current;
  if (current && current.canvas.width === width && current.canvas.height === height) return current;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(width, height);
  const next = { canvas, ctx, image, pixels: new Uint32Array(image.data.buffer) };
  ref.current = next;
  return next;
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
 *
 * Colour itself is absolute, not floor-relative: height fraction `s` along the ramp corresponds to
 * a specific dB (the floor-relative height mapping, inverted), and that dB is then run through
 * spectrogramColorFrac against the fixed dB range. This keeps a given dB the same colour regardless
 * of where dbFloor is set, even though the ridge's on-screen height still depends on it.
 */
/**
 * The ramp's colour stops. Identical for every ridge -- only the gradient's endpoints move -- so
 * they are built once per repaint rather than once per ridge.
 *
 * Alpha tracks level, matching what the 2D heatmap has always done (`paintSpan` writes
 * `t * 255` straight into the alpha byte). Without it, silence draws a dense stack of fully opaque
 * lines lying on the floor, as visually heavy as real content. Colorize only appeared to avoid this
 * because the colormap's bottom is dark and dark-on-dark recedes -- an accident of the theme, not a
 * property of the mapping, so both branches need the real thing.
 *
 * The monochrome branch goes through `color-mix` rather than composing an `rgba()` string: `ink`
 * comes from a CSS variable and may be any colour syntax. Reading it back through `ctx.fillStyle`
 * normalises hex but returns `oklch()` untouched, and this project's dark theme uses oklch.
 */
function buildStopColors(colormapLut, ink, dbFloor, colorize) {
  const stops = new Array(GRADIENT_STOPS + 1);
  for (let s = 0; s <= GRADIENT_STOPS; s++) {
    const t = spectrogramColorFracFromHeight(s / GRADIENT_STOPS, dbFloor);
    if (colorize) {
      const idx = Math.round(t * 255) * 3;
      stops[s] = `rgba(${colormapLut[idx]},${colormapLut[idx + 1]},${colormapLut[idx + 2]},${t})`;
    } else {
      stops[s] = `color-mix(in srgb, ${ink} ${(t * 100).toFixed(2)}%, transparent)`;
    }
  }
  return stops;
}

function buildRidgeGradient(ctx, stopColors, startBase, proj, heightPx) {
  const denom = proj.fx * proj.fx + proj.fy * proj.fy;
  const k = (-heightPx * proj.fx) / denom;
  const gradient = ctx.createLinearGradient(
    startBase.x,
    startBase.y,
    startBase.x - k * proj.fy,
    startBase.y + k * proj.fx
  );
  for (let s = 0; s <= GRADIENT_STOPS; s++) {
    gradient.addColorStop(s / GRADIENT_STOPS, stopColors[s]);
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

  const { timeAtF, freqAtT } = labelEdges(proj);
  const edges = [
    { label: "Time", from: [0, timeAtF], to: [1, timeAtF] },
    { label: "Frequency", from: [freqAtT, 0], to: [freqAtT, 1] },
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
  projectionRef,
  oldestMs,
  newestMs,
  sampleMs,
  selectedOffset,
  selectionXFrac,
  frozenSnaps,
  colormapLut,
  minHz = 20,
  maxHz = 20000,
  dbFloor,
  azimuthDeg,
  elevationDeg,
  heightGain,
  colorize,
  lineAlpha,
  lineWidth,
  floor,
  mode,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({ pointCount: 0, minHz: 0, maxHz: 0, bands: null, yToBand: null });
  const offscreenRef = useRef(null);
  const surfaceLutRef = useRef({ colorize: undefined, dbFloor: NaN, colormapLut: null, lut: null });
  const resolveArgbRef = useRef(makeArgbResolver());
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
    dbFloor: NaN,
    azimuthDeg: NaN,
    elevationDeg: NaN,
    heightGain: NaN,
    colorize: undefined,
    selectionXFrac: NaN,
    lineAlpha: NaN,
    lineWidth: NaN,
    floor: undefined,
    mode: undefined,
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
      dbFloor,
      azimuthDeg,
      elevationDeg,
      heightGain,
      colorize,
      lineAlpha,
      lineWidth,
      floor,
      mode,
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
    dbFloor,
    azimuthDeg,
    elevationDeg,
    heightGain,
    colorize,
    lineAlpha,
    lineWidth,
    floor,
    mode,
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
        last.dbFloor === p.dbFloor &&
        last.azimuthDeg === p.azimuthDeg &&
        last.elevationDeg === p.elevationDeg &&
        last.heightGain === p.heightGain &&
        last.colorize === p.colorize &&
        last.selectionXFrac === p.selectionXFrac &&
        last.lineAlpha === p.lineAlpha &&
        last.lineWidth === p.lineWidth &&
        last.floor === p.floor &&
        last.mode === p.mode
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
        dbFloor: p.dbFloor,
        azimuthDeg: p.azimuthDeg,
        elevationDeg: p.elevationDeg,
        heightGain: p.heightGain,
        colorize: p.colorize,
        selectionXFrac: p.selectionXFrac,
        lineAlpha: p.lineAlpha,
        lineWidth: p.lineWidth,
        floor: p.floor,
        mode: p.mode,
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
      // Published so the panel can turn a cursor position back into (time, frequency). Pointer
      // handling cannot be derived from the 2D layout once the floor is rotated.
      if (projectionRef) projectionRef.current = proj;

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

      // Surface point-samples the time axis per column, so its row count is additionally capped by
      // how many samples the longest column actually takes -- see surfaceRowCap. Lines strokes a
      // complete path per ridge instead of point-sampling, so ridgeCountFor(W) alone is still right
      // for it, and this cap must not apply there.
      const maxRidges =
        p.mode === "surface"
          ? Math.min(ridgeCountFor(W), surfaceRowCap(proj, H))
          : ridgeCountFor(W);
      const grid = sampleWaterfallGrid({
        view: snaps,
        startIdx,
        endIdx,
        oldestMs: p.oldestMs,
        span,
        sampleMs: p.sampleMs,
        maxRidges,
        yToBand: cache.yToBand,
        dbFloor: p.dbFloor,
      });
      if (grid.count === 0) return;

      const ink = cssVar(canvas, "--muted-foreground", "#888");
      // Surface's monochrome ramp runs against the BRIGHTER foreground token: a solid terrain
      // needs the contrast, where floor lines and Lines' strokes read fine at muted. Everything
      // else in this hook keeps using `ink`.
      const foreground = cssVar(canvas, "--foreground", "#fff");
      const selection = cssVar(canvas, "--ui-loudness-selection", ink);
      const heightPx = proj.heightScale * view.heightGain;

      const dpr = Math.max(1, W / Math.max(1, canvas.clientWidth));

      if (p.floor) {
        drawFloor(ctx, proj, ink, dpr);
        drawAxisLabels(ctx, proj, ink, dpr);
      }

      // Scrub feedback: a vertical line through a 3D scene means nothing, so the selected ridge (or,
      // in Surface, the row nearest the selected time) is highlighted instead. selectionXFrac is the
      // same 0..1 window fraction the 2D selection line uses, so both modes mark the same moment.
      // Rows sit at their own timestamps rather than on a regular grid, so the nearest one has to be
      // searched for. Shared by both modes, so it runs before the branch.
      let selectedRidge = -1;
      if (p.selectedOffset >= 0 && Number.isFinite(p.selectionXFrac)) {
        let bestDelta = Infinity;
        for (let r = 0; r < grid.count; r++) {
          const delta = Math.abs(grid.tFracs[r] - p.selectionXFrac);
          if (delta < bestDelta) {
            bestDelta = delta;
            selectedRidge = r;
          }
        }
      }

      if (p.mode === "surface") {
        // Surface-only: flatten per-bin jitter into terrain (see the two smoothers' docs). The
        // grid is rebuilt on every repaint, so mutating it here cannot leak into the Lines branch
        // of a later frame; within THIS frame the branches are exclusive.
        smoothGridFrequency(grid.heights, grid.count, grid.pointCount);
        // Tolerance in tFrac: 1.5x the decimation stride. Fall back to the old mean-spacing
        // formula only when the stride is unusable (non-finite span / sampleMs), where the mean
        // is the best available estimate of it. The row LUT's coverage and the time smoother's
        // gap detection share the value, so "gap" means the same thing in both.
        const strideTFrac = grid.strideMs / span;
        const rowGapTFrac = Number.isFinite(strideTFrac)
          ? ROW_GAP_TOLERANCE * strideTFrac
          : ROW_GAP_TOLERANCE / Math.max(1, grid.count - 1);
        smoothGridTime(grid.heights, grid.tFracs, grid.count, grid.pointCount, rowGapTFrac);
        const off = ensureOffscreen(offscreenRef, W, H);
        // The monochrome ramp needs the theme ink as RGB. resolveArgbRef probes a colour by
        // writing a pixel to the offscreen canvas and reading it back; probing before the LUT
        // cache check (and before off.pixels.fill(0)) keeps the probe write from being confused
        // with buffer prep -- it is not load-bearing, putImageData below overwrites the whole
        // canvas regardless.
        const inkArgb = p.colorize ? 0 : resolveArgbRef.current(off.ctx, foreground);
        // Cached by identity, matching the repaint-skip guard's `last.colormapLut === p.colormapLut`
        // above: the theme layer hands the hook a new array whenever the colormap actually changes,
        // so identity is sufficient. Do not switch this to a stringified key -- colormapLut is a
        // 768-element Uint8Array, and interpolating it into a string calls toString() on every
        // repaint that reaches this branch, which is the renderer's hot path. inkArgb is part of
        // the key: a theme switch can move --foreground without touching the colormap.
        const cachedLut = surfaceLutRef.current;
        if (
          cachedLut.colorize !== p.colorize ||
          cachedLut.dbFloor !== p.dbFloor ||
          cachedLut.colormapLut !== p.colormapLut ||
          cachedLut.inkArgb !== inkArgb
        ) {
          surfaceLutRef.current = {
            colorize: p.colorize,
            dbFloor: p.dbFloor,
            colormapLut: p.colormapLut,
            inkArgb,
            lut: buildSurfaceLut({
              colormapLut: p.colormapLut,
              dbFloor: p.dbFloor,
              colorize: p.colorize,
              ink: { r: inkArgb & 0xff, g: (inkArgb >>> 8) & 0xff, b: (inkArgb >>> 16) & 0xff },
            }),
          };
        }
        const rowLut = buildRowLut(grid.tFracs, grid.count, ROW_LUT_SIZE, rowGapTFrac);
        // resolveArgbRef probes a colour by writing a pixel to the offscreen canvas and reading it
        // back. Doing that before off.pixels.fill(0) keeps the probe write and the buffer prep from
        // being confused with each other; it is not load-bearing -- putImageData below writes the
        // whole canvas regardless of what the probe left behind.
        const highlightArgb = resolveArgbRef.current(off.ctx, selection);
        off.pixels.fill(0);
        rasterizeSurface({
          out: off.pixels,
          width: W,
          height: H,
          proj,
          grid,
          rowLut,
          lut: surfaceLutRef.current.lut,
          heightGain: view.heightGain,
          highlightArgb,
          highlightRow: selectedRidge,
          columnStride: columnStrideFor(W, H),
          maxSteps: H,
        });
        off.ctx.putImageData(off.image, 0, 0);
        ctx.drawImage(off.canvas, 0, 0);
        return;
      }

      // Both branches ramp now -- colorize picks the colour from the colormap, monochrome varies
      // only alpha -- so the stops are built once per repaint and reused by every ridge.
      //
      // At azimuth 0 and 180 the frequency axis has no projected horizontal extent and the ramp's
      // geometry degenerates. That is a legitimate view, not an error: fall back to a flat opaque
      // stroke at exactly those two angles instead of dividing into it.
      const canRamp = Math.abs(proj.fx) > 1e-6;
      const stopColors = canRamp
        ? buildStopColors(p.colormapLut, ink, p.dbFloor, p.colorize)
        : null;

      ctx.lineJoin = "round";
      // Line widths are in the canvas coordinate system, which useCanvasSize sizes in DEVICE
      // pixels. A literal 1 is therefore a sub-CSS-pixel hairline on any scaled display, and the
      // whole mesh washes out. Same trap as ctx.font below — both must scale by dpr. p.lineWidth is
      // a user multiplier on top of that device-pixel base, not an absolute width.
      const baseLineWidth = dpr * p.lineWidth;
      ctx.lineWidth = baseLineWidth;

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
      // Fade ridges out as they reach the old end of the window. Without it a curve slides smoothly
      // toward tFrac 0 at full strength and then vanishes the instant its timestamp leaves range --
      // a whole ridge, at full height, blinking out. The 2D heatmap never shows this because what
      // leaves there is a one-pixel column.
      //
      // The entering end is deliberately NOT faded. The newest ridge is the frame live monitoring
      // is actually watching, and it is the unoccluded focal element of the scene; easing it in
      // would make the current moment permanently the dimmest thing on screen. The two ends are not
      // symmetric in meaning -- arrival is the signal, departure is just history scrolling away.
      //
      // Width is measured in ridge spacings rather than as a fixed fraction of the window, so the
      // fade still reads as "the last few ridges are dissolving" at any ridge count.
      const fadeSpan = EDGE_FADE_RIDGES / Math.max(1, grid.count);

      // Ridges arrive in ascending timestamp order, so painting far-to-near is just a matter of
      // which end to start from.
      const first = proj.ridgeOrderAscending ? 0 : grid.count - 1;
      const step = proj.ridgeOrderAscending ? 1 : -1;
      for (let n = 0; n < grid.count; n++) {
        const r = first + n * step;
        const tFrac = grid.tFracs[r];
        const base = r * grid.pointCount;

        const curve = new Path2D();
        for (let q = 0; q < grid.pointCount; q++) {
          const fFrac = q / (grid.pointCount - 1);
          const pt = projectPoint(tFrac, fFrac, grid.heights[base + q] * view.heightGain, proj);
          if (q === 0) curve.moveTo(pt.x, pt.y);
          else curve.lineTo(pt.x, pt.y);
        }
        const startBase = projectPoint(tFrac, 0, 0, proj);

        const edgeFade = tFrac < fadeSpan ? Math.max(0, tFrac) / fadeSpan : 1;

        if (r === selectedRidge) {
          ctx.globalAlpha = edgeFade;
          ctx.strokeStyle = selection;
          ctx.lineWidth = baseLineWidth * 2;
          ctx.stroke(curve);
          ctx.lineWidth = baseLineWidth;
        } else {
          // Lowering lineAlpha lets overlapping ridges accumulate, so dense regions darken and the
          // eye recovers some of the depth the missing occlusion would have given. It defaults to
          // opaque because the colour ramp already separates near from far; the control is there
          // for material where the ridges crowd each other.
          ctx.globalAlpha = p.lineAlpha * edgeFade;
          ctx.strokeStyle = stopColors
            ? buildRidgeGradient(ctx, stopColors, startBase, proj, heightPx)
            : ink;
          ctx.stroke(curve);
        }
        ctx.globalAlpha = 1;
      }
    }

    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [canvasRef, snapRef, projectionRef]);
}
