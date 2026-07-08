/**
 * Converts a pointer clientX + bounding rect into a history playback offset in seconds.
 * @param {number} clientX
 * @param {DOMRect} rect
 * @param {number} effectiveOffsetSamples
 * @param {number} visibleSamples
 * @param {number} sampleSec
 * @param {number} [totalSamples]
 * @returns {number}
 */
export function computeSelectionOffset(
  clientX,
  rect,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec,
  totalSamples = Infinity
) {
  const width = Math.max(1, rect.width);
  const x = Math.max(0, Math.min(width, clientX - rect.left));
  const normalized = 1 - x / width;
  const fromEndSamples = effectiveOffsetSamples + normalized * Math.max(0, visibleSamples - 1);
  const maxFromEndSamples = Number.isFinite(totalSamples)
    ? Math.max(0, totalSamples - 1)
    : Infinity;
  return Math.round(Math.min(fromEndSamples, maxFromEndSamples)) * sampleSec;
}

/**
 * Computes a new pan offset after a horizontal pointer drag.
 * @param {number} startOffsetSec  Offset at drag start
 * @param {number} dx              Horizontal delta in pixels (positive = drag right)
 * @param {number} visibleSamples
 * @param {number} sampleSec
 * @param {number} rectWidth       Chart width in pixels
 * @param {number} maxOffsetSec    Upper clamp (totalSamples - visibleSamples) * sampleSec
 * @returns {number}
 */
export function computePanOffset(
  startOffsetSec,
  dx,
  visibleSamples,
  sampleSec,
  rectWidth,
  maxOffsetSec
) {
  const secPerPx = (visibleSamples * sampleSec) / Math.max(1, rectWidth);
  return Math.max(0, Math.min(maxOffsetSec, startOffsetSec + dx * secPerPx));
}

/**
 * Computes the new window size and scroll offset after a wheel zoom gesture,
 * anchoring around the cursor position.
 *
 * @param {{ factor: number, norm: number, effectiveOffsetSamples: number,
 *           visibleSamples: number, sampleSec: number, minWindowSec: number,
 *           maxWindowSec: number, totalSamples: number }} params
 *   factor: zoom multiplier (< 1 = zoom in, > 1 = zoom out)
 *   norm:   normalised cursor position from right edge (0 = right, 1 = left)
 * @returns {{ nextWindowSec: number, nextOffsetSec: number }}
 */
export function computeWheelZoom({
  factor,
  norm,
  effectiveOffsetSamples,
  visibleSamples,
  sampleSec,
  minWindowSec,
  maxWindowSec,
  totalSamples,
}) {
  const anchorFromEndSamples = effectiveOffsetSamples + norm * Math.max(0, visibleSamples - 1);
  const baselineSec = Math.max(sampleSec, visibleSamples * sampleSec);
  const nextWindowSec = Math.max(minWindowSec, Math.min(maxWindowSec, baselineSec * factor));
  const nextVisibleSamples = Math.max(
    1,
    Math.min(Math.max(1, totalSamples), Math.round(nextWindowSec / sampleSec))
  );
  const nextMaxOffsetSamples = Math.max(0, totalSamples - nextVisibleSamples);
  const nextOffsetSamples = Math.max(
    0,
    Math.min(
      nextMaxOffsetSamples,
      Math.round(anchorFromEndSamples - norm * Math.max(0, nextVisibleSamples - 1))
    )
  );
  return { nextWindowSec, nextOffsetSec: nextOffsetSamples * sampleSec };
}
