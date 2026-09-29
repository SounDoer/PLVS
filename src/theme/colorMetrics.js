import { hexToOklch } from "./colorTransform.js";

function channels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function relativeLuminance(hex) {
  const [r, g, b] = channels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

export function themeContrastRatio(a, b) {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (lighter + 0.05) / (darker + 0.05);
}

export function themeColorDistance(a, b) {
  const first = hexToOklch(a);
  const second = hexToOklch(b);
  const a1 = first.C * Math.cos((first.H * Math.PI) / 180);
  const b1 = first.C * Math.sin((first.H * Math.PI) / 180);
  const a2 = second.C * Math.cos((second.H * Math.PI) / 180);
  const b2 = second.C * Math.sin((second.H * Math.PI) / 180);
  return Math.hypot(first.L - second.L, a1 - a2, b1 - b2);
}
