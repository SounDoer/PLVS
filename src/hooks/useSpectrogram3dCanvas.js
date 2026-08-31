import { useEffect, useRef } from "react";
import { DEFAULT_SPECTROGRAM_CANVAS_THEME } from "../theme/themeCanvasSelectors.js";
import {
  beginPanelCpuSample,
  finishPanelCpuSample,
  recordPanelCpuEvent,
} from "../dev/panelCpuProfiler.js";
import { buildYToBand, buildYTiltDb } from "../math/spectrogramMath.js";
import { inWindowRange } from "../math/spectrogramTimeline.js";
import {
  buildProjection,
  projectPoint,
  projectPointInto,
  clampViewParams,
  labelEdges,
} from "../math/spectrogram3dProjection.js";
import { sampleWaterfallGrid } from "../math/spectrogram3dGrid.js";
import { spectrogramColorFracFromHeight } from "../theme/spectrogramColormap.js";
import { readCssToken } from "../theme/cssTokens.js";
import {
  buildSurfaceLut,
  columnFloorSpan,
  edgeFade,
  edgeRampWidth,
  fadeGridFrequencyEdges,
  packArgb,
  smoothGridFrequency,
  smoothGridTime,
} from "../math/spectrogram3dSurface.js";
import { buildSurfaceMesh } from "../math/spectrogram3dMesh.js";
import { buildGlUniforms } from "../math/spectrogram3dGlUniforms.js";
import { createSurfaceRenderer } from "./spectrogram3dGlRenderer.js";

// Cost tracks the product of these two, so they can be traded against each other while tuning:
// more ridges reads as denser time resolution, more points as finer spectral detail.
const RIDGE_TARGET_DIVISOR = 14;
const RIDGE_MIN = 24;
const RIDGE_MAX = 140;
/**
 * Surface's own row ceiling, well above `RIDGE_MAX`, because the two modes pay for a row in
 * completely different places. Lines strokes one Path2D per ridge, so its cost is linear in the row
 * count and 140 is a budget. Surface rasterises per PIXEL: measured at 1920x600, going from 140 to
 * 400 rows moves the repaint from 9.87 ms to 10.39 ms -- the rasteriser itself does not move at all,
 * and the half-millisecond is grid build plus the two smoothers.
 *
 * So the real bound on Surface is what the projection can resolve (`surfaceRowCap`), which is 392
 * rows at 1920x600 and 588 at 2560x900. Sharing Lines' 140 discarded most of the captured frames
 * for nothing: a 10s window holds 250 frames and used 125, a 20s window holds 500 and used the same
 * 125, and the terrain between two kept frames is interpolated rather than measured.
 *
 * 400 rather than the projection's own cap: it covers 1920x600 outright and most of 2560x900, and
 * it bounds what the grid allocates per repaint. `sampleWaterfallGrid` builds fresh arrays every
 * time, so the row count sets a garbage rate -- 400 x 320 floats is 512 KB per repaint at 25 Hz.
 * Lifting this further is a buffer-reuse question before it is a resolution one.
 */
const SURFACE_RIDGE_MAX = 400;
const POINT_TARGET_DIVISOR = 6;
const POINT_MIN = 60;
const POINT_MAX = 320;
const GRADIENT_STOPS = 16;
/**
 * Ridge stroke width, in DEVICE pixels, and the one number in this file that must not be raised.
 *
 * One device pixel is the boundary of the renderer's hairline fast path: a stroke that wide is
 * rasterised as line segments, while anything wider is first tessellated into filled polygons --
 * two triangles per segment, plus joins and antialiased edges. Lines submits ~100 ridges of ~230
 * points, so crossing the boundary means building well over a million triangles a second.
 *
 * Measured in a real window at 1383x640 (`docs/working/perf/spectrogram.md` §1): the mesh costs
 * 16.9% of the GPU's 3d engine and 288 ms/s of GPU-process CPU at the themed width, and 3.8% and
 * 14 ms/s at one device pixel. It is a cliff, not a ramp -- 1.05 costs the same as 3.0 -- so there
 * is nothing to gain by inching above it, and the whole saving is lost by exceeding it at all.
 * Neither the per-ridge gradients nor the round joins move the number; both were measured.
 *
 * The cost of this is that the mesh does not follow `--ui-spectrum-stroke-width` any more, and on a
 * scaled display a hairline is thinner than a CSS pixel. That was once reported as "the 3D lines
 * look thinner" and is now a deliberate trade, taken on the screenshots. The selected ridge is the
 * exception and still reads the token -- see where it is stroked.
 */
const RIDGE_LINE_WIDTH = 1;
// How many ridge spacings the old-end fade is spread over. Enough to read as a dissolve rather
// than a blink, short enough that it costs almost none of the visible history. Lines multiplies it
// by its own row spacing; Surface, whose row count is no longer the same number, by
// `fadeStrideTFrac` -- see where that is derived.
const EDGE_FADE_RIDGES = 2.5;
// Surface's entering-edge fade, in the same units as EDGE_FADE_RIDGES. Still narrower than the
// exiting edge on purpose -- it must not dim the live moment out of the frame -- but not as narrow
// as it can be: at one stride the entering ramp was 2.5x steeper than the exiting one, so the same
// mechanism read as a pop on arrival and as a dissolve on departure. See edgeFade.
const ENTER_FADE_STRIDES = 2;
// The frequency limits' ramp, as a fraction of the frequency axis. See fadeGridFrequencyEdges --
// unlike the time ends, nothing pops here, so this buys only the closed silhouette.
const FREQ_FADE_FRAC = 0.02;

/**
 * Caps on how much of an axis an edge ramp may swallow while chasing `EDGE_RAMP_SLOPE`.
 *
 * The two are different because what they spend is different. A time ramp costs history at the
 * window's own edge -- at the newest end that is the live moment, which is why this is a tenth of
 * the window and not more: at a 60s window it sinks the newest 4.2s, at the 5s minimum only 0.35s,
 * and short windows are where flattening the view actually happens.
 *
 * A frequency ramp costs the band the user explicitly asked for, on a LOG axis, where a small
 * fraction is a large number of Hz -- 6% of a 20 Hz - 20 kHz range is the bottom 20-30 Hz but also
 * the top 13.3-20 kHz. Hence the tighter cap, and the frequency ends staying slightly steeper than
 * the time ends at flat views rather than eating an octave to match them.
 */
const TIME_FADE_MAX_FRAC = 0.1;
const FREQ_FADE_MAX_FRAC = 0.06;

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
  // Cached per theme: these resolve inside a paint that runs every frame. See `readCssToken`.
  return readCssToken(el, name, fallback);
}

/**
 * Rows within this multiple of the decimation stride count as covering a sample; see buildRowLut.
 * Scaled by the STRIDE, not by the mean row spacing: at capture start the few captured rows all
 * sit at the newest end of a full-width window, and a tolerance derived from `span / count` grows
 * with the emptiness -- count = 2 makes it 1.5x the whole window, so the two frames get held
 * across time they contain no data for, which renders as giant extruded ridges. The stride is
 * independent of how much history exists, so the empty region stays the hole it is in 2D.
 */
/**
 * The row LUT quantises the time axis, so it has to stay comfortably finer than the row spacing or
 * it becomes the resolution limit instead of the row count. At `SURFACE_RIDGE_MAX` rows, 1024
 * buckets left 2.6 per row -- adjacent rows collapsing into one bucket, which would have eaten the
 * resolution the higher cap exists to buy. 4096 gives 10 buckets per row at the ceiling and 7 at
 * the largest projection cap measured (588 rows), for 0.026 ms against 1024's 0.007.
 */
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
  // Keyed by string rather than remembering only the last one. A single slot looks sufficient --
  // each colour is resolved once per repaint -- but the Surface branch resolves TWO of them, the
  // monochrome ink and the selection colour, and they alternate. A one-slot cache then misses on
  // both, every repaint, and each miss is a `getImageData` readback: 50 a second at the 25 Hz data
  // rate and 120 while a rotate drag is running the repaint at frame rate. Colorize hid it by
  // short-circuiting the ink, so only Monochrome paid.
  //
  // The key space is the theme's colour tokens, so it is a handful of entries and does not need
  // eviction. The guard is there only so a caller that started generating colours could not turn
  // this into an unbounded map without anyone noticing.
  const cache = new Map();
  return (ctx, css) => {
    const hit = cache.get(css);
    if (hit !== undefined) return hit;
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    ctx.restore();
    const argb = packArgb(r, g, b, a);
    if (cache.size >= 16) cache.clear();
    cache.set(css, argb);
    return argb;
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
 * A vertical one (`fx = 0`, azimuth 0 or 180) degenerates to `k = 0` 鈥?the same degenerate view the
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

/** A packed ARGB word as the 0..1 RGBA vector a GL uniform takes. */
function argbToRgba(argb) {
  return [
    (argb & 0xff) / 255,
    ((argb >>> 8) & 0xff) / 255,
    ((argb >>> 16) & 0xff) / 255,
    ((argb >>> 24) & 0xff) / 255,
  ];
}

/**
 * What a dead GL context leaves on screen.
 *
 * One line, on the 2D canvas, in place of the surface. The panel deliberately does NOT fall back to
 * another mode: a meter that quietly starts showing something other than what was asked for is
 * worse than one that says it is broken, and switching back is the user's action to take.
 */
function drawSurfaceError(ctx, width, height, ink) {
  const dpr = Math.max(1, width / Math.max(1, ctx.canvas.clientWidth));
  const fontPx = parseFloat(cssVar(ctx.canvas, "--ui-fs-axis", "11")) || 11;
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${fontPx * dpr}px ${cssVar(ctx.canvas, "--ui-font-mono", "monospace")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("3D surface unavailable: graphics context lost", width / 2, height / 2);
  ctx.restore();
}

const FLOOR_DIVISIONS = 4;

function drawFloor(ctx, proj, grid, gridSubtle, dpr) {
  ctx.save();
  ctx.strokeStyle = grid;
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

  ctx.strokeStyle = gridSubtle;
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
  // Same token the DOM axis labels on every other chart read, so these track
  // Interface Size with them instead of sitting at a fixed 10px.
  const fontPx = parseFloat(cssVar(ctx.canvas, "--ui-fs-axis", "11")) || 11;

  const { timeAtF, freqAtT } = labelEdges(proj);
  const edges = [
    { label: "Time", from: [0, timeAtF], to: [1, timeAtF] },
    { label: "Frequency", from: [freqAtT, 0], to: [freqAtT, 1] },
  ];
  ctx.save();
  ctx.fillStyle = ink;
  ctx.font = `${fontPx * dpr}px ${fontFamily}`;
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
  glCanvasRef,
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
  tiltDbPerOctave = 0,
  azimuthDeg,
  elevationDeg,
  heightGain,
  colorize,
  floor,
  mode,
  themeColors,
  sourceVersion = 0,
  canvasSizeRevision = 0,
  enabled = true,
}) {
  const rafRef = useRef(null);
  const paramsRef = useRef({});
  const cacheRef = useRef({
    pointCount: 0,
    minHz: 0,
    maxHz: 0,
    tiltDbPerOctave: NaN,
    bands: null,
    yToBand: null,
    yTiltDb: null,
  });
  const offscreenRef = useRef(null);
  const surfaceLutRef = useRef({
    colorize: undefined,
    dbFloor: NaN,
    colormapLut: null,
    lut: null,
  });
  const resolveArgbRef = useRef(makeArgbResolver());
  // The GL renderer, and the canvas it was built against. Surface mode mounts a fresh canvas every
  // time it is entered, and a renderer holds a context bound to one canvas, so the pair has to be
  // remembered together: comparing them is how a stale renderer gets torn down rather than drawn
  // into a canvas that is no longer in the tree.
  const rendererRef = useRef({ canvas: null, renderer: null });
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
    tiltDbPerOctave: NaN,
    azimuthDeg: NaN,
    elevationDeg: NaN,
    heightGain: NaN,
    colorize: undefined,
    selectionXFrac: NaN,
    floor: undefined,
    mode: undefined,
    themeColors: null,
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
      tiltDbPerOctave,
      azimuthDeg,
      elevationDeg,
      heightGain,
      colorize,
      floor,
      mode,
      themeColors,
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
    tiltDbPerOctave,
    azimuthDeg,
    elevationDeg,
    heightGain,
    colorize,
    floor,
    mode,
    themeColors,
  ]);

  // The GL context outlives every repaint, so it has to be released on unmount rather than on the
  // next draw -- there is no next draw.
  useEffect(() => {
    const held = rendererRef.current;
    return () => {
      held.renderer?.dispose();
      if (rendererRef.current === held) rendererRef.current = { canvas: null, renderer: null };
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function draw() {
      rafRef.current = null;
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
        last.tiltDbPerOctave === p.tiltDbPerOctave &&
        last.azimuthDeg === p.azimuthDeg &&
        last.elevationDeg === p.elevationDeg &&
        last.heightGain === p.heightGain &&
        last.colorize === p.colorize &&
        last.selectionXFrac === p.selectionXFrac &&
        last.floor === p.floor &&
        last.mode === p.mode &&
        last.themeColors === p.themeColors
      ) {
        recordPanelCpuEvent("spectrogram3d", "signatureSkip");
        return;
      }
      recordPanelCpuEvent("spectrogram3d", "dirtyPaint");
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
        tiltDbPerOctave: p.tiltDbPerOctave,
        azimuthDeg: p.azimuthDeg,
        elevationDeg: p.elevationDeg,
        heightGain: p.heightGain,
        colorize: p.colorize,
        selectionXFrac: p.selectionXFrac,
        floor: p.floor,
        mode: p.mode,
        themeColors: p.themeColors,
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
      // handling cannot be derived from the 2D layout once the floor is rotated. This is the
      // full-size projection in every mode: what Surface rasterises into is an implementation
      // detail of one branch, and the cursor lands on the canvas.
      if (projectionRef) projectionRef.current = proj;

      // Surface used to rasterise into a smaller buffer and stretch the result back, because the
      // per-pixel walk cost what it cost. The GPU does not, so there is one pixel space now and
      // every length below is in it.
      const isSurface = p.mode === "surface";

      const pointCount = pointCountFor(W);
      const cache = cacheRef.current;
      if (
        cache.pointCount !== pointCount ||
        cache.minHz !== p.minHz ||
        cache.maxHz !== p.maxHz ||
        cache.tiltDbPerOctave !== p.tiltDbPerOctave ||
        cache.bands !== bands
      ) {
        cache.yToBand = buildYToBand(bands, pointCount, p.minHz, p.maxHz);
        cache.yTiltDb = buildYTiltDb(cache.yToBand, bands, p.tiltDbPerOctave);
        cache.pointCount = pointCount;
        cache.minHz = p.minHz;
        cache.maxHz = p.maxHz;
        cache.tiltDbPerOctave = p.tiltDbPerOctave;
        cache.bands = bands;
      }

      const { startIdx, endIdx } = inWindowRange(snaps, p.oldestMs, p.newestMs);
      if (endIdx < startIdx) return;

      // Surface point-samples the time axis per column, so its row count is additionally capped by
      // how many samples the longest column actually takes -- see surfaceRowCap. Lines strokes a
      // complete path per ridge instead of point-sampling, so ridgeCountFor(W) alone is still right
      // for it, and this cap must not apply there.
      const maxRidges = isSurface
        ? Math.min(SURFACE_RIDGE_MAX, surfaceRowCap(proj, H))
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
        yTiltDb: cache.yTiltDb,
        dbFloor: p.dbFloor,
        // Surface-only, like the two smoothers: it needs the newest frame present as a row so the
        // entering end morphs instead of swapping, where Lines would draw it as a twitching ridge.
        pinLiveRow: p.mode === "surface",
      });
      if (grid.count === 0) return;

      const ink = p.themeColors?.ink ?? DEFAULT_SPECTROGRAM_CANVAS_THEME.ink;
      // Surface's monochrome ramp runs against the BRIGHTER foreground token: a solid terrain
      // needs the contrast, where floor lines and Lines' strokes read fine at muted. Everything
      // else in this hook keeps using `ink`.
      const foreground = p.themeColors?.surfaceInk ?? DEFAULT_SPECTROGRAM_CANVAS_THEME.surfaceInk;
      const gridColor = p.themeColors?.grid ?? ink;
      const axisLabelColor = p.themeColors?.axisLabel ?? gridColor;
      const gridSubtleColor = p.themeColors?.gridSubtle ?? gridColor;
      const selection = p.themeColors?.selection ?? ink;
      const heightPx = proj.heightScale * view.heightGain;

      const dpr = Math.max(1, W / Math.max(1, canvas.clientWidth));
      // Read once for both branches, and only the scrub marker uses it: Lines strokes its selected
      // ridge at this width and Surface sizes its scrub band to it, so the marker carries the same
      // weight whichever mode is showing. Reading the token rather than hardcoding is what keeps
      // that true when the theme moves it. The mesh itself does not follow the token any more --
      // see RIDGE_LINE_WIDTH.
      const strokeCss = parseFloat(cssVar(canvas, "--ui-spectrum-stroke-width", "1.5")) || 1.5;
      const selectedStrokePx = 2 * dpr * strokeCss;

      if (p.floor) {
        // Surface draws its floor in GL instead, one call before the terrain: a WebGL canvas
        // stacked behind a 2D one would put the grid on top of the surface it belongs under.
        // Labels stay here in both modes -- they are text, and text belongs above the scene.
        if (!isSurface) drawFloor(ctx, proj, gridColor, gridSubtleColor, dpr);
        drawAxisLabels(ctx, proj, axisLabelColor, dpr);
      }

      // Scrub feedback: a vertical line through a 3D scene means nothing, so the selected ridge (or,
      // in Surface, the row nearest the selected time) is highlighted instead. selectionXFrac is the
      // same 0..1 window fraction the 2D selection line uses, so both modes mark the same moment.
      // Rows sit at their own timestamps rather than on a regular grid, so the nearest one has to be
      // searched for. Shared by both modes, so it runs before the branch.
      //
      // Over the decimated rows only (`bucketCount` equals `count` unless a live row was pinned):
      // the pinned row sits at the window edge where the entering fade has taken it to ~0 height, so
      // letting it win the search would put the highlight band flat on the floor and take it away
      // from the last row that actually has terrain.
      let selectedRidge = -1;
      if (p.selectedOffset >= 0 && Number.isFinite(p.selectionXFrac)) {
        let bestDelta = Infinity;
        for (let r = 0; r < grid.bucketCount; r++) {
          const delta = Math.abs(grid.tFracs[r] - p.selectionXFrac);
          if (delta < bestDelta) {
            bestDelta = delta;
            selectedRidge = r;
          }
        }
      }

      if (isSurface) {
        const glCanvas = glCanvasRef?.current;
        if (!glCanvas) {
          // Nothing about the canvas appearing moves the repaint signature, so a repaint that
          // reached here without one would latch: the guard above would skip every later frame and
          // the panel would stay blank until some unrelated parameter changed. Give the signature
          // back instead. React commits the canvas in the same pass that switches the mode, so this
          // is insurance rather than an expected path.
          lastPaintRef.current.mode = undefined;
          return;
        }

        // One renderer per canvas. Leaving Surface unmounts the canvas, so the next entry brings a
        // new one and the old context has to go with it rather than leaking a GL context per visit.
        let held = rendererRef.current;
        if (held.canvas !== glCanvas) {
          held.renderer?.dispose();
          try {
            held = { canvas: glCanvas, renderer: createSurfaceRenderer(glCanvas) };
          } catch {
            held = { canvas: glCanvas, renderer: null };
          }
          rendererRef.current = held;
        }
        const renderer = held.renderer;
        // A context that cannot be brought back reports, it does not switch modes. Quietly showing
        // a different meter than the one the user asked for is worse than saying it is broken, and
        // leaving Surface stays their action.
        if (!renderer || renderer.state === "dead") {
          drawSurfaceError(ctx, W, H, axisLabelColor);
          return;
        }
        if (renderer.state !== "ok") return;

        // Surface-only: flatten per-bin jitter into terrain (see the two smoothers' docs). The
        // grid is rebuilt on every repaint, so mutating it here cannot leak into the Lines branch
        // of a later frame; within THIS frame the branches are exclusive.
        smoothGridFrequency(grid.heights, grid.count, grid.pointCount);
        // The decimation stride in tFrac drives the time smoother's gap detection and the mesh's:
        // both mean "a row apart", so both track the real stride. Falls back to the mean row
        // spacing only when the stride is unusable (non-finite span/sampleMs).
        const rawStrideTFrac = grid.strideMs / span;
        const strideTFrac =
          Number.isFinite(rawStrideTFrac) && rawStrideTFrac > 0
            ? rawStrideTFrac
            : 1 / Math.max(1, grid.count - 1);
        const rowGapTFrac = ROW_GAP_TOLERANCE * strideTFrac;
        // The edge fades do NOT ride the same stride. Gap tolerance asks "how far apart are two
        // rows"; the fades ask "how much of the WINDOW does the terrain sink over", which is a
        // spatial property of the window edge and says nothing about how finely time is sampled.
        // Pinning them to ridgeCountFor(W) keeps every tuned width where it was reviewed, at every
        // panel size, while leaving the row count free to move.
        const fadeStrideTFrac = 1 / ridgeCountFor(W);
        // ...and then widened, when the view demands it, so the ramps keep a readable slope on
        // SCREEN rather than a fixed share of the data. See edgeRampWidth: the tuned widths are the
        // floor, so at steep views nothing moves, and the cost is paid only at the flat views where
        // the fade would otherwise land as a vertical face.
        const risePx = proj.heightScale * view.heightGain;
        const timeAxisPx = Math.hypot(proj.tx, proj.ty);
        const freqAxisPx = Math.hypot(proj.fx, proj.fy);
        const rampWidth = (min, max, axisPx) => edgeRampWidth(risePx, axisPx, min, max);
        // Over the DECIMATED rows only. The pinned live row is a fraction of a stride from its
        // neighbour rather than a stride, so letting it into the kernel would both under-smooth the
        // last bucket row and feed that row the live frame's raw jitter at a quarter weight --
        // reintroducing, one row further in, the flicker the entering-edge treatment removes.
        smoothGridTime(grid.heights, grid.tFracs, grid.bucketCount, grid.pointCount, rowGapTFrac);
        // After both smoothers, so the ramp is not smeared back up by a later kernel, and over
        // every row including the pinned live one -- the frequency limits are a property of the
        // band, not of which frames happen to be in the window.
        fadeGridFrequencyEdges(
          grid.heights,
          grid.count,
          grid.pointCount,
          rampWidth(FREQ_FADE_FRAC, FREQ_FADE_MAX_FRAC, freqAxisPx)
        );

        // The two end faces of the solid: sink the terrain into the floor rather than letting
        // cross-sections pop in and out. Applied per ROW, into the grid the mesh then reads -- the
        // old renderer multiplied per sampled pixel instead, but the ramp is a property of the
        // row's position in the window either way.
        //
        // The ramps land where the TERRAIN ends, not where the window does. With a mesh those are
        // simply the first and last rows: geometry stops at the last row, where the walk used to
        // hold a horizon past it. Sinking at the window edge instead leaves the ramp partway down
        // when the data runs out, which renders as the end face standing up off the floor.
        const enterFadeTFrac = rampWidth(
          ENTER_FADE_STRIDES * fadeStrideTFrac,
          TIME_FADE_MAX_FRAC,
          timeAxisPx
        );
        const exitFadeTFrac = rampWidth(
          EDGE_FADE_RIDGES * fadeStrideTFrac,
          TIME_FADE_MAX_FRAC,
          timeAxisPx
        );
        const exitEdgeTFrac = grid.tFracs[0];
        const enterEdgeTFrac = grid.tFracs[grid.count - 1];
        for (let r = 0; r < grid.count; r++) {
          const fade = edgeFade(
            grid.tFracs[r],
            enterFadeTFrac,
            exitFadeTFrac,
            exitEdgeTFrac,
            enterEdgeTFrac
          );
          if (fade >= 1) continue;
          const base = r * grid.pointCount;
          for (let q = 0; q < grid.pointCount; q++) grid.heights[base + q] *= fade;
        }

        // A 1x1 scratch canvas, kept only so a CSS colour can be resolved to bytes -- see
        // makeArgbResolver. The full-size offscreen buffer the rasteriser drew into is gone.
        const probe = ensureOffscreen(offscreenRef, 1, 1);
        const inkArgb = p.colorize ? 0 : resolveArgbRef.current(probe.ctx, foreground);
        // Cached by identity, matching the repaint-skip guard's `last.colormapLut === p.colormapLut`
        // above: the theme layer hands the hook a new array whenever the colormap actually changes,
        // so identity is sufficient. Do not switch this to a stringified key -- colormapLut is a
        // 768-element Uint8Array, and interpolating it into a string calls toString() on every
        // repaint that reaches this branch, which is the renderer's hot path. inkArgb is part of
        // the key: a theme switch can move Surface Ink without touching the colormap.
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

        // The scrub band, as a tFrac range rather than a count of rows. The old renderer widened it
        // by whole rows and had to round up so it could not vanish once rows were dense on screen;
        // a range in the units the shader already carries is the same weight on screen at any row
        // density, with nothing to round.
        const highlightBand =
          selectedRidge >= 0 && timeAxisPx > 0
            ? [
                grid.tFracs[selectedRidge] - selectedStrokePx / 2 / timeAxisPx,
                grid.tFracs[selectedRidge] + selectedStrokePx / 2 / timeAxisPx,
              ]
            : [1, 0];

        const mesh = buildSurfaceMesh(grid, { rowGapTFrac, skirt: true });
        const uniforms = buildGlUniforms({
          proj,
          width: W,
          height: H,
          heightGain: view.heightGain,
        });
        renderer.resize(W, H);
        renderer.draw({
          mesh,
          uniforms,
          lut: surfaceLutRef.current.lut,
          lutToken: surfaceLutRef.current,
          floor: !!p.floor,
          gridColour: argbToRgba(resolveArgbRef.current(probe.ctx, gridColor)),
          gridSubtleColour: argbToRgba(resolveArgbRef.current(probe.ctx, gridSubtleColor)),
          highlightBand,
          highlightColour: argbToRgba(resolveArgbRef.current(probe.ctx, selection)),
        });
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
      ctx.lineWidth = RIDGE_LINE_WIDTH;

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
      // One scratch point for the whole waterfall: the inner loop only reads x/y before the
      // next call overwrites them, so a shared point is safe and keeps the per-repaint
      // vertex projection allocation-free. See `projectPointInto`.
      const pt = { x: 0, y: 0 };
      const startBase = { x: 0, y: 0 };
      for (let n = 0; n < grid.count; n++) {
        const r = first + n * step;
        const tFrac = grid.tFracs[r];
        const base = r * grid.pointCount;

        const curve = new Path2D();
        for (let q = 0; q < grid.pointCount; q++) {
          const fFrac = q / (grid.pointCount - 1);
          projectPointInto(tFrac, fFrac, grid.heights[base + q] * view.heightGain, proj, pt);
          if (q === 0) curve.moveTo(pt.x, pt.y);
          else curve.lineTo(pt.x, pt.y);
        }
        projectPointInto(tFrac, 0, 0, proj, startBase);

        const edgeFade = tFrac < fadeSpan ? Math.max(0, tFrac) / fadeSpan : 1;

        if (r === selectedRidge) {
          ctx.globalAlpha = edgeFade;
          ctx.strokeStyle = selection;
          // One stroke out of a hundred, so the hairline rule that governs the mesh does not apply
          // to it: it stays on the themed width, which is also the width Surface sizes its scrub
          // band to. Both modes keep marking the scrubbed moment with the same weight.
          ctx.lineWidth = selectedStrokePx;
          ctx.stroke(curve);
          ctx.lineWidth = RIDGE_LINE_WIDTH;
        } else {
          // Opaque apart from the old-end fade: the colour ramp already separates near from far,
          // so nothing here needs to buy depth by letting ridges accumulate.
          ctx.globalAlpha = edgeFade;
          ctx.strokeStyle = stopColors
            ? buildRidgeGradient(ctx, stopColors, startBase, proj, heightPx)
            : ink;
          ctx.stroke(curve);
        }
        ctx.globalAlpha = 1;
      }
    }

    recordPanelCpuEvent("spectrogram3d", "scheduled");
    const frame = requestAnimationFrame(() => {
      const startedAt = beginPanelCpuSample();
      recordPanelCpuEvent("spectrogram3d", "callback");
      draw();
      finishPanelCpuSample("spectrogram3d", "callbackDuration", startedAt);
    });
    rafRef.current = frame;
    return () => {
      if (rafRef.current === frame) {
        recordPanelCpuEvent("spectrogram3d", "cancelled");
        cancelAnimationFrame(frame);
        rafRef.current = null;
      }
    };
  }, [
    canvasRef,
    glCanvasRef,
    snapRef,
    projectionRef,
    sourceVersion,
    canvasSizeRevision,
    enabled,
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
    floor,
    mode,
    themeColors,
  ]);
}
