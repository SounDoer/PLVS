import { BUILTIN_THEMES_V2, THEME_IDS } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { isCustomThemeId } from "./customTheme.js";
import { getPalettePreset } from "./palettePresets.js";
import { getThemeRole } from "./themeRoleRegistry.js";
import {
  CORE_COLOR_KEYS,
  FREQUENCY_COLOR_KEYS,
  INTERFACE_COLOR_KEYS,
  STATUS_COLOR_KEYS,
  THEME_DOCUMENT_VERSION,
  THEME_NAME_MAX_LENGTH,
  normalizeThemeId,
  normalizeThemeName,
  normalizeThemeV2,
} from "./themeSchema.js";
import { normalizeOpaqueColor } from "./themeColorMath.js";

const DOCUMENT_FIELDS = new Set([
  "version",
  "name",
  "colorScheme",
  "core",
  "palettes",
  "overrides",
]);
const PALETTE_FIELDS = new Set(["status", "intensity", "frequency", "interface"]);
const STOP_FIELDS = new Set(["position", "color"]);
const OVERRIDE_FIELDS = Object.freeze({
  color: new Set(["kind", "value"]),
  reference: new Set(["kind", "source"]),
  effect: new Set(["kind", "color", "opacity"]),
});

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(code, path, message) {
  return { code, path, message };
}

function unknownFields(raw, allowed, path, issues) {
  if (!isPlainObject(raw)) return;
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) {
      issues.push(issue("unknownField", `${path}.${field}`, `Unknown field: ${field}.`));
    }
  }
}

function requirePlainObject(raw, path, label, issues) {
  if (isPlainObject(raw)) return true;
  issues.push(issue("invalidObject", path, `${label} must be a plain object.`));
  return false;
}

function validateColor(raw, path, issues) {
  if (!normalizeOpaqueColor(raw)) {
    issues.push(issue("invalidColor", path, "The value must be an opaque CSS color."));
  }
}

function validateColorRecord(raw, path, keys, issues) {
  if (!requirePlainObject(raw, path, "The color group", issues)) return;
  unknownFields(raw, new Set(keys), path, issues);
  for (const key of keys) validateColor(raw[key], `${path}.${key}`, issues);
}

function validatePresetId(raw, kind, path, issues) {
  if (raw === null) return;
  if (typeof raw !== "string" || !getPalettePreset(kind, raw)) {
    issues.push(
      issue(
        "invalidPresetId",
        path,
        kind === "interface"
          ? "presetId must be null for the interface palette."
          : `presetId must be null or a registered ${kind} palette preset ID.`
      )
    );
  }
}

function validateSimplePalette(raw, kind, colorKeys, issues) {
  const path = `$.palettes.${kind}`;
  if (!requirePlainObject(raw, path, "The palette", issues)) return;
  unknownFields(raw, new Set(["presetId", ...colorKeys]), path, issues);
  validatePresetId(raw.presetId, kind, `${path}.presetId`, issues);
  for (const key of colorKeys) validateColor(raw[key], `${path}.${key}`, issues);
}

function validateIntensity(raw, issues) {
  const path = "$.palettes.intensity";
  if (!requirePlainObject(raw, path, "The intensity palette", issues)) return;
  unknownFields(raw, new Set(["presetId", "stops"]), path, issues);
  validatePresetId(raw.presetId, "intensity", `${path}.presetId`, issues);
  if (!Array.isArray(raw.stops) || raw.stops.length < 2) {
    issues.push(issue("invalidStops", `${path}.stops`, "stops must contain at least two entries."));
    return;
  }
  let previous = -1;
  raw.stops.forEach((stop, index) => {
    const stopPath = `${path}.stops[${index}]`;
    if (!requirePlainObject(stop, stopPath, "An intensity stop", issues)) return;
    unknownFields(stop, STOP_FIELDS, stopPath, issues);
    if (
      typeof stop.position !== "number" ||
      !Number.isFinite(stop.position) ||
      stop.position < 0 ||
      stop.position > 1
    ) {
      issues.push(
        issue("invalidPosition", `${stopPath}.position`, "position must be from 0 through 1.")
      );
    } else if (stop.position <= previous) {
      issues.push(
        issue(
          "unorderedStops",
          `${stopPath}.position`,
          "stop positions must be strictly increasing."
        )
      );
    }
    if (typeof stop.position === "number" && Number.isFinite(stop.position))
      previous = stop.position;
    validateColor(stop.color, `${stopPath}.color`, issues);
  });
  if (raw.stops[0]?.position !== 0) {
    issues.push(
      issue("invalidEndpoint", `${path}.stops[0].position`, "The first stop position must be 0.")
    );
  }
  if (raw.stops.at(-1)?.position !== 1) {
    issues.push(
      issue(
        "invalidEndpoint",
        `${path}.stops[${raw.stops.length - 1}].position`,
        "The last stop position must be 1."
      )
    );
  }
}

function validateOverrides(raw, issues) {
  const path = "$.overrides";
  if (!requirePlainObject(raw, path, "overrides", issues)) return;
  for (const [roleId, override] of Object.entries(raw)) {
    const overridePath = `${path}.${roleId}`;
    if (!normalizeThemeId(roleId)) {
      issues.push(
        issue("invalidRoleId", overridePath, "The override key must be a valid role ID.")
      );
    }
    if (!requirePlainObject(override, overridePath, "An override", issues)) continue;
    const allowedFields = OVERRIDE_FIELDS[override.kind];
    if (!allowedFields) {
      unknownFields(override, new Set(["kind"]), overridePath, issues);
      issues.push(
        issue(
          "invalidOverrideKind",
          `${overridePath}.kind`,
          "kind must be color, reference, or effect."
        )
      );
      continue;
    }
    unknownFields(override, allowedFields, overridePath, issues);
    const role = getThemeRole(roleId);
    if (!role) {
      issues.push(issue("unknownRole", overridePath, `Unknown Theme role: ${roleId}.`));
    } else if (!role.advanced || !role.advanced.allowedModes.includes(override.kind)) {
      issues.push(
        issue(
          "overrideNotAllowed",
          `${overridePath}.kind`,
          `Override kind ${override.kind} is not allowed for ${roleId}.`
        )
      );
    }
    if (override.kind === "color") validateColor(override.value, `${overridePath}.value`, issues);
    if (override.kind === "effect") {
      validateColor(override.color, `${overridePath}.color`, issues);
      if (
        typeof override.opacity !== "number" ||
        !Number.isFinite(override.opacity) ||
        override.opacity < 0 ||
        override.opacity > 1
      ) {
        issues.push(
          issue("invalidOpacity", `${overridePath}.opacity`, "opacity must be from 0 through 1.")
        );
      }
    }
    if (override.kind === "reference") {
      if (!normalizeThemeId(override.source)) {
        issues.push(
          issue("invalidReference", `${overridePath}.source`, "source must be a valid role ID.")
        );
      } else if (role && !role.advanced?.references.includes(override.source)) {
        issues.push(
          issue(
            "incompatibleReference",
            `${overridePath}.source`,
            `Reference ${override.source} is not compatible with ${roleId}.`
          )
        );
      }
    }
  }
}

export class ThemeDocumentError extends Error {
  constructor(issues) {
    super("The Theme document is invalid.");
    this.name = "ThemeDocumentError";
    this.code = "invalidTheme";
    this.issues = issues;
  }
}

/** Strictly validate and normalize a complete, id-free public Theme V2 authoring document. */
export function validateThemeDocument(raw) {
  if (!isPlainObject(raw)) {
    throw new ThemeDocumentError([
      issue("invalidDocument", "$", "A Theme document must be a plain object."),
    ]);
  }
  const issues = [];
  unknownFields(raw, DOCUMENT_FIELDS, "$", issues);
  if (raw.version !== THEME_DOCUMENT_VERSION) {
    issues.push(issue("invalidVersion", "$.version", `version must be ${THEME_DOCUMENT_VERSION}.`));
  }
  if (!normalizeThemeName(raw.name)) {
    issues.push(
      issue(
        "invalidName",
        "$.name",
        `name must contain text and be at most ${THEME_NAME_MAX_LENGTH} characters.`
      )
    );
  }
  if (raw.colorScheme !== "light" && raw.colorScheme !== "dark") {
    issues.push(
      issue("invalidColorScheme", "$.colorScheme", 'colorScheme must be "light" or "dark".')
    );
  }
  validateColorRecord(raw.core, "$.core", CORE_COLOR_KEYS, issues);
  if (requirePlainObject(raw.palettes, "$.palettes", "palettes", issues)) {
    unknownFields(raw.palettes, PALETTE_FIELDS, "$.palettes", issues);
    validateSimplePalette(raw.palettes.status, "status", STATUS_COLOR_KEYS, issues);
    validateIntensity(raw.palettes.intensity, issues);
    validateSimplePalette(raw.palettes.frequency, "frequency", FREQUENCY_COLOR_KEYS, issues);
    validateSimplePalette(raw.palettes.interface, "interface", INTERFACE_COLOR_KEYS, issues);
  }
  validateOverrides(raw.overrides, issues);
  if (issues.length > 0) throw new ThemeDocumentError(issues);

  const normalized = normalizeThemeV2({ ...raw, name: raw.name.trim(), id: "custom-authoring" });
  if (!normalized) {
    throw new ThemeDocumentError([
      issue("invalidTheme", "$", "The Theme document could not be normalized."),
    ]);
  }
  try {
    compileTheme(normalized);
  } catch (error) {
    throw new ThemeDocumentError([
      issue(
        "compilerIncompatible",
        "$",
        error instanceof Error ? error.message : "The Theme cannot be compiled."
      ),
    ]);
  }
  const { id: _id, ...document } = normalized;
  return document;
}

function invalid(state, issues) {
  return { state, changed: [], warnings: [], issues };
}

function customTheme(state, id) {
  return state.themes.find((theme) => theme.id === id) ?? null;
}

function anyTheme(state, id) {
  return BUILTIN_THEMES_V2[id] ?? customTheme(state, id);
}

function notFound(state, id) {
  return invalid(state, [issue("themeNotFound", "$.themeId", `Theme ${id} was not found.`)]);
}

function mutableTheme(state, id) {
  if (BUILTIN_THEMES_V2[id]) {
    return {
      error: invalid(state, [issue("themeNotMutable", "$.themeId", `Theme ${id} is built in.`)]),
    };
  }
  const theme = customTheme(state, id);
  return theme ? { theme } : { error: notFound(state, id) };
}

function appearance(mode, selectedThemeId, resolvedThemeId) {
  return { mode, selectedThemeId, resolvedThemeId };
}

function withAppearance(state, nextAppearance, changed) {
  if (JSON.stringify(state.appearance) === JSON.stringify(nextAppearance))
    return invalid(state, []);
  return {
    state: { ...state, appearance: nextAppearance },
    changed,
    warnings: [],
    issues: [],
    previousAppearance: state.appearance,
    appearance: nextAppearance,
  };
}

export function listThemeSummaries(state) {
  return [
    ...THEME_IDS.map((id) => ({
      id,
      name: BUILTIN_THEMES_V2[id].name,
      kind: "builtin",
      colorScheme: BUILTIN_THEMES_V2[id].colorScheme,
    })),
    ...state.themes.map(({ id, name, colorScheme }) => ({ id, name, kind: "custom", colorScheme })),
  ];
}

export function planThemeSelect(state, themeId) {
  if (!anyTheme(state, themeId)) return notFound(state, themeId);
  return withAppearance(state, appearance("fixed", themeId, themeId), ["themes.appearance"]);
}

export function planThemeFollowSystem(state, resolvedSystemThemeId) {
  const resolved = BUILTIN_THEMES_V2[resolvedSystemThemeId] ? resolvedSystemThemeId : "plvs-dark";
  return withAppearance(state, appearance("system", null, resolved), ["themes.appearance"]);
}

function validatedPlan(state, rawDocument, build) {
  try {
    return build(validateThemeDocument(rawDocument));
  } catch (error) {
    if (!(error instanceof ThemeDocumentError)) throw error;
    return invalid(state, error.issues);
  }
}

function generatedTheme(state, document, makeId) {
  const id = makeId();
  if (
    !isCustomThemeId(id) ||
    BUILTIN_THEMES_V2[id] ||
    state.themes.some((theme) => theme.id === id)
  ) {
    return {
      error: invalid(state, [
        issue("duplicateThemeId", "$.theme.id", "The generated Theme ID is not unique and custom."),
      ]),
    };
  }
  return { theme: { id, ...document } };
}

export function planThemeCreate(state, rawDocument, { makeId } = {}) {
  return validatedPlan(state, rawDocument, (document) => {
    if (typeof makeId !== "function") {
      return {
        ...invalid(state, []),
        changed: ["themes.library", "themes.appearance"],
        document,
        selectCreated: true,
      };
    }
    const generated = generatedTheme(state, document, makeId);
    if (generated.error) return generated.error;
    const theme = generated.theme;
    return {
      state: {
        ...state,
        themes: [...state.themes, theme],
        appearance: appearance("fixed", theme.id, theme.id),
      },
      changed: ["themes.library", "themes.appearance"],
      warnings: [],
      issues: [],
      document,
      theme,
      selectCreated: true,
    };
  });
}

export function planThemeUpdate(state, themeId, rawDocument) {
  const target = mutableTheme(state, themeId);
  if (target.error) return target.error;
  return validatedPlan(state, rawDocument, (document) => {
    const theme = { id: themeId, ...document };
    if (JSON.stringify(theme) === JSON.stringify(target.theme))
      return { ...invalid(state, []), theme };
    return {
      state: { ...state, themes: state.themes.map((item) => (item.id === themeId ? theme : item)) },
      changed: [`themes.${themeId}.document`],
      warnings: [],
      issues: [],
      theme,
    };
  });
}

export function planThemeRename(state, themeId, name) {
  const target = mutableTheme(state, themeId);
  if (target.error) return target.error;
  const normalized = normalizeThemeName(name);
  if (!normalized) {
    return invalid(state, [
      issue(
        "invalidName",
        "$.name",
        `name must contain text and be at most ${THEME_NAME_MAX_LENGTH} characters.`
      ),
    ]);
  }
  if (normalized === target.theme.name) return { ...invalid(state, []), theme: target.theme };
  const theme = { ...target.theme, name: normalized };
  return {
    state: { ...state, themes: state.themes.map((item) => (item.id === themeId ? theme : item)) },
    changed: [`themes.${themeId}.name`],
    warnings: [],
    issues: [],
    theme,
  };
}

export function planThemeDuplicate(state, themeId, name, { makeId } = {}) {
  const source = anyTheme(state, themeId);
  if (!source) return notFound(state, themeId);
  const normalizedName = normalizeThemeName(name);
  if (!normalizedName) {
    return invalid(state, [
      issue(
        "invalidName",
        "$.name",
        `name must contain text and be at most ${THEME_NAME_MAX_LENGTH} characters.`
      ),
    ]);
  }
  const { id: _id, ...sourceDocument } = source;
  const document = { ...structuredClone(sourceDocument), name: normalizedName };
  const sourceSummary = {
    id: source.id,
    name: source.name,
    kind: BUILTIN_THEMES_V2[source.id] ? "builtin" : "custom",
  };
  if (typeof makeId !== "function") {
    return {
      ...invalid(state, []),
      changed: ["themes.library", "themes.appearance"],
      source: sourceSummary,
      name: normalizedName,
      selectCreated: true,
    };
  }
  const generated = generatedTheme(state, document, makeId);
  if (generated.error) return generated.error;
  const theme = generated.theme;
  return {
    state: {
      ...state,
      themes: [...state.themes, theme],
      appearance: appearance("fixed", theme.id, theme.id),
    },
    changed: ["themes.library", "themes.appearance"],
    warnings: [],
    issues: [],
    source: sourceSummary,
    name: normalizedName,
    theme,
    selectCreated: true,
  };
}

export function planThemeDelete(state, themeId) {
  const target = mutableTheme(state, themeId);
  if (target.error) return target.error;
  const active = state.appearance.mode === "fixed" && state.appearance.selectedThemeId === themeId;
  const fallbackThemeId = active
    ? target.theme.colorScheme === "light"
      ? "plvs-light"
      : "plvs-dark"
    : null;
  return {
    state: {
      ...state,
      themes: state.themes.filter((theme) => theme.id !== themeId),
      appearance: fallbackThemeId
        ? appearance("fixed", fallbackThemeId, fallbackThemeId)
        : state.appearance,
    },
    changed: ["themes.library", ...(fallbackThemeId ? ["themes.appearance"] : [])],
    warnings: [],
    issues: [],
    deletedTheme: target.theme,
    fallbackThemeId,
  };
}

export function planThemeReorder(state, themeIds) {
  const currentIds = state.themes.map(({ id }) => id);
  const valid =
    Array.isArray(themeIds) &&
    themeIds.length === currentIds.length &&
    themeIds.every((id) => typeof id === "string") &&
    new Set(themeIds).size === themeIds.length &&
    themeIds.every((id) => currentIds.includes(id));
  if (!valid) {
    return invalid(state, [
      issue(
        "invalidPermutation",
        "$.themeIds",
        "themeIds must contain every current custom Theme ID exactly once."
      ),
    ]);
  }
  if (themeIds.every((id, index) => id === currentIds[index])) {
    return { ...invalid(state, []), themeIds: currentIds };
  }
  const byId = new Map(state.themes.map((theme) => [theme.id, theme]));
  return {
    state: { ...state, themes: themeIds.map((id) => byId.get(id)) },
    changed: ["themes.order"],
    warnings: [],
    issues: [],
    themeIds: [...themeIds],
  };
}
