import { hexToOklch, oklchToHex, transform } from "./colorTransform.js";
import { normalizeThemeV2 } from "./themeSchema.js";
import { THEME_ROLE_REGISTRY } from "./themeRoleRegistry.js";

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

const RECIPES = {
  identity: ([value]) => structuredClone(value),
  "surface-panel": ([, surface]) => surface,
  // One ladder, all of it stepping AWAY from the workspace toward the text pole:
  // panel sits at the surface, raised a little above it, controls further still.
  // Mixing toward the workspace instead inverts the ladder scheme by scheme --
  // in the default dark theme it made the raised popover a shade darker than the
  // panel it floats over -- which is why the V1 migration had to pin these roles
  // on every builtin.
  "surface-raised": ([surface, text]) => mixHex(surface, text, 0.03),
  "surface-control": ([surface, text]) => mixHex(surface, text, 0.07),
  "surface-muted": ([surface, text]) => mixHex(surface, text, 0.07),
  "surface-interactive": ([surface, accent]) => mixHex(surface, accent, 0.12),
  "text-primary": ([text]) => text,
  "text-secondary": ([text, surface]) => mixHex(surface, text, 0.58),
  "text-annotation": ([text, surface]) => mixHex(surface, text, 0.7),
  border: (_dependencies, context) =>
    effect(
      context.colorScheme === "dark" ? "#ffffff" : "#000000",
      context.colorScheme === "dark" ? 0.09 : 0.1
    ),
  "input-border": (_dependencies, context) =>
    effect(context.colorScheme === "dark" ? "#ffffff" : "#000000", 0.14),
  "focus-ring": ([accent]) => accent,
  // A shadow has to be darker than whatever it falls on, so it cannot simply
  // follow a core color: on a light theme the workspace is the palest thing
  // there is. Take the theme's darkest core color instead -- workspace on a
  // dark theme, text on a light one -- which keeps the shadow dark while still
  // letting the theme tint it. The scheme sets how heavily it lands.
  shadow: ([workspace, text], context) =>
    effect(
      relativeLuminance(workspace) <= relativeLuminance(text) ? workspace : text,
      context.colorScheme === "dark" ? 0.5 : 0.18
    ),
  critical: ([critical]) => critical,
  companion: ([primary], context) => transformHex(primary, COMPANION[context.colorScheme]),
  snapshot: ([source], context) => transformHex(source, SNAP[context.colorScheme]),
  selection: ([source], context) => transformHex(source, SNAP[context.colorScheme]),
  grid: ([border, surface]) => mixHex(surface, colorOf(border), 0.08),
  // Half a step. Subdivisions inside a grid read below its frame; expressing
  // that as a second colour keeps it in the theme, where it can be seen and
  // overridden, instead of as a globalAlpha buried in a draw call.
  "grid-subtle": ([border, surface]) => mixHex(surface, colorOf(border), 0.04),
  // The waveform paints hue to mean frequency and falls back to this for silence
  // and noise, so the fallback has to carry no hue at all: averaging the three
  // frequency colors leaves a tint (pink, on a light theme) that reads as a
  // frequency it does not mean. Keep the average's lightness, drop its chroma.
  "frequency-neutral": ([surface, low, mid, high]) =>
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
    ),
  centroid: ([text]) => text,
};

function directValue(roleId, theme) {
  if (roleId.startsWith("core.")) return theme.core[roleId.slice("core.".length)];
  if (roleId.startsWith("palette.status.")) {
    return theme.palettes.status[roleId.slice("palette.status.".length)];
  }
  if (roleId.startsWith("palette.interface.")) {
    return theme.palettes.interface[roleId.slice("palette.interface.".length)];
  }
  if (roleId === "palette.intensity.stops") return theme.palettes.intensity.stops;
  if (roleId.startsWith("palette.frequency.")) {
    return theme.palettes.frequency[roleId.slice("palette.frequency.".length)];
  }
  return undefined;
}

function cssValue(value) {
  if (typeof value === "string") return value;
  if (value && typeof value.color === "string") {
    const [r, g, b] = hexChannels(value.color);
    return `rgba(${r}, ${g}, ${b}, ${value.opacity})`;
  }
  throw new Error("A palette cannot be published as one CSS color.");
}

function resolveOverride(entry, override, roles) {
  if (!override) return undefined;
  if (!entry.advanced) throw new Error(`Role ${entry.id} does not support Advanced overrides.`);
  if (!entry.advanced.allowedModes.includes(override.kind)) {
    throw new Error(`Override mode ${override.kind} is not allowed for ${entry.id}.`);
  }
  if (override.kind === "color") return override.value;
  if (override.kind === "effect") return effect(override.color, override.opacity);
  if (!entry.advanced.references.includes(override.source)) {
    throw new Error(`Reference ${override.source} is not compatible with ${entry.id}.`);
  }
  return structuredClone(roles[override.source]);
}

/** Purely compile one normalized Theme V2 authoring document into complete runtime output. */
export function compileTheme(rawTheme, options = {}) {
  const theme = normalizeThemeV2(rawTheme);
  if (!theme) throw new Error("Invalid Theme V2 authoring document.");
  const registry = options.registry ?? THEME_ROLE_REGISTRY;
  const roles = {};
  const pending = new Map(registry.map((entry) => [entry.id, entry]));
  const context = { colorScheme: theme.colorScheme, roles };

  while (pending.size) {
    let progressed = false;
    for (const [id, entry] of pending) {
      if (!entry.dependencies.every((dependency) => dependency in roles)) continue;
      const override = theme.overrides[id];
      if (override?.kind === "reference" && pending.has(override.source)) continue;
      const authored = entry.authoring ? directValue(id, theme) : undefined;
      const overridden = resolveOverride(entry, override, roles);
      const dependencies = entry.dependencies.map((dependency) => roles[dependency]);
      const recipe = RECIPES[entry.recipe];
      roles[id] = structuredClone(overridden ?? authored ?? recipe(dependencies, context));
      pending.delete(id);
      progressed = true;
    }
    if (!progressed)
      throw new Error(`Unresolvable theme roles: ${[...pending.keys()].join(", ")}.`);
  }

  for (const roleId of Object.keys(theme.overrides)) {
    if (!roles[roleId]) throw new Error(`Unknown override role: ${roleId}.`);
  }

  const css = {};
  const canvas = {};
  const native = { colorScheme: theme.colorScheme };
  for (const entry of registry) {
    const value = roles[entry.id];
    for (const binding of entry.bindings.css ?? []) css[binding] = cssValue(value);
    for (const binding of entry.bindings.canvas ?? []) canvas[binding] = structuredClone(value);
    for (const binding of entry.bindings.native ?? []) native[binding] = structuredClone(value);
  }

  return {
    id: theme.id,
    name: theme.name,
    colorScheme: theme.colorScheme,
    revision:
      Number.isSafeInteger(options.revision) && options.revision >= 0 ? options.revision : 0,
    roles,
    css,
    canvas,
    native,
  };
}

export { RECIPES };
