import { useLayoutEffect, useRef, useState } from "react";

import { rangedFreqToXFrac, rangedHistY } from "../../config/scales";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";

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

// Position/M-S: 0 at the second/Mid channel, 1 at the first/Side channel.
function channelBlendT(value, range) {
  const span = range.upperBound - range.lowerBound;
  if (!(span > 0)) return 0.5;
  return clamp01((value - range.lowerBound) / span);
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

function segmentColor(mode, value, range, colors) {
  switch (mode) {
    case STEREO_MAP_MODES.POSITION:
      return channelBlendColor(channelBlendT(value, range), colors.primary, colors.secondary);
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
function buildRuns(bandCentersHz, points, xMinHz, xMaxHz, range) {
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
      opacity: Number.isFinite(point.opacity) ? point.opacity : 1,
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

function measureCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.round(canvas.clientHeight * dpr));
  return { dpr, width, height };
}

function resolveColors(style, paletteKey) {
  const primaryVarName =
    paletteKey === "snap" ? "--ui-stereo-map-primary-snap" : "--ui-stereo-map-primary";
  const secondaryVarName =
    paletteKey === "snap" ? "--ui-stereo-map-secondary-snap" : "--ui-stereo-map-secondary";
  const primary = parseColor(style.getPropertyValue(primaryVarName)) || FALLBACK_COLOR;
  const secondary = parseColor(style.getPropertyValue(secondaryVarName)) || FALLBACK_COLOR;
  const warn = parseColor(style.getPropertyValue("--ui-signal-warn")) || FALLBACK_COLOR;
  const bad = parseColor(style.getPropertyValue("--ui-signal-bad")) || FALLBACK_COLOR;
  const good = parseColor(style.getPropertyValue("--ui-signal-good")) || FALLBACK_COLOR;
  return {
    primary,
    secondary,
    warn,
    bad,
    good,
    primaryCss: rgbToCss(primary),
    secondaryCss: rgbToCss(secondary),
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
 * disproportionately expensive here given how many draw calls a redraw performs. Size is tracked via
 * a mount-time measurement plus a ResizeObserver (so a layout read only happens when the element
 * actually resizes, not every render); colors are resolved once per `paletteKey`/`themeId` pair and
 * cached, not re-read from the DOM on every render.
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
  themeId,
}) {
  const canvasRef = useRef(null);
  const redrawRef = useRef(null);
  const sizeRef = useRef({ dpr: 1, width: 1, height: 1 });
  const colorsRef = useRef(null);
  const [, bumpResizeVersion] = useState(0);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const measure = () => {
      const next = measureCanvas(canvas);
      const current = sizeRef.current;
      if (
        current.dpr === next.dpr &&
        current.width === next.width &&
        current.height === next.height
      ) {
        return;
      }
      sizeRef.current = next;
      if (canvas.width !== next.width) canvas.width = next.width;
      if (canvas.height !== next.height) canvas.height = next.height;
      bumpResizeVersion((v) => v + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext?.("2d");
    if (!ctx) return;

    const colorKey = `${paletteKey}|${themeId ?? ""}`;
    if (!colorsRef.current || colorsRef.current.key !== colorKey) {
      const style = getComputedStyle(canvas);
      colorsRef.current = {
        key: colorKey,
        colors: resolveColors(style, paletteKey),
        borderColor: style.getPropertyValue("--border").trim() || "#888888",
        gridOpacity: parseFloat(style.getPropertyValue("--ui-spectrum-grid-opacity")) || 0.08,
        fillOpacity: parseFloat(style.getPropertyValue("--ui-spectrum-fill-top-opacity")) || 0.18,
        strokeWidthCss: parseFloat(style.getPropertyValue("--ui-spectrum-stroke-width")) || 2,
      };
    }
    const { colors, borderColor, gridOpacity, fillOpacity, strokeWidthCss } = colorsRef.current;
    const { dpr, width, height } = sizeRef.current;
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
      borderColor,
      gridOpacity,
      fillOpacity,
      lineWidth,
      hashNumArray(bandCentersHz),
      hashPoints(points),
      hashHoldValues(mode, holdValues),
    ].join("|");
    if (redrawRef.current === signature) return;
    redrawRef.current = signature;

    const scaleX = width / VIEW_W;
    const scaleY = height / VIEW_H;

    ctx.clearRect(0, 0, width, height);

    // Baseline grid line at value=0.
    const baselineY = yFor(0, range) * scaleY;
    ctx.save();
    ctx.strokeStyle = borderColor;
    ctx.globalAlpha = gridOpacity;
    ctx.lineWidth = Math.max(1, dpr);
    ctx.beginPath();
    ctx.moveTo(0, baselineY);
    ctx.lineTo(width, baselineY);
    ctx.stroke();
    ctx.restore();

    const runs = buildRuns(bandCentersHz, points, xMinHz, xMaxHz, range);
    ctx.lineWidth = lineWidth;
    ctx.lineCap = "round";
    for (const run of runs) {
      for (let segmentIndex = 0; segmentIndex < run.length - 1; segmentIndex += 1) {
        const point = run[segmentIndex];
        const next = run[segmentIndex + 1];
        const color = segmentColor(mode, (point.value + next.value) / 2, range, colors);
        const opacity = Math.min(point.opacity, next.opacity);
        const px = point.x * scaleX;
        const py = point.y * scaleY;
        const nx = next.x * scaleX;
        const ny = next.y * scaleY;

        ctx.globalAlpha = opacity * fillOpacity;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(px, baselineY);
        ctx.lineTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.lineTo(nx, baselineY);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = opacity;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(nx, ny);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (holdVisible) {
      const holdGroups = buildHoldGroups(mode, bandCentersHz, holdValues, xMinHz, xMaxHz, range);
      ctx.strokeStyle = colors.primaryCss;
      ctx.lineWidth = lineWidth;
      ctx.globalAlpha = 0.45;
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
