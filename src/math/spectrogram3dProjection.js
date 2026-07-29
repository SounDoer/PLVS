/**
 * Orthographic axonometric projection for the 3D spectrogram waterfall.
 *
 * Pure: no canvas, no React, no data access. Inputs are unit-cube coordinates — tFrac and fFrac
 * span the visible time window and frequency range, hNorm spans the dB range.
 *
 * Orthographic rather than perspective on purpose: perspective would compress the far end of the
 * time axis, and this view shares its time window with the 2D heatmap, so unequal time spacing
 * would misread. It also keeps dB -> screen height a single scene-wide linear map, which is what
 * lets the Colorize gradient be built once per repaint instead of once per ridge.
 */

// Frequency runs up the front-left floor edge, time up the front-right one, and the newest frame
// sits at the near corner -- new data emerges at the front and flows away, which is what makes a
// waterfall read as one. It also puts the newest ridge last in painter's order, so it lands on top
// rather than under the history.
//
// The cost is that time then reads right-to-left, the opposite of the 2D heatmap, so switching
// modes flips the time axis. That is a real inconsistency, chosen deliberately: the alternative
// (azimuth 315) keeps 2D's direction but pushes the newest frame to the far end.
const DEFAULT_AZIMUTH_DEG = 135;
const DEFAULT_ELEVATION_DEG = 60;
const ELEVATION_MIN_DEG = 5;
const ELEVATION_MAX_DEG = 85;
const HEIGHT_GAIN_MIN = 0.3;
const HEIGHT_GAIN_MAX = 3;
const DEFAULT_HEIGHT_GAIN = 1;
const FIT_MARGIN = 0.92;

const DEG = Math.PI / 180;

function finiteOr(raw, fallback) {
  return Number.isFinite(raw) ? raw : fallback;
}

/**
 * Elevation is clamped at both ends: at 0 degrees the surface collapses to a line, and approaching
 * 90 it degenerates into a skewed top-down view that is strictly worse than the 2D mode. The upper
 * bound is deliberately well above the default so the useful range is reachable in both directions.
 * Azimuth wraps rather than clamping, because spinning past 360 is a legitimate drag.
 */
export function clampViewParams({ azimuthDeg, elevationDeg, heightGain } = {}) {
  const rawAzimuth = finiteOr(azimuthDeg, DEFAULT_AZIMUTH_DEG);
  return {
    azimuthDeg: ((rawAzimuth % 360) + 360) % 360,
    elevationDeg: Math.min(
      ELEVATION_MAX_DEG,
      Math.max(ELEVATION_MIN_DEG, finiteOr(elevationDeg, DEFAULT_ELEVATION_DEG))
    ),
    heightGain: Math.min(
      HEIGHT_GAIN_MAX,
      Math.max(HEIGHT_GAIN_MIN, finiteOr(heightGain, DEFAULT_HEIGHT_GAIN))
    ),
  };
}

/**
 * Precompute the projection for one repaint.
 *
 * Returns the six affine coefficients plus two derived values the renderer needs:
 * `heightScale` (dB -> vertical pixels) and `ridgeOrderAscending` (painter's-algorithm draw order).
 */
export function buildProjection({ azimuthDeg, elevationDeg, width, height }) {
  const view = clampViewParams({ azimuthDeg, elevationDeg });
  const az = view.azimuthDeg * DEG;
  const el = view.elevationDeg * DEG;
  const cosAz = Math.cos(az);
  const sinAz = Math.sin(az);
  const depth = Math.sin(el);
  const rise = Math.cos(el);

  // Unit-space basis, centred on the floor so rotation happens about the middle of the scene.
  const tx = cosAz;
  const ty = sinAz * depth;
  const fx = -sinAz;
  const fy = cosAz * depth;
  const hy = -rise;

  // Fit: project all eight corners of the unit cube, then scale so the bounding box fills the
  // canvas. Doing this per repaint keeps the scene framed while the user rotates.
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const t of [-0.5, 0.5]) {
    for (const f of [-0.5, 0.5]) {
      for (const h of [0, 1]) {
        const x = t * tx + f * fx;
        const y = t * ty + f * fy + h * hy;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  // Anisotropic on purpose. PLVS panels are wide and short -- a spectrogram can be 920x110 device
  // pixels -- and an isotropic `min(width/spanX, height/spanY)` lets the height constraint shrink
  // the entire scene until it occupies a fraction of the available width, leaving most of the panel
  // empty. This is a data plot, not a photograph: the 2D heatmap already stretches time and
  // frequency independently to fill its panel, and nothing here requires the floor to look square.
  const scaleX = (width / spanX) * FIT_MARGIN;
  const scaleY = (height / spanY) * FIT_MARGIN;
  const originX = width / 2 - ((minX + maxX) / 2) * scaleX;
  const originY = height / 2 - ((minY + maxY) / 2) * scaleY;

  return {
    originX,
    originY,
    tx: tx * scaleX,
    ty: ty * scaleY,
    fx: fx * scaleX,
    fy: fy * scaleY,
    hy: hy * scaleY,
    heightScale: rise * scaleY,
    // Painter's order. Larger screen y is nearer the viewer, and t contributes (t - 0.5) * ty to
    // it, so a positive ty puts the newest end nearest and the far end is t = 0 -- draw ascending.
    // A negative ty reverses both.
    ridgeOrderAscending: ty > 0,
  };
}

/**
 * Which floor edge each axis label belongs on, for a given projection.
 *
 * Every axis runs along two opposite edges; the label has to go on whichever faces the viewer or
 * the ridges hide it. Larger screen y is nearer, and an edge's depth depends entirely on the sign
 * of the OTHER axis's y component -- so `fy > 0` puts the time edge at `f = 1`, and `ty > 0` puts
 * the frequency edge at `t = 1`.
 *
 * Derived rather than fixed so the labels survive rotation: pinning either edge only works at one
 * azimuth, and rotating away from it drops a label behind the surface.
 *
 * @returns {{ timeAtF: 0 | 1, freqAtT: 0 | 1 }}
 */
export function labelEdges(proj) {
  return {
    timeAtF: proj.fy > 0 ? 1 : 0,
    freqAtT: proj.ty > 0 ? 1 : 0,
  };
}

/**
 * Inverse of `projectPoint` restricted to the floor plane (`hNorm = 0`).
 *
 * Interaction has to run through this. Every pointer handler on the chart was written against the
 * 2D projection, where time is the horizontal screen axis and frequency the vertical one; under a
 * rotated floor both assumptions break, and at the default azimuth they break by inverting, so
 * scrubbing selects the mirrored moment and zooming anchors on the wrong end of the spectrum.
 *
 * The floor is a plane and the projection is affine, so this is an exact 2x2 solve rather than a
 * pick against the surface. The determinant is `depth * scaleX * scaleY`, which is non-zero for
 * every elevation `clampViewParams` allows, so no degenerate guard is needed.
 *
 * Results are clamped to the unit square: a cursor outside the floor rhombus is still a legitimate
 * drag, and callers want the nearest valid position rather than an extrapolation.
 *
 * @returns {{ tFrac: number, fFrac: number }}
 */
export function unprojectFloor(x, y, proj) {
  const dx = x - proj.originX;
  const dy = y - proj.originY;
  const det = proj.tx * proj.fy - proj.ty * proj.fx;
  const t = 0.5 + (dx * proj.fy - dy * proj.fx) / det;
  const f = 0.5 + (dy * proj.tx - dx * proj.ty) / det;
  return {
    tFrac: Math.min(1, Math.max(0, t)),
    fFrac: Math.min(1, Math.max(0, f)),
  };
}

export function projectPoint(tFrac, fFrac, hNorm, proj) {
  const t = tFrac - 0.5;
  const f = fFrac - 0.5;
  return {
    x: proj.originX + t * proj.tx + f * proj.fx,
    y: proj.originY + t * proj.ty + f * proj.fy + hNorm * proj.hy,
  };
}
