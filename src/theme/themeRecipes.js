import { relativeLuminance } from "./colorMetrics.js";
import { mixOpaqueColors as mixHex } from "./colorMix.js";
import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

export const THEME_VALUE_KINDS = Object.freeze({
  SOLID_COLOR: "solidColor",
  COLOR_EFFECT: "colorEffect",
  COLOR_SCALE: "colorScale",
});

const SELECTION = {
  dark: { dL: 0.12, dC: -0.006, dH: 36 },
  light: { dL: 0.12, dC: -0.006, dH: 36 },
};

// Dark steps are larger than Light ones: equal mix fractions read weaker on a dark panel.
const SURFACE_STEP = {
  dark: { muted: 0.028, raised: 0.042, control: 0.103 },
  light: { muted: 0.02, raised: 0.03, control: 0.08 },
};
/**
 * @param {string} hex
 */
function hexChannels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelsHex(channels) {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

/**
 * @param {string} hex
 */
function transformHex(hex, delta) {
  return oklchToHex(transform(hexToOklch(hex), delta));
}

// History is a temporal colourway of the same signal. Core Data traces carry the immediate Live /
// Snapshot distinction. Palette colours keep their authored hue and chroma and move only slightly
// toward the panel's lightness, preserving Status, Frequency, and Intensity meaning as one rule.
// Light surfaces need a smaller step: equal OKLCH changes look stronger against paper.
const HISTORY_TRACE = {
  dark: { surfaceMix: 0.22, chromaRetention: 0.82, hueShift: 32 },
  light: { surfaceMix: 0.18, chromaRetention: 0.84, hueShift: 32 },
};

const HISTORY_PALETTE = {
  dark: { surfaceMix: 0.1 },
  light: { surfaceMix: 0.07 },
};

function historyTrace(hex, surface, colorScheme) {
  const source = hexToOklch(hex);
  const panel = hexToOklch(surface);
  const treatment = HISTORY_TRACE[colorScheme];
  return oklchToHex({
    L: source.L * (1 - treatment.surfaceMix) + panel.L * treatment.surfaceMix,
    C: source.C * treatment.chromaRetention,
    H: source.C < 0.02 ? source.H : source.H + treatment.hueShift,
  });
}

function historyPaletteColor(hex, surface, colorScheme) {
  const source = hexToOklch(hex);
  const panel = hexToOklch(surface);
  const treatment = HISTORY_PALETTE[colorScheme];
  return oklchToHex({
    L: source.L * (1 - treatment.surfaceMix) + panel.L * treatment.surfaceMix,
    C: source.C,
    H: source.H,
  });
}

/**
 * @param {string} hex
 */
function desaturate(hex) {
  return oklchToHex({ ...hexToOklch(hex), C: 0 });
}

/**
 * @param {number} opacity
 */
function effect(color, opacity) {
  return { color, opacity };
}

const SOLID = THEME_VALUE_KINDS.SOLID_COLOR;
const EFFECT = THEME_VALUE_KINDS.COLOR_EFFECT;

/**
 * @param {string} outputKind
 */
function recipe(inputKinds, outputKind, resolve) {
  return Object.freeze({ inputKinds, outputKind, resolve });
}

/**
 * The executable recipe catalog is also the compiler contract. `$output` means
 * the recipe preserves the registered role's value kind.
 */
export const THEME_RECIPES = Object.freeze({
  identity: recipe([[], ["$output"]], "$output", ([value]) => structuredClone(value)),
  "surface-panel": recipe([[SOLID, SOLID]], SOLID, ([, surface]) => surface),
  "surface-raised": recipe([[SOLID, SOLID]], SOLID, ([surface, text], context) =>
    mixHex(surface, text, SURFACE_STEP[context.colorScheme].raised)
  ),
  "surface-control": recipe([[SOLID, SOLID]], SOLID, ([surface, text], context) =>
    mixHex(surface, text, SURFACE_STEP[context.colorScheme].control)
  ),
  "surface-muted": recipe([[SOLID, SOLID]], SOLID, ([surface, text], context) =>
    mixHex(surface, text, SURFACE_STEP[context.colorScheme].muted)
  ),
  "text-primary": recipe([[SOLID], [SOLID, SOLID, SOLID]], SOLID, ([text]) => text),
  "text-secondary": recipe([[SOLID, SOLID]], SOLID, ([text, surface], context) =>
    mixHex(surface, text, context.colorScheme === "light" ? 0.62 : 0.58)
  ),
  "text-annotation": recipe([[SOLID, SOLID]], SOLID, ([text, surface]) =>
    mixHex(surface, text, 0.7)
  ),
  border: recipe([[SOLID]], SOLID, ([surface], context) =>
    mixHex(
      surface,
      context.colorScheme === "dark" ? "#ffffff" : "#000000",
      context.colorScheme === "dark" ? 0.12 : 0.1
    )
  ),
  "focus-ring": recipe([[SOLID, SOLID]], SOLID, ([accent]) => accent),
  shadow: recipe([[SOLID, SOLID]], EFFECT, ([workspace, text], context) =>
    effect(
      relativeLuminance(workspace) <= relativeLuminance(text) ? workspace : text,
      context.colorScheme === "dark" ? 0.5 : 0.18
    )
  ),
  semantic: recipe([[SOLID]], SOLID, ([color]) => color),
  history: recipe([[SOLID, SOLID]], SOLID, ([source, surface], context) =>
    historyTrace(source, surface, context.colorScheme)
  ),
  "history-palette-color": recipe([[SOLID, SOLID]], SOLID, ([source, surface], context) =>
    historyPaletteColor(source, surface, context.colorScheme)
  ),
  "history-color-scale": recipe(
    [[THEME_VALUE_KINDS.COLOR_SCALE, SOLID]],
    THEME_VALUE_KINDS.COLOR_SCALE,
    ([stops, surface], context) =>
      stops.map((stop) => ({
        ...stop,
        color: historyPaletteColor(stop.color, surface, context.colorScheme),
      }))
  ),
  selection: recipe([[SOLID, SOLID]], SOLID, ([source], context) =>
    transformHex(source, SELECTION[context.colorScheme])
  ),
  grid: recipe([[SOLID]], SOLID, ([surface], context) =>
    mixHex(surface, context.colorScheme === "dark" ? "#ffffff" : "#000000", 0.08)
  ),
  "frequency-neutral": recipe([[SOLID, SOLID, SOLID, SOLID]], SOLID, ([surface, low, mid, high]) =>
    mixHex(
      surface,
      desaturate(
        channelsHex(
          [low, mid, high]
            .map(hexChannels)
            .reduce((sum, color) => sum.map((value, index) => value + color[index] / 3), [0, 0, 0])
        )
      ),
      0.5
    )
  ),
  centroid: recipe([[SOLID, SOLID]], SOLID, ([text]) => text),
});

export function recipeContract(recipeName, roleValueKind) {
  const definition = THEME_RECIPES[recipeName];
  if (!definition) return null;
  const resolveKind = (/** @type {string} */ kind) => (kind === "$output" ? roleValueKind : kind);
  return {
    inputKinds: definition.inputKinds.map((signature) => signature.map(resolveKind)),
    outputKind: resolveKind(definition.outputKind),
  };
}

/**
 * @param {string} kind
 */
export function isThemeValueOfKind(value, kind) {
  if (kind === THEME_VALUE_KINDS.SOLID_COLOR) {
    return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
  }
  if (kind === THEME_VALUE_KINDS.COLOR_EFFECT) {
    return (
      value != null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      isThemeValueOfKind(value.color, THEME_VALUE_KINDS.SOLID_COLOR) &&
      typeof value.opacity === "number" &&
      Number.isFinite(value.opacity) &&
      value.opacity >= 0 &&
      value.opacity <= 1
    );
  }
  if (kind === THEME_VALUE_KINDS.COLOR_SCALE) {
    return (
      Array.isArray(value) &&
      value.length >= 2 &&
      value.every(
        (stop) =>
          stop != null &&
          typeof stop === "object" &&
          typeof stop.position === "number" &&
          Number.isFinite(stop.position) &&
          isThemeValueOfKind(stop.color, THEME_VALUE_KINDS.SOLID_COLOR)
      )
    );
  }
  return false;
}

export function rgbaCssValue(effectValue) {
  const [r, g, b] = hexChannels(effectValue.color);
  return `rgba(${r}, ${g}, ${b}, ${effectValue.opacity})`;
}
