function clampFinite(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function clampRange(min, max, absMin, absMax) {
  const span = max - min;
  if (span >= absMax - absMin) return { min: absMin, max: absMax };
  if (min < absMin) return { min: absMin, max: absMin + span };
  if (max > absMax) return { min: absMax - span, max: absMax };
  return { min, max };
}

function normalizeLinearRange(min, max, absMin, absMax) {
  const rounded = clampRange(Math.round(min), Math.round(max), absMin, absMax);
  return {
    min: Object.is(rounded.min, -0) ? 0 : rounded.min,
    max: Object.is(rounded.max, -0) ? 0 : rounded.max,
  };
}

export function computeLinearZoom({ min, max, absMin, absMax, minSpan, anchor, factor }) {
  const span = Math.max(0, max - min);
  const fullSpan = absMax - absMin;
  if (!(span > 0) || !(fullSpan > 0)) return { min: absMin, max: absMax };
  const safeAnchor = Math.max(min, Math.min(max, clampFinite(anchor, (min + max) / 2)));
  const anchorFrac = (safeAnchor - min) / span;
  const nextSpan = Math.max(minSpan, Math.min(fullSpan, span * factor));
  const next = clampRange(
    safeAnchor - anchorFrac * nextSpan,
    safeAnchor + (1 - anchorFrac) * nextSpan,
    absMin,
    absMax
  );
  return normalizeLinearRange(next.min, next.max, absMin, absMax);
}

export function computeLogZoom({ min, max, absMin, absMax, minOctaves, anchor, factor }) {
  const logMin = Math.log2(min);
  const logMax = Math.log2(max);
  const logAbsMin = Math.log2(absMin);
  const logAbsMax = Math.log2(absMax);
  const logSpan = logMax - logMin;
  const fullSpan = logAbsMax - logAbsMin;
  if (!(logSpan > 0) || !(fullSpan > 0)) return { min: absMin, max: absMax };
  const logAnchor = Math.max(
    logMin,
    Math.min(logMax, Math.log2(Math.max(absMin, clampFinite(anchor, Math.sqrt(min * max)))))
  );
  const anchorFrac = (logAnchor - logMin) / logSpan;
  const nextSpan = Math.max(minOctaves, Math.min(fullSpan, logSpan * factor));
  const next = clampRange(
    logAnchor - anchorFrac * nextSpan,
    logAnchor + (1 - anchorFrac) * nextSpan,
    logAbsMin,
    logAbsMax
  );
  return { min: 2 ** next.min, max: 2 ** next.max };
}

export function computeLinearPan({ min, max, absMin, absMax, deltaPx, axisPx }) {
  const span = max - min;
  if (!(span > 0)) return { min, max };
  const delta = (deltaPx / Math.max(1, axisPx)) * span;
  const next = clampRange(min + delta, max + delta, absMin, absMax);
  return normalizeLinearRange(next.min, next.max, absMin, absMax);
}

export function computeLogPan({ min, max, absMin, absMax, deltaPx, axisPx }) {
  const logMin = Math.log2(min);
  const logMax = Math.log2(max);
  const logSpan = logMax - logMin;
  if (!(logSpan > 0)) return { min, max };
  const delta = (deltaPx / Math.max(1, axisPx)) * logSpan;
  const next = clampRange(delta + logMin, delta + logMax, Math.log2(absMin), Math.log2(absMax));
  return { min: 2 ** next.min, max: 2 ** next.max };
}

export function pixelToLinearValue(px, axisPx, min, max) {
  const frac = 1 - Math.max(0, Math.min(axisPx, px)) / Math.max(1, axisPx);
  return min + frac * (max - min);
}

export function pixelToLogValue(px, axisPx, min, max) {
  const frac = 1 - Math.max(0, Math.min(axisPx, px)) / Math.max(1, axisPx);
  return 2 ** (Math.log2(min) + frac * (Math.log2(max) - Math.log2(min)));
}
