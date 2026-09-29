/**
 * Converts an oklch() CSS value string to a hex or rgba fallback string.
 * Handles `oklch(L C H)` and `oklch(L C H / alpha%)`.
 * @param {string} value
 * @returns {string} e.g. `#1a1a1a` or `rgba(255, 255, 255, 0.1)`
 */
export function oklchToHex(value) {
  const m = value.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)/i);
  if (!m) return value;

  const L = parseFloat(m[1]);
  const C = parseFloat(m[2]);
  const H = parseFloat(m[3]);
  const alpha =
    m[4] != null ? (m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4])) : null;

  // OKLCH → OKLab
  const hRad = (H * Math.PI) / 180;
  const a = C * Math.cos(hRad);
  const b = C * Math.sin(hRad);

  // OKLab → LMS (before cube)
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  // Cube to get linear LMS
  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  // Linear LMS → linear sRGB
  const rLin = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gLin = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bLin = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  // Linear sRGB → gamma-corrected sRGB
  const toGamma = (c) => {
    const clamped = Math.max(0, Math.min(1, c));
    return clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
  };

  const r = Math.round(toGamma(rLin) * 255);
  const g = Math.round(toGamma(gLin) * 255);
  const b2 = Math.round(toGamma(bLin) * 255);

  if (alpha != null) {
    const a2 = Math.round(alpha * 1000) / 1000;
    return `rgba(${r}, ${g}, ${b2}, ${a2})`;
  }
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b2.toString(16).padStart(2, "0")}`;
}

/**
 * Returns value with oklch converted to hex/rgba when the engine lacks oklch support.
 * Safe to call in non-browser environments (returns value unchanged).
 * @param {string | undefined | null} value
 * @returns {string | undefined | null}
 */
export function oklchSafe(value) {
  if (
    typeof value !== "string" ||
    !value.trim().startsWith("oklch(") ||
    (typeof CSS !== "undefined" &&
      typeof CSS.supports === "function" &&
      CSS.supports("color", "oklch(0 0 0)"))
  ) {
    return value;
  }
  return oklchToHex(value);
}
