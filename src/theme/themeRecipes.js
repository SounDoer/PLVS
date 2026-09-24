import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";

export const THEME_VALUE_KINDS = Object.freeze({
  SOLID_COLOR: "solidColor",
  COLOR_EFFECT: "colorEffect",
  COLOR_SCALE: "colorScale",
});

const SNAP = {
  dark: { dL: 0.12, dC: -0.006, dH: 36 },
  light: { dL: -0.16, dC: -0.02, dH: 18 },
};
const COMPANION = {
  dark: { dL: -0.138, dC: -0.02, dH: -4.4 },
  light: { dL: -0.18, dC: -0.02, dH: -6 },
};

function hexChannels(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function channelsHex(channels) {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}

function mixHex(from, to, amount) {
  const a = hexChannels(from);
  const b = hexChannels(to);
  return channelsHex(a.map((value, index) => value + (b[index] - value) * amount));
}

function transformHex(hex, delta) {
  return oklchToHex(transform(hexToOklch(hex), delta));
}

function relativeLuminance(hex) {
  const channels = hexChannels(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function desaturate(hex) {
  return oklchToHex({ ...hexToOklch(hex), C: 0 });
}

function effect(color, opacity) {
  return { color, opacity };
}

function colorOf(value) {
  return typeof value === "string" ? value : value.color;
}

const SOLID = THEME_VALUE_KINDS.SOLID_COLOR;
const EFFECT = THEME_VALUE_KINDS.COLOR_EFFECT;

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
  "surface-raised": recipe([[SOLID, SOLID]], SOLID, ([surface, text]) =>
    mixHex(surface, text, 0.03)
  ),
  "surface-control": recipe([[SOLID, SOLID]], SOLID, ([surface, text]) =>
    mixHex(surface, text, 0.07)
  ),
  "surface-muted": recipe([[SOLID, SOLID]], SOLID, ([surface, text]) =>
    mixHex(surface, text, 0.07)
  ),
  "surface-interactive": recipe([[SOLID, SOLID]], SOLID, ([surface, accent]) =>
    mixHex(surface, accent, 0.12)
  ),
  "text-primary": recipe([[SOLID], [SOLID, SOLID, SOLID]], SOLID, ([text]) => text),
  "text-secondary": recipe([[SOLID, SOLID]], SOLID, ([text, surface]) =>
    mixHex(surface, text, 0.58)
  ),
  "text-annotation": recipe([[SOLID, SOLID]], SOLID, ([text, surface]) =>
    mixHex(surface, text, 0.7)
  ),
  border: recipe([[SOLID, SOLID]], EFFECT, (_dependencies, context) =>
    effect(
      context.colorScheme === "dark" ? "#ffffff" : "#000000",
      context.colorScheme === "dark" ? 0.09 : 0.1
    )
  ),
  "input-border": recipe([[EFFECT, SOLID]], EFFECT, (_dependencies, context) =>
    effect(context.colorScheme === "dark" ? "#ffffff" : "#000000", 0.14)
  ),
  "focus-ring": recipe([[SOLID, SOLID]], SOLID, ([accent]) => accent),
  shadow: recipe([[SOLID, SOLID]], EFFECT, ([workspace, text], context) =>
    effect(
      relativeLuminance(workspace) <= relativeLuminance(text) ? workspace : text,
      context.colorScheme === "dark" ? 0.5 : 0.18
    )
  ),
  critical: recipe([[SOLID]], SOLID, ([critical]) => critical),
  companion: recipe([[SOLID, SOLID]], SOLID, ([primary], context) =>
    transformHex(primary, COMPANION[context.colorScheme])
  ),
  snapshot: recipe([[SOLID, SOLID]], SOLID, ([source], context) =>
    transformHex(source, SNAP[context.colorScheme])
  ),
  selection: recipe([[SOLID, SOLID]], SOLID, ([source], context) =>
    transformHex(source, SNAP[context.colorScheme])
  ),
  grid: recipe([[EFFECT, SOLID]], SOLID, ([border, surface]) =>
    mixHex(surface, colorOf(border), 0.08)
  ),
  "grid-subtle": recipe([[EFFECT, SOLID]], SOLID, ([border, surface]) =>
    mixHex(surface, colorOf(border), 0.04)
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
  const resolveKind = (kind) => (kind === "$output" ? roleValueKind : kind);
  return {
    inputKinds: definition.inputKinds.map((signature) => signature.map(resolveKind)),
    outputKind: resolveKind(definition.outputKind),
  };
}

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
