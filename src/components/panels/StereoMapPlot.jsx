import { rangedFreqToXFrac, rangedHistY } from "../../config/scales";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";

// Same viewBox convention as Spectrum's inline SVG, so the curve, grid, and hover overlay all
// share one coordinate system across panels.
const VIEW_W = 1000;
const VIEW_H = 260;

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

function channelBlendColor(t, primaryVar, secondaryVar) {
  const pct = clamp01(t) * 100;
  return `color-mix(in srgb, ${primaryVar} ${pct}%, ${secondaryVar})`;
}

// Continuous Bad -> Warn -> Good, derived from the existing signal tokens. t=0 is fully Bad,
// t=0.5 is fully Warn, t=1 is fully Good.
function threeStopSignalColor(t) {
  const clamped = clamp01(t);
  if (clamped <= 0.5) {
    const pct = (clamped / 0.5) * 100;
    return `color-mix(in srgb, var(--ui-signal-warn) ${pct}%, var(--ui-signal-bad))`;
  }
  const pct = ((clamped - 0.5) / 0.5) * 100;
  return `color-mix(in srgb, var(--ui-signal-good) ${pct}%, var(--ui-signal-warn))`;
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

function segmentColor(mode, value, range, primaryVar, secondaryVar) {
  switch (mode) {
    case STEREO_MAP_MODES.POSITION:
      return channelBlendColor(channelBlendT(value, range), primaryVar, secondaryVar);
    case STEREO_MAP_MODES.CORRELATION:
      return threeStopSignalColor(correlationColorT(value));
    case STEREO_MAP_MODES.MONO_LOSS_DB:
      return threeStopSignalColor(monoLossColorT(value, range));
    case STEREO_MAP_MODES.MS_RATIO_DB:
      // Side-dominant (positive) reuses Spectrum's Mid/Side "secondary" token, Mid-dominant
      // (negative) reuses "primary" — the same pairing Spectrum's M/S view uses. Side is not
      // tinted as dangerous; it is simply the other side of the same pair of colors as Mid.
      return value >= 0 ? secondaryVar : primaryVar;
    default:
      return primaryVar;
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

function polylinePoints(run) {
  return run.map((point) => `${point.x},${point.y}`).join(" ");
}

/**
 * Renders one Stereo Map curve: filled area to the zero baseline, per-segment Good/Warn/Bad or
 * channel-blend coloring, low-energy opacity fade, curve breaks at invalid bands, and optional
 * Hold outlines. Pure presentation — every value here is already derived by the caller
 * (`stereoMapMath.js` / `stereoMapHold.js`); this component does no DSP.
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
}) {
  const primaryVar =
    paletteKey === "snap" ? "var(--ui-stereo-map-primary-snap)" : "var(--ui-stereo-map-primary)";
  const secondaryVar =
    paletteKey === "snap"
      ? "var(--ui-stereo-map-secondary-snap)"
      : "var(--ui-stereo-map-secondary)";
  const baselineY = yFor(0, range);
  const runs = buildRuns(bandCentersHz, points, xMinHz, xMaxHz, range);

  const holdGroups = [];
  if (holdValues) {
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
  }

  return (
    <svg
      data-stereo-map-plot={mode}
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="none"
      className="block h-full w-full"
    >
      <g pointerEvents="none" aria-hidden>
        <line
          data-stereo-map-grid
          x1={0}
          x2={VIEW_W}
          y1={baselineY}
          y2={baselineY}
          stroke="var(--border)"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          style={{ strokeOpacity: "var(--ui-spectrum-grid-opacity, 0.08)" }}
        />
      </g>
      {runs.map((run, runIndex) =>
        run.slice(0, -1).map((point, segmentIndex) => {
          const next = run[segmentIndex + 1];
          const color = segmentColor(
            mode,
            (point.value + next.value) / 2,
            range,
            primaryVar,
            secondaryVar
          );
          const opacity = Math.min(point.opacity, next.opacity);
          return (
            <g key={`run-${runIndex}-${segmentIndex}`} opacity={opacity}>
              <polygon
                points={`${point.x},${baselineY} ${point.x},${point.y} ${next.x},${next.y} ${next.x},${baselineY}`}
                fill={color}
                fillOpacity="var(--ui-spectrum-fill-top-opacity, 0.18)"
              />
              <line
                data-stereo-map-segment
                x1={point.x}
                y1={point.y}
                x2={next.x}
                y2={next.y}
                stroke={color}
                strokeWidth="var(--ui-spectrum-stroke-width, 2)"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            </g>
          );
        })
      )}
      {holdVisible
        ? holdGroups.map(({ key, runs: holdRuns }) =>
            holdRuns.map((run, index) => (
              <polyline
                key={`hold-${key}-${index}`}
                data-stereo-map-hold={key}
                points={polylinePoints(run)}
                fill="none"
                stroke={primaryVar}
                strokeWidth="var(--ui-spectrum-stroke-width, 2)"
                vectorEffect="non-scaling-stroke"
                strokeOpacity={0.45}
              />
            ))
          )
        : null}
    </svg>
  );
}
