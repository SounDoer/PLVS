import { STEREO_MAP_FILL_OPACITY } from "@/lib/chartFill.js";
import { useLayoutEffect, useRef } from "react";

import { rangedFreqToXFrac, rangedHistY } from "../../config/scales";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { selectStereoMapCanvasColors } from "../../theme/themeCanvasSelectors.js";
import { useResolvedTheme } from "../../theme/useResolvedTheme.js";
import { readCssNumber } from "../../theme/cssTokens.js";
import { useCanvasBackingStoreSize } from "../../hooks/useCanvasBackingStore.js";
import { interiorGridTicks } from "./ChartGrid.jsx";

// Same viewBox convention as Spectrum's inline SVG (and this component's own former SVG
// implementation), so the curve, grid, and hover overlay all share one coordinate system across
// panels. Canvas needs real pixel dimensions rather than a viewBox, so these virtual units are
// mapped to the backing store's physical pixels at draw time (see scaleX/scaleY below).
const VIEW_W = 1000;
const VIEW_H = 260;

const FALLBACK_COLOR = { r: 128, g: 128, b: 128 };

function xFor(hz, xMinHz, xMaxHz) {
  return rangedFreqToXFrac(hz, xMinHz, xMaxHz) * VIEW_W;
}

function yFor(value, range) {
  return rangedHistY(value, VIEW_H, range.lowerBound, range.upperBound);
}

function clamp01(t) {
  return Math.max(0, Math.min(1, t));
}

function normalizedChannelPosition(value, range) {
  const span = range.upperBound - range.lowerBound;
  if (!(span > 0)) return 0;
  return clamp01((value - range.lowerBound) / span) * 2 - 1;
}

function energyFadeOpacity(opacity, strengthPercent) {
  const base = clamp01(opacity);
  if (base === 0 || base === 1) return base;
  return base ** (Math.max(0, Math.min(100, strengthPercent)) / 100);
}

// Position: 0 at the second channel, 1 at the first channel. Blend controls how much of the
// normalized -1..+1 position range is used as the transition around center; zero is a hard split.
function channelBlendT(value, range, blendPercent) {
  const normalizedPosition = normalizedChannelPosition(value, range);
  const blendWidth = clamp01(blendPercent / 100);
  if (blendWidth === 0) return normalizedPosition >= 0 ? 1 : 0;
  return clamp01((normalizedPosition + blendWidth) / (2 * blendWidth));
}

// Correlation: -1 (anti-phase) is Bad, +1 (in phase) is Good.
function correlationColorT(value) {
  return clamp01((value + 1) / 2);
}

// Mono Loss: the range's lower bound is Bad, 0 dB is Good.
function monoLossColorT(value, range) {
  const span = 0 - range.lowerBound;
  if (!(span > 0)) return 1;
  return clamp01((value - range.lowerBound) / span);
}

/** Parses a resolved CSS color (hex or rgb()/rgba()) into {r,g,b}. Returns null if unparseable. */
function parseColor(raw) {
  const value = (raw ?? "").trim();
  if (!value) return null;
  let match = /^#([0-9a-f]{3})$/i.exec(value);
  if (match) {
    const [r, g, b] = match[1];
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  match = /^#([0-9a-f]{6})$/i.exec(value);
  if (match) {
    const hex = match[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  match = /^#([0-9a-f]{8})$/i.exec(value);
  if (match) {
    const hex = match[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }
  match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(value);
  if (match) return { r: +match[1], g: +match[2], b: +match[3] };
  return null;
}

function rgbToCss({ r, g, b }) {
  return `rgb(${r}, ${g}, ${b})`;
}

/** `"rgb(r, g, b)"` -> `"rgba(r, g, b, alpha)"`. Falls back to the input unchanged if unparseable. */
function withAlpha(rgbCss, alpha) {
  const match = /^rgb\((\d+), (\d+), (\d+)\)$/.exec(rgbCss);
  if (!match) return rgbCss;
  return `rgba(${match[1]}, ${match[2]}, ${match[3]}, ${clamp01(alpha)})`;
}

// Canvas equivalent of `color-mix(in srgb, colorA pct%, colorB)`: a plain per-channel lerp in
// sRGB, colorA weighted by pct/100.
function mixColors(pctOfA, colorA, colorB) {
  const t = clamp01(pctOfA / 100);
  return rgbToCss({
    r: Math.round(colorA.r * t + colorB.r * (1 - t)),
    g: Math.round(colorA.g * t + colorB.g * (1 - t)),
    b: Math.round(colorA.b * t + colorB.b * (1 - t)),
  });
}

function channelBlendColor(t, primary, secondary) {
  return mixColors(clamp01(t) * 100, primary, secondary);
}

// Continuous Bad -> Warn -> Good, derived from the existing signal tokens. t=0 is fully Bad,
// t=0.5 is fully Warn, t=1 is fully Good.
function threeStopSignalColor(t, warn, bad, good) {
  const clamped = clamp01(t);
  if (clamped <= 0.5) {
    return mixColors((clamped / 0.5) * 100, warn, bad);
  }
  return mixColors(((clamped - 0.5) / 0.5) * 100, good, warn);
}

function segmentColor(mode, value, range, colors, colorBlendPercent = 100) {
  switch (mode) {
    case STEREO_MAP_MODES.POSITION:
      return channelBlendColor(
        channelBlendT(value, range, colorBlendPercent),
        colors.primary,
        colors.secondary
      );
    case STEREO_MAP_MODES.CORRELATION:
      return threeStopSignalColor(correlationColorT(value), colors.warn, colors.bad, colors.good);
    case STEREO_MAP_MODES.MONO_LOSS_DB:
      return threeStopSignalColor(
        monoLossColorT(value, range),
        colors.warn,
        colors.bad,
        colors.good
      );
    case STEREO_MAP_MODES.MS_RATIO_DB:
      // Side-dominant (positive) reuses Spectrum's Mid/Side "secondary" token, Mid-dominant
      // (negative) reuses "primary" — the same pairing Spectrum's M/S view uses. Side is not
      // tinted as dangerous; it is simply the other side of the same pair of colors as Mid.
      return value >= 0 ? colors.secondaryCss : colors.primaryCss;
    default:
      return colors.primaryCss;
  }
}

/**
 * Splits a per-band point/value list into runs broken at invalid points — each run is one
 * continuous stretch to be drawn; a break between runs is a real curve break (no interpolation
 * across an invalid band).
 */
function buildRuns(bandCentersHz, points, xMinHz, xMaxHz, range, energyFadePercent) {
  const runs = [];
  let current = null;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point || point.state === "invalid") {
      current = null;
      continue;
    }
    const entry = {
      x: xFor(bandCentersHz[index], xMinHz, xMaxHz),
      y: yFor(point.value, range),
      value: point.value,
      opacity: energyFadeOpacity(
        Number.isFinite(point.opacity) ? point.opacity : 1,
        energyFadePercent
      ),
    };
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push(entry);
  }
  return runs;
}

/** Same run-splitting as {@link buildRuns}, for a raw Hold extrema array (number|null per band). */
function buildHoldRuns(bandCentersHz, values, xMinHz, xMaxHz, range) {
  if (!values) return [];
  const runs = [];
  let current = null;
  for (let index = 0; index < values.length; index += 1) {
    const raw = values[index];
    if (raw === null || raw === undefined || Number.isNaN(raw)) {
      current = null;
      continue;
    }
    const clipped = Math.max(range.lowerBound, Math.min(range.upperBound, raw));
    const entry = { x: xFor(bandCentersHz[index], xMinHz, xMaxHz), y: yFor(clipped, range) };
    if (!current) {
      current = [];
      runs.push(current);
    }
    current.push(entry);
  }
  return runs;
}

/**
 * Draws one continuous run (Position/Correlation/Mono Loss) as a single fill path + single stroke
 * path, colored with a canvas `CanvasGradient` carrying one stop per band plus any Position blend
 * boundaries crossed between bands. A per-segment
 * `fillStyle`/`strokeStyle` reassignment forces the canvas backend to re-resolve the style on every
 * single draw call — cheap when consecutive segments happen to resolve to the same color (a calm,
 * slowly-varying region), but a real per-call cost when they don't (a region where the value swings
 * a lot band-to-band keeps producing a genuinely different color string every time). A gradient
 * bakes the whole run's color variation into one style object that costs the same to paint
 * regardless of how much the underlying values actually swing.
 */
function drawGradientRun(
  ctx,
  run,
  mode,
  range,
  colors,
  baselineY,
  fillOpacity,
  colorBlendPercent,
  scaleX,
  scaleY
) {
  if (run.length < 2) return;
  const x0 = run[0].x * scaleX;
  const x1 = run[run.length - 1].x * scaleX;
  const span = x1 - x0;

  const soleColor = (alpha) =>
    withAlpha(segmentColor(mode, run[0].value, range, colors, colorBlendPercent), alpha);
  // One gradient serves both passes. The stops carry the opacity that varies along the run, which
  // is the part a per-draw alpha could not express; the constant fill factor rides on globalAlpha,
  // which the canvas multiplies with each stop's alpha for the same result. Building it twice cost
  // an addColorStop and a colour string per point per pass, and a renderer profile put
  // addColorStop at 2% of its time.
  let gradient = null;
  if (span > 0) {
    gradient = ctx.createLinearGradient(x0, 0, x1, 0);
    const addPointStop = (point) => {
      const t = clamp01((point.x * scaleX - x0) / span);
      gradient.addColorStop(
        t,
        withAlpha(segmentColor(mode, point.value, range, colors, colorBlendPercent), point.opacity)
      );
    };
    addPointStop(run[0]);
    for (let index = 1; index < run.length; index += 1) {
      const previous = run[index - 1];
      const point = run[index];
      if (mode === STEREO_MAP_MODES.POSITION) {
        const previousPosition = normalizedChannelPosition(previous.value, range);
        const position = normalizedChannelPosition(point.value, range);
        const positionSpan = position - previousPosition;
        const blendWidth = clamp01(colorBlendPercent / 100);
        if (positionSpan !== 0) {
          const hardSplitCrossed =
            blendWidth === 0 &&
            ((previousPosition < 0 && position >= 0) || (previousPosition >= 0 && position < 0));
          const boundaries = hardSplitCrossed ? [0] : [-blendWidth, blendWidth];
          const crossedBoundaries = boundaries
            .filter((boundary) => {
              if (hardSplitCrossed) return true;
              return (
                boundary > Math.min(previousPosition, position) &&
                boundary < Math.max(previousPosition, position)
              );
            })
            .sort((a, b) => (positionSpan > 0 ? a - b : b - a));
          for (const boundary of crossedBoundaries) {
            const fraction = (boundary - previousPosition) / positionSpan;
            const boundaryX = previous.x + (point.x - previous.x) * fraction;
            const boundaryOffset = clamp01((boundaryX * scaleX - x0) / span);
            const boundaryOpacity =
              previous.opacity + (point.opacity - previous.opacity) * fraction;
            if (hardSplitCrossed) {
              const beforeColor = positionSpan > 0 ? colors.secondaryCss : colors.primaryCss;
              const afterColor = positionSpan > 0 ? colors.primaryCss : colors.secondaryCss;
              gradient.addColorStop(boundaryOffset, withAlpha(beforeColor, boundaryOpacity));
              // When the boundary is the current point, addPointStop below supplies the color on
              // the far side. Otherwise a duplicate-position stop creates Canvas's hard edge.
              if (fraction < 1) {
                gradient.addColorStop(boundaryOffset, withAlpha(afterColor, boundaryOpacity));
              }
            } else {
              const boundaryColor = boundary < 0 ? colors.secondaryCss : colors.primaryCss;
              gradient.addColorStop(boundaryOffset, withAlpha(boundaryColor, boundaryOpacity));
            }
          }
        }
      }
      addPointStop(point);
    }
  }

  ctx.globalAlpha = gradient ? fillOpacity : 1;
  ctx.fillStyle = gradient ?? soleColor(fillOpacity);
  ctx.beginPath();
  ctx.moveTo(x0, baselineY);
  for (const point of run) ctx.lineTo(point.x * scaleX, point.y * scaleY);
  ctx.lineTo(x1, baselineY);
  ctx.closePath();
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = gradient ?? soleColor(run[0].opacity);
  ctx.beginPath();
  ctx.moveTo(run[0].x * scaleX, run[0].y * scaleY);
  for (let index = 1; index < run.length; index += 1) {
    ctx.lineTo(run[index].x * scaleX, run[index].y * scaleY);
  }
  ctx.stroke();
}

/**
 * Draws one run for a binary-colored mode (M/S Ratio's primary/secondary split by sign, or the
 * single flat fallback color): merges consecutive segments that resolve to the exact same color and
 * opacity into one path instead of one draw call per segment. Real audio content rarely flips sign
 * every single band, so this collapses most of a run into a handful of draws; a gradient is not used
 * here because the sign switch is a hard edge, not a continuous blend.
 */
function drawBinaryRun(ctx, run, mode, range, colors, baselineY, fillOpacity, scaleX, scaleY) {
  const segmentCount = run.length - 1;
  let i = 0;
  while (i < segmentCount) {
    const baseColor = segmentColor(mode, (run[i].value + run[i + 1].value) / 2, range, colors);
    const opacity = Math.min(run[i].opacity, run[i + 1].opacity);
    let j = i;
    while (j + 1 < segmentCount) {
      const nextColor = segmentColor(
        mode,
        (run[j + 1].value + run[j + 2].value) / 2,
        range,
        colors
      );
      const nextOpacity = Math.min(run[j + 1].opacity, run[j + 2].opacity);
      if (nextColor !== baseColor || nextOpacity !== opacity) break;
      j += 1;
    }

    const first = run[i];
    const last = run[j + 1];
    ctx.globalAlpha = opacity * fillOpacity;
    ctx.fillStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(first.x * scaleX, baselineY);
    for (let k = i; k <= j + 1; k += 1) ctx.lineTo(run[k].x * scaleX, run[k].y * scaleY);
    ctx.lineTo(last.x * scaleX, baselineY);
    ctx.closePath();
    ctx.fill();

    ctx.globalAlpha = opacity;
    ctx.strokeStyle = baseColor;
    ctx.beginPath();
    ctx.moveTo(first.x * scaleX, first.y * scaleY);
    for (let k = i + 1; k <= j + 1; k += 1) ctx.lineTo(run[k].x * scaleX, run[k].y * scaleY);
    ctx.stroke();

    i = j + 1;
  }
  ctx.globalAlpha = 1;
}

function buildHoldGroups(mode, bandCentersHz, holdValues, xMinHz, xMaxHz, range) {
  const holdGroups = [];
  if (!holdValues) return holdGroups;
  if (mode === STEREO_MAP_MODES.POSITION) {
    if (holdValues.maximum) {
      holdGroups.push({
        key: "max",
        runs: buildHoldRuns(bandCentersHz, holdValues.maximum, xMinHz, xMaxHz, range),
      });
    }
    if (holdValues.minimum) {
      holdGroups.push({
        key: "min",
        runs: buildHoldRuns(bandCentersHz, holdValues.minimum, xMinHz, xMaxHz, range),
      });
    }
  } else {
    holdGroups.push({
      key: "hold",
      runs: buildHoldRuns(bandCentersHz, holdValues, xMinHz, xMaxHz, range),
    });
  }
  return holdGroups;
}

function resolveColors(themeColors, paletteKey) {
  const primary =
    parseColor(paletteKey === "snap" ? themeColors.primarySnapshot : themeColors.primary) ||
    FALLBACK_COLOR;
  const secondary =
    parseColor(paletteKey === "snap" ? themeColors.secondarySnapshot : themeColors.secondary) ||
    FALLBACK_COLOR;
  const warn = parseColor(themeColors.warning) || FALLBACK_COLOR;
  const bad = parseColor(themeColors.critical) || FALLBACK_COLOR;
  const good = parseColor(themeColors.good) || FALLBACK_COLOR;
  const grid = parseColor(themeColors.grid) || FALLBACK_COLOR;
  return {
    primary,
    secondary,
    warn,
    bad,
    good,
    grid,
    primaryCss: rgbToCss(primary),
    secondaryCss: rgbToCss(secondary),
    fillOpacity: STEREO_MAP_FILL_OPACITY,
  };
}

function hashNumArray(arr) {
  if (!arr) return "null";
  let h = arr.length;
  for (let index = 0; index < arr.length; index += 1) {
    const v = arr[index];
    h = (h * 33 + (Number.isFinite(v) ? Math.round(v * 1000) : -1)) | 0;
  }
  return h;
}

function hashPoints(points) {
  let h = points.length;
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index];
    if (!point) {
      h = (h * 33 + 7) | 0;
      continue;
    }
    const value = Number.isFinite(point.value) ? Math.round(point.value * 1000) : -999999;
    const opacity = Number.isFinite(point.opacity) ? Math.round(point.opacity * 1000) : 1000;
    const state = point.state === "invalid" ? 1 : 0;
    h = (h * 33 + value) | 0;
    h = (h * 33 + opacity) | 0;
    h = (h * 33 + state) | 0;
  }
  return h;
}

function hashHoldValues(mode, holdValues) {
  if (!holdValues) return "null";
  if (mode === STEREO_MAP_MODES.POSITION) {
    return `${hashNumArray(holdValues.maximum)}:${hashNumArray(holdValues.minimum)}`;
  }
  return String(hashNumArray(holdValues));
}

function tickSignature(ticks) {
  return interiorGridTicks(ticks)
    .map((tick) => `${tick.key}:${tick.frac}`)
    .join(",");
}

function drawGrid(ctx, xTicks, yTicks, width, height, dpr, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = dpr;
  ctx.beginPath();
  for (const tick of interiorGridTicks(xTicks)) {
    const x = tick.frac * width;
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (const tick of interiorGridTicks(yTicks)) {
    const y = tick.frac * height;
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

/**
 * Renders one Stereo Map curve on canvas: filled area to the zero baseline, per-segment Good/Warn/
 * Bad or channel-blend coloring, low-energy opacity fade, curve breaks at invalid bands, and
 * optional Hold outlines. Pure presentation — every value here is already derived by the caller
 * (`stereoMapMath.js` / `stereoMapHold.js`); this component does no DSP.
 *
 * Canvas instead of per-band SVG elements: with up to ~958 bands the old SVG built ~2 DOM nodes per
 * band (a filled polygon + a stroked line), rebuilt from scratch on every render — during snapshot
 * scrubbing that happens on nearly every mouse-move tick and was the source of visible jank. Canvas
 * draw calls are O(bands) work but O(1) DOM nodes, and a redraw-skip signature (mirroring
 * VectorscopePolarPlot) avoids repainting entirely when nothing that affects the picture changed.
 *
 * Reading `canvas.clientWidth`/`clientHeight` or calling `getComputedStyle` forces a synchronous
 * layout/style flush — doing that unconditionally on every render (even ones the signature ends up
 * skipping) reintroduces the same class of cost the canvas rewrite was meant to remove, and is
 * disproportionately expensive here given how many draw calls a redraw performs. Size comes from
 * `useCanvasBackingStoreSize`, which reads layout once on mount and then only from ResizeObserver
 * entries. Colors arrive as a resolved theme bundle and never require a style read; computed style
 * is retained only for non-color drawing geometry.
 */
export function StereoMapPlot({
  mode,
  bandCentersHz = [],
  points = [],
  holdValues = null,
  holdVisible = false,
  range,
  xMinHz = 20,
  xMaxHz = 20000,
  paletteKey = "live",
  themeColors: themeColorsOverride,
  sourceVersion = 0,
  energyFadePercent = 75,
  colorBlendPercent = 50,
  gridVisible = false,
  xTicks = [],
  yTicks = [],
}) {
  const resolvedThemeColors = useResolvedTheme(selectStereoMapCanvasColors);
  const themeColors = themeColorsOverride ?? resolvedThemeColors;
  const canvasRef = useRef(null);
  const redrawRef = useRef({
    signature: null,
    bandCentersHz: null,
    points: null,
    holdValues: null,
    bandHash: null,
    pointHash: null,
    holdHash: null,
  });
  const { dpr, width, height } = useCanvasBackingStoreSize(canvasRef);
  const geometryStyleRef = useRef(null);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || width <= 0 || height <= 0) return;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;

    if (!geometryStyleRef.current) {
      geometryStyleRef.current = {
        strokeWidthCss: readCssNumber(canvas, "--ui-stereo-map-stroke-width", 1.5) || 1.5,
      };
    }
    const colors = resolveColors(themeColors, paletteKey);
    const { strokeWidthCss } = geometryStyleRef.current;
    const fillOpacity = colors.fillOpacity;
    const fadeStrength = Math.max(0, Math.min(100, energyFadePercent));
    const colorBlend = Math.max(0, Math.min(100, colorBlendPercent));
    const lineWidth = strokeWidthCss * dpr;

    // Skip the full redraw when nothing that affects the picture has changed. Parent components
    // (Panel/Dock) rebuild `points`/`bandCentersHz`/`holdValues` as fresh arrays on every render, so
    // reference equality would never hold; hashing them is still far cheaper than the draw calls it
    // guards (color resolution + path building per segment), which is the actual cost being skipped.
    const signature = [
      mode,
      paletteKey,
      holdVisible,
      range.lowerBound,
      range.upperBound,
      xMinHz,
      xMaxHz,
      width,
      height,
      dpr,
      colors.primaryCss,
      colors.secondaryCss,
      rgbToCss(colors.warn),
      rgbToCss(colors.bad),
      rgbToCss(colors.good),
      rgbToCss(colors.grid),
      gridVisible,
      tickSignature(xTicks),
      tickSignature(yTicks),
      fillOpacity,
      fadeStrength,
      colorBlend,
      lineWidth,
      sourceVersion,
    ].join("|");
    const sameSignature = redrawRef.current.signature === signature;
    if (sameSignature) {
      if (
        redrawRef.current.bandCentersHz === bandCentersHz &&
        redrawRef.current.points === points &&
        redrawRef.current.holdValues === holdValues
      ) {
        return;
      }
      // Compatibility fallback for callers that rebuild equal arrays. The panel's live path now
      // memoizes its derived arrays, so steady-state frame renders take the reference fast path and
      // never pay these O(bands) hashes.
      const bandHash = hashNumArray(bandCentersHz);
      const pointHash = hashPoints(points);
      const holdHash = hashHoldValues(mode, holdValues);
      if (
        redrawRef.current.bandHash === bandHash &&
        redrawRef.current.pointHash === pointHash &&
        redrawRef.current.holdHash === holdHash
      ) {
        redrawRef.current = {
          ...redrawRef.current,
          bandCentersHz,
          points,
          holdValues,
        };
        return;
      }
    }
    redrawRef.current = {
      signature,
      bandCentersHz,
      points,
      holdValues,
      bandHash: hashNumArray(bandCentersHz),
      pointHash: hashPoints(points),
      holdHash: hashHoldValues(mode, holdValues),
    };

    const scaleX = width / VIEW_W;
    const scaleY = height / VIEW_H;

    ctx.clearRect(0, 0, width, height);

    if (gridVisible) {
      drawGrid(ctx, xTicks, yTicks, width, height, dpr, rgbToCss(colors.grid));
    }

    // No line is drawn at zero, but the runs still fill down to it.
    const baselineY = yFor(0, range) * scaleY;

    const runs = buildRuns(bandCentersHz, points, xMinHz, xMaxHz, range, fadeStrength);
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    // Position/Correlation/Mono Loss vary continuously and are drawn with one gradient-colored path
    // per run; M/S Ratio is a hard binary split and is drawn with merged same-color paths instead —
    // see drawGradientRun/drawBinaryRun.
    const isGradientMode =
      mode === STEREO_MAP_MODES.POSITION ||
      mode === STEREO_MAP_MODES.CORRELATION ||
      mode === STEREO_MAP_MODES.MONO_LOSS_DB;
    for (const run of runs) {
      if (isGradientMode) {
        drawGradientRun(
          ctx,
          run,
          mode,
          range,
          colors,
          baselineY,
          fillOpacity,
          colorBlend,
          scaleX,
          scaleY
        );
      } else {
        drawBinaryRun(ctx, run, mode, range, colors, baselineY, fillOpacity, scaleX, scaleY);
      }
    }
    ctx.globalAlpha = 1;

    if (holdVisible) {
      const holdGroups = buildHoldGroups(mode, bandCentersHz, holdValues, xMinHz, xMaxHz, range);
      ctx.strokeStyle = colors.primaryCss;
      ctx.lineWidth = lineWidth;
      for (const { runs: holdRuns } of holdGroups) {
        for (const run of holdRuns) {
          if (run.length === 0) continue;
          ctx.beginPath();
          ctx.moveTo(run[0].x * scaleX, run[0].y * scaleY);
          for (let index = 1; index < run.length; index += 1) {
            ctx.lineTo(run[index].x * scaleX, run[index].y * scaleY);
          }
          ctx.stroke();
        }
      }
      ctx.globalAlpha = 1;
    }
  });

  return (
    <div data-stereo-map-plot={mode} className="block h-full w-full">
      <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
    </div>
  );
}
