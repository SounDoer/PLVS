import { oklchToHex } from "./shadcnSemanticPreset.js"; // string oklch(...) -> hex/rgba

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}

/** @param {string} value @returns {{hex:string, alpha:number}} */
export function toEditable(value) {
  const v = typeof value === "string" ? value.trim() : "";
  // hex #rrggbb
  let m = /^#([0-9a-f]{6})$/i.exec(v);
  if (m) return { hex: `#${m[1].toLowerCase()}`, alpha: 1 };
  // rgb/rgba
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(v);
  if (m) {
    const hx = (n) => Number(n).toString(16).padStart(2, "0");
    return {
      hex: `#${hx(m[1])}${hx(m[2])}${hx(m[3])}`,
      alpha: m[4] == null ? 1 : clamp01(parseFloat(m[4])),
    };
  }
  // oklch(...) — reuse the existing string parser, which returns hex or rgba(...)
  if (v.startsWith("oklch(")) {
    const out = oklchToHex(v);
    if (out.startsWith("#")) return { hex: out, alpha: 1 };
    return toEditable(out); // oklchToHex returned rgba(...) for the alpha case
  }
  return { hex: "#808080", alpha: 1 };
}

/** @param {string} hex @param {number} alpha @returns {string} */
export function fromEditable(hex, alpha) {
  if (alpha >= 0.999) return hex;
  const n = parseInt(hex.slice(1), 16);
  const a = Math.round(clamp01(alpha) * 1000) / 1000;
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}
