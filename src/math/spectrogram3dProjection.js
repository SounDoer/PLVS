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

const ELEVATION_MIN_DEG = 5;
const ELEVATION_MAX_DEG = 70;
const HEIGHT_GAIN_MIN = 0.3;
const HEIGHT_GAIN_MAX = 3;
const DEFAULT_HEIGHT_GAIN = 1;
const FIT_MARGIN = 0.92;

const DEG = Math.PI / 180;

function finiteOr(raw, fallback) {
  return Number.isFinite(raw) ? raw : fallback;
}

/**
 * Elevation is clamped at both ends: at 0 degrees the surface collapses to a line, and past about
 * 70 degrees it degenerates into a skewed top-down view that is strictly worse than the 2D mode.
 * Azimuth wraps rather than clamping, because spinning past 360 is a legitimate drag.
 */
export function clampViewParams({ azimuthDeg, elevationDeg, heightGain } = {}) {
  const rawAzimuth = finiteOr(azimuthDeg, 45);
  return {
    azimuthDeg: ((rawAzimuth % 360) + 360) % 360,
    elevationDeg: Math.min(
      ELEVATION_MAX_DEG,
      Math.max(ELEVATION_MIN_DEG, finiteOr(elevationDeg, 22))
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
    // Larger screen y is nearer the viewer. Draw the far end first so the newest frame, which is
    // what live monitoring watches, ends up unoccluded on top.
    ridgeOrderAscending: ty <= 0,
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
