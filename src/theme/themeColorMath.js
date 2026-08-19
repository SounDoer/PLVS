import { oklchToHex } from "./colorTransform.js";

function byteToHex(value) {
  return Math.round(value).toString(16).padStart(2, "0");
}

const CSS_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;

function parseCssNumber(value) {
  return CSS_NUMBER_PATTERN.test(value) ? Number(value) : null;
}

function parseRgbChannel(value) {
  const raw = value.trim();
  if (raw.endsWith("%")) {
    const percent = parseCssNumber(raw.slice(0, -1));
    return Number.isFinite(percent) && percent >= 0 && percent <= 100
      ? (percent / 100) * 255
      : null;
  }
  const channel = parseCssNumber(raw);
  return Number.isFinite(channel) && channel >= 0 && channel <= 255 ? channel : null;
}

function normalizeHex(value) {
  let match = /^#([0-9a-f]{3})$/i.exec(value);
  if (match) {
    const [r, g, b] = match[1].toLowerCase();
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  match = /^#([0-9a-f]{6})$/i.exec(value);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function normalizeRgb(value) {
  const comma = /^rgb\(\s*([^,/\s]+)\s*,\s*([^,/\s]+)\s*,\s*([^,/\s]+)\s*\)$/i.exec(value);
  const space = /^rgb\(\s*([^,/\s]+)\s+([^,/\s]+)\s+([^,/\s]+)\s*\)$/i.exec(value);
  const match = comma ?? space;
  if (!match) return null;
  const channels = match.slice(1).map(parseRgbChannel);
  if (channels.some((channel) => channel === null)) return null;
  return `#${channels.map(byteToHex).join("")}`;
}

function normalizeOklch(value) {
  const match = /^oklch\(\s*([^/\s]+)\s+([^/\s]+)\s+([^/\s]+)\s*\)$/i.exec(value);
  if (!match) return null;

  const lightnessRaw = match[1];
  const parsedLightness = parseCssNumber(
    lightnessRaw.endsWith("%") ? lightnessRaw.slice(0, -1) : lightnessRaw
  );
  const lightness =
    lightnessRaw.endsWith("%") && parsedLightness !== null
      ? parsedLightness / 100
      : parsedLightness;
  const chroma = parseCssNumber(match[2]);
  const hue = parseCssNumber(match[3].replace(/deg$/i, ""));
  if (
    !Number.isFinite(lightness) ||
    !Number.isFinite(chroma) ||
    !Number.isFinite(hue) ||
    lightness < 0 ||
    lightness > 1 ||
    chroma < 0
  ) {
    return null;
  }

  return oklchToHex({
    L: lightness,
    C: chroma,
    H: ((hue % 360) + 360) % 360,
  });
}

/**
 * Normalize an opaque authoring color to lowercase `#rrggbb`.
 *
 * Theme V2 deliberately rejects alpha syntax here. Identity colors are opaque; effect opacity is
 * represented separately in resolved output.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeOpaqueColor(raw) {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (!value || value.includes("/") || /^rgba/i.test(value)) return null;
  return normalizeHex(value) ?? normalizeRgb(value) ?? normalizeOklch(value);
}

export function isOpaqueHexColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/.test(value);
}
