import { resolveV1Theme } from "../legacy/resolveV1Theme.js";
import { normalizeThemeDocumentShape } from "../themeSchema.js";

const SEMANTIC_ROLE_BINDINGS = {
  "--card": "interface.surface.panel",
  "--popover": "interface.surface.raised",
  "--secondary": "interface.surface.control",
  "--muted": "interface.surface.muted",
  "--accent": "interface.surface.selected",
  "--foreground": "interface.text.primary",
  "--muted-foreground": "interface.text.secondary",
  "--primary-foreground": "interface.content.onAccent",
  "--destructive-foreground": "interface.content.onDanger",
  "--border": "interface.border.default",
  "--ring": "interface.focusRing",
};

const INTERNAL_ROLE_IDS = new Set([
  "interface.content.onPanel",
  "interface.content.onRaised",
  "interface.content.onControl",
  "interface.content.onSelected",
  "interface.border.input",
]);

const FORMAT_1_ROLE_RENAMES = Object.freeze({
  "palette.status.good": "palette.status.safe",
  "palette.interface.critical": "palette.interface.danger",
  "interface.surface.interactive": "interface.surface.selected",
  "interface.content.onInteractive": "interface.content.onSelected",
  "interface.content.onCritical": "interface.content.onDanger",
  "interface.critical": "interface.danger",
});

function migrateOverrides(rawOverrides) {
  if (!rawOverrides || typeof rawOverrides !== "object" || Array.isArray(rawOverrides)) return null;
  const overrides = {};
  for (const [oldRoleId, oldOverride] of Object.entries(rawOverrides)) {
    if (oldRoleId === "interface.critical" || oldRoleId === "interface.danger") continue;
    const roleId = FORMAT_1_ROLE_RENAMES[oldRoleId] ?? oldRoleId;
    if (INTERNAL_ROLE_IDS.has(roleId)) continue;
    if (!oldOverride || typeof oldOverride !== "object" || Array.isArray(oldOverride)) return null;
    overrides[roleId] =
      oldOverride.kind === "effect"
        ? { kind: "color", value: oldOverride.color }
        : oldOverride.kind === "reference"
          ? {
              ...oldOverride,
              source: FORMAT_1_ROLE_RENAMES[oldOverride.source] ?? oldOverride.source,
            }
          : structuredClone(oldOverride);
  }
  return overrides;
}

function migrateSingleVersionShape(raw) {
  const status = raw.palettes?.status;
  const oldInterface = raw.palettes?.interface;
  const oldDangerOverride =
    raw.overrides?.["interface.critical"] ?? raw.overrides?.["interface.danger"];
  const migratedDanger =
    oldDangerOverride?.kind === "color"
      ? oldDangerOverride.value
      : (oldInterface?.danger ?? oldInterface?.critical ?? status?.critical);
  const overrides = migrateOverrides(raw.overrides ?? {});
  if (!overrides) return null;
  return normalizeThemeDocumentShape({
    ...raw,
    formatVersion: 2,
    semanticsVersion: 1,
    palettes: {
      ...raw.palettes,
      status: status
        ? {
            presetId: status.presetId ?? null,
            safe: status.good,
            warning: status.warning,
            critical: status.critical,
          }
        : null,
      interface: status
        ? {
            presetId: null,
            success: oldInterface?.success ?? status.good,
            warning: oldInterface?.warning ?? status.warning,
            danger: migratedDanger,
          }
        : null,
    },
    overrides,
    version: undefined,
  });
}

function rgbHex(r, g, b) {
  return `#${[r, g, b].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function overrideFromCss(value) {
  if (/^#[0-9a-f]{6}$/i.test(value)) return { kind: "color", value: value.toLowerCase() };
  const match = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i.exec(value);
  if (!match) return null;
  return {
    kind: "color",
    value: rgbHex(Number(match[1]), Number(match[2]), Number(match[3])),
  };
}

/** Convert one valid legacy custom-theme document into current authoring intent. */
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
  overrides["spectrogram.ink"] = overrideFromCss(css["--muted-foreground"]);
  overrides["spectrogram.surfaceInk"] = overrideFromCss(css["--foreground"]);
  overrides["spectrogram.grid"] = overrideFromCss(css["--muted-foreground"]);

  const intensityStops = raw.colormap.map(([position, channels]) => ({
    position: position / 255,
    color: rgbHex(channels[0], channels[1], channels[2]),
  }));

  return normalizeThemeDocumentShape({
    formatVersion: 2,
    semanticsVersion: 1,
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
        safe: raw.seeds.signal.good,
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
      interface: {
        presetId: null,
        success: raw.seeds.signal.good,
        warning: raw.seeds.signal.warn,
        danger: css["--destructive"],
      },
    },
    overrides,
  });
}

/** Explicitly migrate the former single-version Theme V2 shape. */
export function migrateV2Theme(raw) {
  if (!raw || typeof raw !== "object" || raw.version !== 2) return null;
  return migrateSingleVersionShape(raw);
}

export function migrateFormat1Theme(raw) {
  if (raw?.formatVersion !== 1 || raw?.semanticsVersion !== 1) return null;
  return migrateSingleVersionShape(raw);
}

export function migrateThemeDocument(raw) {
  const current = normalizeThemeDocumentShape(raw);
  if (current) return { theme: current, notes: [] };
  const format1 = migrateFormat1Theme(raw);
  if (format1) {
    return {
      theme: format1,
      notes: [
        {
          code: "rename-theme-semantics",
          message:
            "Renamed Status Good to Safe, expanded Interface feedback, and renamed selected and danger roles.",
        },
      ],
    };
  }
  const v2 = migrateV2Theme(raw);
  if (v2) {
    return {
      theme: v2,
      notes: [
        {
          code: "split-version-fields",
          message: "Replaced Theme V2 with formatVersion 2 and semanticsVersion 1.",
        },
        ...(raw.palettes?.interface == null
          ? [
              {
                code: "seed-interface-feedback",
                message: "Seeded Interface Success, Warning, and Danger from legacy values.",
              },
            ]
          : []),
      ],
    };
  }
  const v1 = migrateV1Theme(raw);
  if (!v1) return null;
  return {
    theme: v1,
    notes: [
      {
        code: "migrate-legacy-theme",
        message: "Migrated the legacy unversioned Theme to the current format and semantics.",
      },
    ],
  };
}

/** One versioned ingress for individual persisted custom-theme documents. */
export function normalizeThemeDocument(raw) {
  return migrateThemeDocument(raw)?.theme ?? null;
}
