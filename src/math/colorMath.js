function parseHexColor(hex) {
  if (typeof hex !== "string") return null;
  const s = hex.trim();
  if (!s.startsWith("#")) return null;
  const raw = s.slice(1);
  if (raw.length === 3) {
    const r = Number.parseInt(raw[0] + raw[0], 16);
    const g = Number.parseInt(raw[1] + raw[1], 16);
    const b = Number.parseInt(raw[2] + raw[2], 16);
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b } : null;
  }
  if (raw.length === 6) {
    const r = Number.parseInt(raw.slice(0, 2), 16);
    const g = Number.parseInt(raw.slice(2, 4), 16);
    const b = Number.parseInt(raw.slice(4, 6), 16);
    return Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b) ? { r, g, b } : null;
  }
  return null;
}

function mixRgb(a, b, t) {
  const x = Math.max(0, Math.min(1, t));
  return {
    r: Math.round(a.r + (b.r - a.r) * x),
    g: Math.round(a.g + (b.g - a.g) * x),
    b: Math.round(a.b + (b.b - a.b) * x),
  };
}

export function samplePeakLineColor(
  dbValue,
  dbToTopFrac,
  meterGradientCfg,
  fallback = "var(--ui-signal-peak-sample)"
) {
  if (!Number.isFinite(dbValue)) return fallback;
  const t = dbToTopFrac(dbValue);
  const midStopPct = Number.isFinite(meterGradientCfg?.midStopPercent)
    ? meterGradientCfg.midStopPercent
    : 40;
  const midStop = Math.max(0.001, Math.min(0.999, midStopPct / 100));
  const cTop = parseHexColor(meterGradientCfg?.top);
  const cMid = parseHexColor(meterGradientCfg?.mid);
  const cBottom = parseHexColor(meterGradientCfg?.bottom);
  if (!cTop || !cMid || !cBottom) return fallback;
  const rgb =
    t <= midStop
      ? mixRgb(cTop, cMid, t / midStop)
      : mixRgb(cMid, cBottom, (t - midStop) / (1 - midStop));
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}
