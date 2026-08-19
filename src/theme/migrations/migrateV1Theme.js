import { resolveV1Theme } from "../legacy/resolveV1Theme.js";
import { normalizeThemeV2 } from "../themeSchema.js";

const SEMANTIC_ROLE_BINDINGS = {
  "--card": "interface.surface.panel",
  "--popover": "interface.surface.raised",
  "--secondary": "interface.surface.control",
  "--muted": "interface.surface.muted",
  "--accent": "interface.surface.interactive",
  "--foreground": "interface.text.primary",
  "--muted-foreground": "interface.text.secondary",
  "--card-foreground": "interface.content.onPanel",
  "--popover-foreground": "interface.content.onRaised",
  "--secondary-foreground": "interface.content.onControl",
  "--accent-foreground": "interface.content.onInteractive",
  "--primary-foreground": "interface.content.onAccent",
  "--destructive-foreground": "interface.content.onCritical",
  "--border": "interface.border.default",
  "--input": "interface.border.input",
  "--ring": "interface.focusRing",
  "--destructive": "interface.critical",
};

function rgbHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function overrideFromCss(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return { kind: "color", value: value.toLowerCase() };
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (!match) return null;
  return {
    kind: "effect",
    color: rgbHex(Number(match[1]), Number(match[2]), Number(match[3])),
    opacity: Number(match[4]),
  };
}

/** Convert one valid legacy custom-theme document into normalized Theme V2 authoring intent. */
export function migrateV1Theme(raw) {
  if (!raw || typeof raw !== "object" || raw.version != null) return null;
  if (typeof raw.id !== "string" || !raw.id.startsWith("custom-")) return null;
  if (typeof raw.name !== "string" || !raw.name.trim()) return null;
  if (raw.colorScheme !== "dark" && raw.colorScheme !== "light") return null;
  if (!raw.seeds || !raw.semantic || !Array.isArray(raw.colormap)) return null;
  if (
    raw.colormap.length < 2 ||
    !raw.colormap.every(
      (stop) =>
        Array.isArray(stop) &&
        Number.isInteger(stop[0]) &&
        stop[0] >= 0 &&
        stop[0] <= 255 &&
        Array.isArray(stop[1]) &&
        stop[1].length === 3 &&
        stop[1].every((channel) => Number.isInteger(channel) && channel >= 0 && channel <= 255)
    ) ||
    raw.colormap[0][0] !== 0 ||
    raw.colormap.at(-1)[0] !== 255
  ) {
    return null;
  }

  let legacy;
  try {
    legacy = resolveV1Theme(raw);
  } catch {
    return null;
  }
  const css = legacy.css;
  const overrides = {};
  for (const [binding, roleId] of Object.entries(SEMANTIC_ROLE_BINDINGS)) {
    const override = overrideFromCss(css[binding]);
    if (!override) return null;
    overrides[roleId] = override;
  }
  overrides["waveform.frequencyNeutral"] = overrideFromCss(css["--ui-waveform-frequency-neutral"]);
  overrides["waveform.centroid"] = overrideFromCss(css["--ui-waveform-centroid"]);

  const intensityStops = raw.colormap.map(([position, channels]) => ({
    position: position / 255,
    color: rgbHex(channels[0], channels[1], channels[2]),
  }));

  return normalizeThemeV2({
    version: 2,
    id: raw.id,
    name: raw.name.trim().slice(0, 64),
    colorScheme: raw.colorScheme,
    core: {
      workspace: css["--background"],
      surface: css["--card"],
      text: css["--foreground"],
      interfaceAccent: raw.seeds.accent,
      primaryData: raw.seeds.accent,
      secondaryData: raw.seeds.accentSecondary,
    },
    palettes: {
      status: {
        presetId: null,
        good: raw.seeds.signal.good,
        warning: raw.seeds.signal.warn,
        critical: raw.seeds.signal.bad,
      },
      intensity: { presetId: null, stops: intensityStops },
      frequency: {
        presetId: null,
        low: css["--ui-waveform-frequency-low"],
        mid: css["--ui-waveform-frequency-mid"],
        high: css["--ui-waveform-frequency-high"],
      },
    },
    overrides,
  });
}

/** One versioned ingress for individual custom-theme documents. */
export function normalizeThemeDocument(raw) {
  if (raw?.version === 2) return normalizeThemeV2(raw);
  return migrateV1Theme(raw);
}
