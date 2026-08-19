import { normalizeOpaqueColor } from "./themeColorMath.js";

export const THEME_DOCUMENT_VERSION = 2;
export const THEME_NAME_MAX_LENGTH = 64;

export const CORE_COLOR_KEYS = Object.freeze([
  "workspace",
  "surface",
  "text",
  "interfaceAccent",
  "primaryData",
  "secondaryData",
]);

const STATUS_KEYS = Object.freeze(["good", "warning", "critical"]);
const FREQUENCY_KEYS = Object.freeze(["low", "mid", "high"]);
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function normalizeThemeName(raw) {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  return name && name.length <= THEME_NAME_MAX_LENGTH ? name : null;
}

function normalizeId(raw) {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  return ID_PATTERN.test(id) ? id : null;
}

function normalizeColorRecord(raw, keys) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result = {};
  for (const key of keys) {
    const color = normalizeOpaqueColor(raw[key]);
    if (!color) return null;
    result[key] = color;
  }
  return result;
}

function normalizePresetId(raw) {
  if (raw == null || raw === "") return null;
  return normalizeId(raw);
}

function normalizeIntensity(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.stops) || raw.stops.length < 2) {
    return null;
  }
  const stops = [];
  let previous = -1;
  for (const stop of raw.stops) {
    if (!stop || typeof stop !== "object") return null;
    const position = stop.position;
    const color = normalizeOpaqueColor(stop.color);
    if (
      typeof position !== "number" ||
      !Number.isFinite(position) ||
      position < 0 ||
      position > 1 ||
      position <= previous ||
      !color
    ) {
      return null;
    }
    stops.push({ position, color });
    previous = position;
  }
  if (stops[0].position !== 0 || stops.at(-1).position !== 1) return null;
  const presetId = normalizePresetId(raw.presetId);
  if (raw.presetId != null && raw.presetId !== "" && !presetId) return null;
  return { presetId, stops };
}

function normalizeSimplePalette(raw, keys) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const colors = normalizeColorRecord(raw, keys);
  if (!colors) return null;
  const presetId = normalizePresetId(raw.presetId);
  if (raw.presetId != null && raw.presetId !== "" && !presetId) return null;
  return { presetId, ...colors };
}

function normalizeOverrides(raw) {
  if (raw == null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) return null;
  const result = {};
  for (const [rawRoleId, rawOverride] of Object.entries(raw)) {
    const roleId = normalizeId(rawRoleId);
    if (!roleId || !rawOverride || typeof rawOverride !== "object") return null;
    if (rawOverride.kind === "color") {
      const value = normalizeOpaqueColor(rawOverride.value);
      if (!value) return null;
      result[roleId] = { kind: "color", value };
      continue;
    }
    if (rawOverride.kind === "reference") {
      const source = normalizeId(rawOverride.source);
      if (!source) return null;
      result[roleId] = { kind: "reference", source };
      continue;
    }
    if (rawOverride.kind === "effect") {
      const color = normalizeOpaqueColor(rawOverride.color);
      const opacity = rawOverride.opacity;
      if (
        !color ||
        typeof opacity !== "number" ||
        !Number.isFinite(opacity) ||
        opacity < 0 ||
        opacity > 1
      ) {
        return null;
      }
      result[roleId] = { kind: "effect", color, opacity };
      continue;
    }
    return null;
  }
  return result;
}

/**
 * Normalize a Theme V2 authoring document. Registry compatibility is validated by the compiler;
 * this boundary validates the versioned persisted shape and color/palette structure only.
 *
 * @param {unknown} raw
 * @returns {object|null}
 */
export function normalizeThemeV2(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (raw.version !== THEME_DOCUMENT_VERSION) return null;
  const id = normalizeId(raw.id);
  const name = normalizeThemeName(raw.name);
  const colorScheme =
    raw.colorScheme === "light" || raw.colorScheme === "dark" ? raw.colorScheme : null;
  const core = normalizeColorRecord(raw.core, CORE_COLOR_KEYS);
  const status = normalizeSimplePalette(raw.palettes?.status, STATUS_KEYS);
  const intensity = normalizeIntensity(raw.palettes?.intensity);
  const frequency = normalizeSimplePalette(raw.palettes?.frequency, FREQUENCY_KEYS);
  const overrides = normalizeOverrides(raw.overrides);
  if (!id || !name || !colorScheme || !core || !status || !intensity || !frequency || !overrides) {
    return null;
  }
  return {
    version: THEME_DOCUMENT_VERSION,
    id,
    name,
    colorScheme,
    core,
    palettes: { status, intensity, frequency },
    overrides,
  };
}

export function isThemeV2(raw) {
  return normalizeThemeV2(raw) !== null;
}
