const KNOWN_RECIPES = new Set([
  "identity",
  "surface-panel",
  "surface-raised",
  "surface-control",
  "surface-muted",
  "surface-interactive",
  "text-primary",
  "text-secondary",
  "text-annotation",
  "text-muted",
  "text-disabled",
  "content-contrast",
  "border",
  "input-border",
  "focus-ring",
  "critical",
  "companion",
  "snapshot",
  "selection",
  "grid",
  "frequency-neutral",
  "centroid",
  "effect-scrim",
  "effect-sheen",
  "effect-shadow",
]);

const BINDING_KINDS = ["css", "canvas", "native"];
const ROLE_KINDS = new Set(["color", "palette", "effect"]);
const AUTHORING_FAMILIES = new Set(["core", "palette"]);

function role(id, options) {
  return { id, dependencies: [], bindings: {}, ...options };
}

function direct(id, kind = "color", options = {}) {
  return role(id, {
    kind,
    family: id.split(".")[0],
    recipe: "identity",
    authoring: true,
    ...options,
  });
}

function advanced(section, label, description, allowedModes, references = []) {
  return { section, label, description, allowedModes, references };
}

const colorOverride = (section, label, description) =>
  advanced(section, label, description, ["color"]);

const dataOverride = (section, label, description, references) =>
  advanced(section, label, description, ["color", "reference"], references);

const RAW_THEME_ROLE_REGISTRY = [
  direct("core.workspace", "color", { bindings: { css: ["--background"] } }),
  direct("core.surface"),
  direct("core.text"),
  direct("core.interfaceAccent", "color", { bindings: { css: ["--primary"] } }),
  direct("core.primaryData"),
  direct("core.secondaryData"),
  direct("palette.status.good"),
  direct("palette.status.warning"),
  direct("palette.status.critical"),
  direct("palette.intensity.stops", "palette"),
  direct("palette.frequency.low"),
  direct("palette.frequency.mid"),
  direct("palette.frequency.high"),

  role("interface.surface.panel", {
    kind: "color",
    family: "interface",
    recipe: "surface-panel",
    dependencies: ["core.workspace", "core.surface"],
    bindings: { css: ["--card"] },
    advanced: colorOverride("Interface", "Panel Surface", "Main panels and content surfaces."),
  }),
  role("interface.surface.raised", {
    kind: "color",
    family: "interface",
    recipe: "surface-raised",
    dependencies: ["core.surface", "core.workspace"],
    bindings: { css: ["--popover"] },
    advanced: colorOverride("Interface", "Raised Surface", "Menus, popovers, and raised layers."),
  }),
  role("interface.surface.control", {
    kind: "color",
    family: "interface",
    recipe: "surface-control",
    dependencies: ["core.surface", "core.workspace"],
    bindings: { css: ["--secondary"] },
    advanced: colorOverride("Interface", "Control Surface", "Buttons and neutral controls."),
  }),
  role("interface.surface.muted", {
    kind: "color",
    family: "interface",
    recipe: "surface-muted",
    dependencies: ["core.surface", "core.workspace"],
    bindings: { css: ["--muted"] },
    advanced: colorOverride("Interface", "Muted Surface", "Subdued and inactive regions."),
  }),
  role("interface.surface.interactive", {
    kind: "color",
    family: "interface",
    recipe: "surface-interactive",
    dependencies: ["core.surface", "core.interfaceAccent"],
    bindings: { css: ["--accent"] },
    advanced: colorOverride(
      "Interface",
      "Interactive Surface",
      "Selected and emphasized controls."
    ),
  }),
  role("interface.text.primary", {
    kind: "color",
    family: "interface",
    recipe: "text-primary",
    dependencies: ["core.text", "core.workspace", "core.surface"],
    bindings: { css: ["--foreground"] },
    advanced: colorOverride("Interface", "Primary Text", "Headings and normal body text."),
  }),
  role("interface.text.secondary", {
    kind: "color",
    family: "interface",
    recipe: "text-secondary",
    dependencies: ["core.text", "core.surface"],
    bindings: { css: ["--muted-foreground"] },
    advanced: colorOverride("Interface", "Secondary Text", "Supporting labels and descriptions."),
  }),
  role("interface.text.annotation", {
    kind: "color",
    family: "interface",
    recipe: "text-annotation",
    dependencies: ["core.text", "core.surface"],
    bindings: { css: ["--ui-text-annotation"] },
    advanced: colorOverride(
      "Interface",
      "Annotation Text",
      "Units, axes, and compact annotations."
    ),
  }),
  role("interface.text.muted", {
    kind: "color",
    family: "interface",
    recipe: "text-muted",
    dependencies: ["core.text", "core.surface"],
    bindings: { css: ["--ui-text-muted"] },
    advanced: colorOverride("Interface", "Muted Text", "Intentionally quiet text."),
  }),
  role("interface.text.disabled", {
    kind: "color",
    family: "interface",
    recipe: "text-disabled",
    dependencies: ["core.text", "core.surface"],
    bindings: { css: ["--ui-text-disabled"] },
    advanced: colorOverride("Interface", "Disabled Text", "Unavailable control labels."),
  }),
  role("interface.content.onAccent", {
    kind: "color",
    family: "interface",
    recipe: "content-contrast",
    dependencies: ["core.text", "core.interfaceAccent"],
    bindings: { css: ["--primary-foreground"] },
    advanced: colorOverride(
      "Interface",
      "Text on Accent",
      "Content placed on accent-colored areas."
    ),
  }),
  role("interface.content.onPanel", {
    kind: "color",
    family: "interface",
    recipe: "content-contrast",
    dependencies: ["core.text", "interface.surface.panel"],
    bindings: { css: ["--card-foreground"] },
    advanced: colorOverride("Interface", "Text on Panel", "Content placed on panel surfaces."),
  }),
  role("interface.content.onRaised", {
    kind: "color",
    family: "interface",
    recipe: "content-contrast",
    dependencies: ["core.text", "interface.surface.raised"],
    bindings: { css: ["--popover-foreground"] },
    advanced: colorOverride(
      "Interface",
      "Text on Raised Surface",
      "Content placed on popovers and raised layers."
    ),
  }),
  role("interface.content.onControl", {
    kind: "color",
    family: "interface",
    recipe: "content-contrast",
    dependencies: ["core.text", "interface.surface.control"],
    bindings: { css: ["--secondary-foreground"] },
    advanced: colorOverride("Interface", "Text on Control", "Content placed on neutral controls."),
  }),
  role("interface.content.onInteractive", {
    kind: "color",
    family: "interface",
    recipe: "content-contrast",
    dependencies: ["core.text", "interface.surface.interactive"],
    bindings: { css: ["--accent-foreground"] },
    advanced: colorOverride(
      "Interface",
      "Text on Interactive Surface",
      "Content placed on selected controls."
    ),
  }),
  role("interface.content.onCritical", {
    kind: "color",
    family: "interface",
    recipe: "content-contrast",
    dependencies: ["core.text", "palette.status.critical"],
    bindings: { css: ["--destructive-foreground"] },
    advanced: colorOverride(
      "Interface",
      "Text on Critical",
      "Content placed on critical-colored areas."
    ),
  }),
  role("interface.border.default", {
    kind: "color",
    family: "interface",
    recipe: "border",
    dependencies: ["core.surface", "core.text"],
    bindings: { css: ["--border"] },
    advanced: colorOverride("Interface", "Default Border", "Panel and control separators."),
  }),
  role("interface.border.input", {
    kind: "color",
    family: "interface",
    recipe: "input-border",
    dependencies: ["interface.border.default", "core.surface"],
    bindings: { css: ["--input"] },
    advanced: colorOverride("Interface", "Input Border", "Editable field boundaries."),
  }),
  role("interface.focusRing", {
    kind: "color",
    family: "interface",
    recipe: "focus-ring",
    dependencies: ["core.interfaceAccent", "core.surface"],
    bindings: { css: ["--ring"] },
    advanced: colorOverride("Interface", "Focus Ring", "Keyboard focus indicator."),
  }),
  role("interface.selection", {
    kind: "color",
    family: "interface",
    recipe: "selection",
    dependencies: ["core.interfaceAccent", "core.surface"],
    bindings: { css: ["--ui-selection"] },
    advanced: colorOverride("Interface", "Selection", "Selected interface content."),
  }),
  role("interface.critical", {
    kind: "color",
    family: "interface",
    recipe: "critical",
    dependencies: ["palette.status.critical"],
    bindings: { css: ["--destructive"] },
    advanced: colorOverride(
      "Interface",
      "Critical Action",
      "Destructive controls and critical emphasis."
    ),
  }),

  role("data.primary", {
    kind: "color",
    family: "data",
    recipe: "identity",
    dependencies: ["core.primaryData"],
  }),
  role("data.secondary", {
    kind: "color",
    family: "data",
    recipe: "identity",
    dependencies: ["core.secondaryData"],
  }),
  role("data.companion", {
    kind: "color",
    family: "data",
    recipe: "companion",
    dependencies: ["data.primary", "core.surface"],
  }),
  role("data.snapshot.primary", {
    kind: "color",
    family: "data",
    recipe: "snapshot",
    dependencies: ["data.primary", "core.surface"],
  }),
  role("data.snapshot.secondary", {
    kind: "color",
    family: "data",
    recipe: "snapshot",
    dependencies: ["data.secondary", "core.surface"],
  }),
  role("data.snapshot.companion", {
    kind: "color",
    family: "data",
    recipe: "snapshot",
    dependencies: ["data.companion", "core.surface"],
  }),
  role("data.selection", {
    kind: "color",
    family: "data",
    recipe: "selection",
    dependencies: ["data.primary", "core.surface"],
  }),
  role("data.grid", {
    kind: "color",
    family: "data",
    recipe: "grid",
    dependencies: ["interface.border.default", "core.surface"],
  }),
  role("data.annotation", {
    kind: "color",
    family: "data",
    recipe: "identity",
    dependencies: ["interface.text.annotation"],
  }),

  role("meter.safe", {
    kind: "color",
    family: "meter",
    recipe: "identity",
    dependencies: ["palette.status.good"],
    bindings: { css: ["--ui-signal-good", "--ui-meter-gradient-bottom"] },
  }),
  role("meter.warning", {
    kind: "color",
    family: "meter",
    recipe: "identity",
    dependencies: ["palette.status.warning"],
    bindings: { css: ["--ui-signal-warn", "--ui-meter-gradient-mid"] },
  }),
  role("meter.critical", {
    kind: "color",
    family: "meter",
    recipe: "identity",
    dependencies: ["palette.status.critical"],
    bindings: { css: ["--ui-signal-bad", "--ui-meter-gradient-top"] },
  }),

  ...moduleRoles(),

  role("effect.scrim", {
    kind: "effect",
    family: "effect",
    recipe: "effect-scrim",
    dependencies: ["core.workspace", "core.text"],
    bindings: { css: ["--ui-effect-scrim"] },
  }),
  role("effect.surfaceSheen", {
    kind: "effect",
    family: "effect",
    recipe: "effect-sheen",
    dependencies: ["core.surface", "core.text"],
    bindings: { css: ["--ui-effect-surface-sheen"] },
  }),
  role("effect.surfaceShadow", {
    kind: "effect",
    family: "effect",
    recipe: "effect-shadow",
    dependencies: ["core.workspace", "core.text"],
    bindings: { css: ["--ui-effect-surface-shadow"] },
  }),
];

function moduleRoles() {
  const primaryRefs = ["core.primaryData", "core.secondaryData"];
  return [
    moduleColor(
      "loudness.momentary",
      "Loudness",
      "Momentary",
      "data.primary",
      "identity",
      {
        css: ["--ui-loudness-momentary"],
        canvas: ["loudness.momentary"],
      },
      primaryRefs
    ),
    moduleColor(
      "loudness.shortTerm",
      "Loudness",
      "Short-term",
      "data.companion",
      "identity",
      {
        css: ["--ui-loudness-shortterm"],
        canvas: ["loudness.shortTerm"],
      },
      primaryRefs
    ),
    moduleColor(
      "loudness.momentarySnapshot",
      "Loudness",
      "Momentary Snapshot",
      "data.snapshot.primary",
      "identity",
      { css: ["--ui-loudness-momentary-snap"] },
      primaryRefs
    ),
    moduleColor(
      "loudness.shortTermSnapshot",
      "Loudness",
      "Short-term Snapshot",
      "data.snapshot.companion",
      "identity",
      { css: ["--ui-loudness-shortterm-snap"] },
      primaryRefs
    ),
    moduleColor(
      "loudness.reference",
      "Loudness",
      "Reference Guide",
      "data.annotation",
      "identity",
      { css: ["--ui-loudness-reference"] },
      primaryRefs
    ),
    moduleColor(
      "loudness.selection",
      "Loudness",
      "Selection",
      "data.selection",
      "identity",
      { css: ["--ui-loudness-selection"], canvas: ["loudness.selection"] },
      primaryRefs
    ),

    moduleColor(
      "spectrum.primary",
      "Spectrum",
      "Primary Trace",
      "data.primary",
      "identity",
      { css: ["--ui-spectrum-primary"], canvas: ["spectrum.primary"] },
      primaryRefs
    ),
    moduleColor(
      "spectrum.secondary",
      "Spectrum",
      "Secondary Trace",
      "data.secondary",
      "identity",
      { css: ["--ui-spectrum-secondary"], canvas: ["spectrum.secondary"] },
      primaryRefs
    ),
    moduleColor(
      "spectrum.primarySnapshot",
      "Spectrum",
      "Primary Snapshot",
      "data.snapshot.primary",
      "identity",
      { css: ["--ui-spectrum-primary-snap"] },
      primaryRefs
    ),
    moduleColor(
      "spectrum.secondarySnapshot",
      "Spectrum",
      "Secondary Snapshot",
      "data.snapshot.secondary",
      "identity",
      { css: ["--ui-spectrum-secondary-snap"] },
      primaryRefs
    ),
    moduleColor(
      "spectrum.grid",
      "Spectrum",
      "Grid",
      "data.grid",
      "identity",
      { css: ["--ui-spectrum-grid"], canvas: ["spectrum.grid"] },
      primaryRefs
    ),

    role("spectrogram.intensity", {
      kind: "palette",
      family: "spectrogram",
      recipe: "identity",
      dependencies: ["palette.intensity.stops"],
      bindings: { canvas: ["spectrogram.intensity"] },
    }),
    moduleColor(
      "spectrogram.ink",
      "Spectrogram",
      "Monochrome Ink",
      "data.primary",
      "identity",
      { canvas: ["spectrogram.ink"] },
      primaryRefs
    ),
    moduleColor(
      "spectrogram.grid",
      "Spectrogram",
      "Grid and Axes",
      "data.grid",
      "identity",
      { canvas: ["spectrogram.grid"] },
      primaryRefs
    ),
    moduleColor(
      "spectrogram.selection",
      "Spectrogram",
      "Selection",
      "data.selection",
      "identity",
      { canvas: ["spectrogram.selection"] },
      primaryRefs
    ),

    moduleColor(
      "vectorscope.trace",
      "Vectorscope",
      "Trace",
      "data.primary",
      "identity",
      { css: ["--ui-vectorscope-trace"], canvas: ["vectorscope.trace"] },
      primaryRefs
    ),
    moduleColor(
      "vectorscope.snapshot",
      "Vectorscope",
      "Snapshot",
      "data.snapshot.primary",
      "identity",
      { css: ["--ui-vectorscope-trace-snap"], canvas: ["vectorscope.snapshot"] },
      primaryRefs
    ),
    moduleColor(
      "vectorscope.grid",
      "Vectorscope",
      "Grid and Axes",
      "data.grid",
      "identity",
      { css: ["--ui-vectorscope-grid-stroke"], canvas: ["vectorscope.grid"] },
      primaryRefs
    ),

    moduleColor(
      "stereoMap.primary",
      "Stereo Map",
      "Primary Side",
      "data.primary",
      "identity",
      { css: ["--ui-stereo-map-primary"], canvas: ["stereoMap.primary"] },
      primaryRefs
    ),
    moduleColor(
      "stereoMap.secondary",
      "Stereo Map",
      "Secondary Side",
      "data.secondary",
      "identity",
      { css: ["--ui-stereo-map-secondary"], canvas: ["stereoMap.secondary"] },
      primaryRefs
    ),
    moduleColor(
      "stereoMap.primarySnapshot",
      "Stereo Map",
      "Primary Snapshot",
      "data.snapshot.primary",
      "identity",
      { css: ["--ui-stereo-map-primary-snap"], canvas: ["stereoMap.primarySnapshot"] },
      primaryRefs
    ),
    moduleColor(
      "stereoMap.secondarySnapshot",
      "Stereo Map",
      "Secondary Snapshot",
      "data.snapshot.secondary",
      "identity",
      { css: ["--ui-stereo-map-secondary-snap"], canvas: ["stereoMap.secondarySnapshot"] },
      primaryRefs
    ),
    moduleColor(
      "stereoMap.grid",
      "Stereo Map",
      "Grid and Axes",
      "data.grid",
      "identity",
      { canvas: ["stereoMap.grid"] },
      primaryRefs
    ),

    moduleColor(
      "waveform.trace",
      "Waveform",
      "Trace",
      "data.primary",
      "identity",
      { css: ["--ui-waveform-trace"], canvas: ["waveform.trace"] },
      primaryRefs
    ),
    moduleColor(
      "waveform.snapshot",
      "Waveform",
      "Snapshot",
      "data.snapshot.primary",
      "identity",
      { css: ["--ui-waveform-trace-snap"], canvas: ["waveform.snapshot"] },
      primaryRefs
    ),
    moduleColor(
      "waveform.frequencyLow",
      "Waveform",
      "Low Frequency",
      "palette.frequency.low",
      "identity",
      { css: ["--ui-waveform-frequency-low"], canvas: ["waveform.frequencyLow"] },
      ["palette.frequency.low", ...primaryRefs]
    ),
    moduleColor(
      "waveform.frequencyMid",
      "Waveform",
      "Mid Frequency",
      "palette.frequency.mid",
      "identity",
      { css: ["--ui-waveform-frequency-mid"], canvas: ["waveform.frequencyMid"] },
      ["palette.frequency.mid", ...primaryRefs]
    ),
    moduleColor(
      "waveform.frequencyHigh",
      "Waveform",
      "High Frequency",
      "palette.frequency.high",
      "identity",
      { css: ["--ui-waveform-frequency-high"], canvas: ["waveform.frequencyHigh"] },
      ["palette.frequency.high", ...primaryRefs]
    ),
    moduleColor(
      "waveform.frequencyNeutral",
      "Waveform",
      "Frequency Neutral",
      "core.surface",
      "frequency-neutral",
      { css: ["--ui-waveform-frequency-neutral"], canvas: ["waveform.frequencyNeutral"] },
      primaryRefs,
      ["palette.frequency.low", "palette.frequency.mid", "palette.frequency.high"]
    ),
    moduleColor(
      "waveform.centroid",
      "Waveform",
      "Centroid",
      "core.text",
      "centroid",
      { css: ["--ui-waveform-centroid"], canvas: ["waveform.centroid"] },
      ["core.text", ...primaryRefs],
      ["core.surface"]
    ),
    moduleColor(
      "waveform.grid",
      "Waveform",
      "Grid",
      "data.grid",
      "identity",
      { canvas: ["waveform.grid"] },
      primaryRefs
    ),
    moduleColor(
      "waveform.selection",
      "Waveform",
      "Selection",
      "data.selection",
      "identity",
      { canvas: ["waveform.selection"] },
      primaryRefs
    ),
  ];
}

function moduleColor(id, section, label, dependency, recipe, bindings, references, extra = []) {
  return role(id, {
    kind: "color",
    family: id.split(".")[0],
    recipe,
    dependencies: [dependency, ...extra],
    bindings,
    advanced: dataOverride(section, label, `Color used for ${label.toLowerCase()}.`, references),
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function validateThemeRoleRegistry(roles) {
  const errors = [];
  if (!Array.isArray(roles)) return ["Registry must be an array."];

  const byId = new Map();
  for (const entry of roles) {
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
      errors.push("Every registry entry must have a string ID.");
      continue;
    }
    if (byId.has(entry.id)) errors.push(`Duplicate role ID: ${entry.id}.`);
    else byId.set(entry.id, entry);
  }

  const bindingOwners = new Map();
  for (const entry of byId.values()) {
    if (!ROLE_KINDS.has(entry.kind)) errors.push(`Unknown kind for ${entry.id}: ${entry.kind}.`);
    if (!KNOWN_RECIPES.has(entry.recipe)) {
      errors.push(`Unknown recipe for ${entry.id}: ${entry.recipe}.`);
    }
    if (!Array.isArray(entry.dependencies)) {
      errors.push(`Dependencies for ${entry.id} must be an array.`);
    } else {
      for (const dependency of entry.dependencies) {
        if (!byId.has(dependency))
          errors.push(`Missing dependency for ${entry.id}: ${dependency}.`);
      }
    }
    validateAdvanced(entry, byId, errors);
    validateBindings(entry, bindingOwners, errors);
  }

  validateCycles(byId, errors);
  validateAuthoringConsumers(byId, errors);
  return errors;
}

function validateAdvanced(entry, byId, errors) {
  if (!entry.advanced) return;
  const { section, label, description, allowedModes, references = [] } = entry.advanced;
  if (![section, label, description].every((value) => typeof value === "string" && value.trim())) {
    errors.push(`Advanced metadata is incomplete for ${entry.id}.`);
  }
  if (!Array.isArray(allowedModes) || allowedModes.length === 0) {
    errors.push(`Advanced modes are missing for ${entry.id}.`);
    return;
  }
  const unknownModes = allowedModes.filter((mode) => mode !== "color" && mode !== "reference");
  if (unknownModes.length)
    errors.push(`Unknown Advanced mode for ${entry.id}: ${unknownModes[0]}.`);
  if (!allowedModes.includes("reference") && references.length) {
    errors.push(`References are not enabled for ${entry.id}.`);
  }
  for (const reference of references) {
    const source = byId.get(reference);
    if (!source) errors.push(`Missing compatible reference for ${entry.id}: ${reference}.`);
    else if (source.kind !== entry.kind) {
      errors.push(`Incompatible reference for ${entry.id}: ${reference}.`);
    }
  }
}

function validateBindings(entry, owners, errors) {
  if (!entry.bindings || typeof entry.bindings !== "object" || Array.isArray(entry.bindings)) {
    errors.push(`Bindings for ${entry.id} must be an object.`);
    return;
  }
  for (const [kind, values] of Object.entries(entry.bindings)) {
    if (!BINDING_KINDS.includes(kind) || !Array.isArray(values)) {
      errors.push(`Invalid binding group for ${entry.id}: ${kind}.`);
      continue;
    }
    for (const value of values) {
      if (typeof value !== "string" || !value.trim()) {
        errors.push(`Invalid ${kind} binding for ${entry.id}.`);
        continue;
      }
      const key = `${kind}:${value}`;
      if (owners.has(key))
        errors.push(`Duplicate ${kind} binding ${value}: ${owners.get(key)} and ${entry.id}.`);
      else owners.set(key, entry.id);
    }
  }
}

function validateCycles(byId, errors) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id, path) {
    if (visiting.has(id)) {
      errors.push(`Dependency cycle: ${[...path, id].join(" -> ")}.`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    const entry = byId.get(id);
    for (const dependency of entry?.dependencies ?? []) {
      if (byId.has(dependency)) visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of byId.keys()) visit(id, []);
}

function validateAuthoringConsumers(byId, errors) {
  const consumed = new Set();
  for (const entry of byId.values()) {
    for (const dependency of entry.dependencies ?? []) consumed.add(dependency);
  }
  for (const entry of byId.values()) {
    if (entry.authoring && AUTHORING_FAMILIES.has(entry.family) && !consumed.has(entry.id)) {
      errors.push(`Authoring role has no downstream consumer: ${entry.id}.`);
    }
  }
}

export function createThemeRoleRegistry(roles) {
  const errors = validateThemeRoleRegistry(roles);
  if (errors.length) throw new Error(errors.join("\n"));
  return deepFreeze(roles.map((entry) => structuredClone(entry)));
}

export const THEME_ROLE_REGISTRY = createThemeRoleRegistry(RAW_THEME_ROLE_REGISTRY);
const THEME_ROLES_BY_ID = new Map(THEME_ROLE_REGISTRY.map((entry) => [entry.id, entry]));

export function getThemeRole(id) {
  return THEME_ROLES_BY_ID.get(id) ?? null;
}

export { KNOWN_RECIPES };
