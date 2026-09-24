import { normalizeThemeDocument } from "./migrations/migrateV1Theme.js";
import { validateThemeDocument, ThemeDocumentError } from "./themeLibrary.js";
import {
  CORE_COLOR_KEYS,
  FREQUENCY_COLOR_KEYS,
  INTERFACE_COLOR_KEYS,
  STATUS_COLOR_KEYS,
  THEME_FORMAT_VERSION,
  THEME_SEMANTICS_VERSION,
  normalizeThemeId,
} from "./themeSchema.js";

export const PORTABLE_THEME_KIND = "plvs-theme";
export const PORTABLE_THEME_FORMAT_VERSION = 1;
export const PORTABLE_THEME_SEMANTICS_VERSION = 1;

const PORTABLE_FIELDS = new Set([
  "kind",
  "formatVersion",
  "semanticsVersion",
  "name",
  "colorScheme",
  "core",
  "palettes",
  "overrides",
]);
const SIMPLE_PALETTE_FIELDS = Object.freeze({
  status: new Set(STATUS_COLOR_KEYS),
  frequency: new Set(FREQUENCY_COLOR_KEYS),
  interface: new Set(INTERFACE_COLOR_KEYS),
});

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function issue(code, path, message) {
  return { code, path, message };
}

function collectUnknownFields(raw, allowed, path, issues) {
  if (!isPlainObject(raw)) return;
  for (const field of Object.keys(raw)) {
    if (!allowed.has(field)) {
      issues.push(issue("unknownField", `${path}.${field}`, `Unknown field: ${field}.`));
    }
  }
}

function withoutPresetProvenance(raw, kind) {
  if (!isPlainObject(raw)) return raw;
  if (kind === "intensity") return { stops: raw.stops };
  return Object.fromEntries(
    Object.keys(raw)
      .filter((key) => key !== "presetId")
      .map((key) => [key, raw[key]])
  );
}

function asAuthoringDocument(raw) {
  const { kind: _kind, ...fields } = raw ?? {};
  return {
    ...fields,
    formatVersion: THEME_FORMAT_VERSION,
    semanticsVersion: THEME_SEMANTICS_VERSION,
    palettes: isPlainObject(raw?.palettes)
      ? {
          ...raw.palettes,
          status: {
            ...withoutPresetProvenance(raw.palettes.status, "status"),
            presetId: null,
          },
          intensity: {
            ...withoutPresetProvenance(raw.palettes.intensity, "intensity"),
            presetId: null,
          },
          frequency: {
            ...withoutPresetProvenance(raw.palettes.frequency, "frequency"),
            presetId: null,
          },
          interface: {
            ...withoutPresetProvenance(raw.palettes.interface, "interface"),
            presetId: null,
          },
        }
      : raw?.palettes,
  };
}

function portableFromAuthoring(document) {
  return {
    kind: PORTABLE_THEME_KIND,
    formatVersion: PORTABLE_THEME_FORMAT_VERSION,
    semanticsVersion: PORTABLE_THEME_SEMANTICS_VERSION,
    name: document.name,
    colorScheme: document.colorScheme,
    core: Object.fromEntries(CORE_COLOR_KEYS.map((key) => [key, document.core[key]])),
    palettes: {
      status: Object.fromEntries(
        STATUS_COLOR_KEYS.map((key) => [key, document.palettes.status[key]])
      ),
      intensity: {
        stops: document.palettes.intensity.stops.map(({ position, color }) => ({
          position,
          color,
        })),
      },
      frequency: Object.fromEntries(
        FREQUENCY_COLOR_KEYS.map((key) => [key, document.palettes.frequency[key]])
      ),
      interface: Object.fromEntries(
        INTERFACE_COLOR_KEYS.map((key) => [key, document.palettes.interface[key]])
      ),
    },
    overrides: Object.fromEntries(
      Object.keys(document.overrides)
        .sort()
        .map((roleId) => [roleId, { ...document.overrides[roleId] }])
    ),
  };
}

export class PortableThemeError extends Error {
  constructor(issues) {
    super("The portable Theme document is invalid.");
    this.name = "PortableThemeError";
    this.code = "invalidPortableTheme";
    this.issues = issues;
  }
}

/** Strictly validate and canonicalize a portable, id-free Theme document. */
export function validatePortableTheme(raw) {
  if (!isPlainObject(raw)) {
    throw new PortableThemeError([
      issue("invalidDocument", "$", "A portable Theme must be a plain object."),
    ]);
  }

  const issues = [];
  collectUnknownFields(raw, PORTABLE_FIELDS, "$", issues);
  if (raw.kind !== PORTABLE_THEME_KIND) {
    issues.push(
      issue("invalidKind", "$.kind", `kind must be ${JSON.stringify(PORTABLE_THEME_KIND)}.`)
    );
  }
  if (raw.formatVersion !== PORTABLE_THEME_FORMAT_VERSION) {
    issues.push(
      issue(
        "unsupportedFormatVersion",
        "$.formatVersion",
        `formatVersion must be ${PORTABLE_THEME_FORMAT_VERSION}.`
      )
    );
  }
  if (raw.semanticsVersion !== PORTABLE_THEME_SEMANTICS_VERSION) {
    issues.push(
      issue(
        "unsupportedSemanticsVersion",
        "$.semanticsVersion",
        `semanticsVersion must be ${PORTABLE_THEME_SEMANTICS_VERSION}.`
      )
    );
  }

  if (isPlainObject(raw.palettes)) {
    for (const [kind, allowed] of Object.entries(SIMPLE_PALETTE_FIELDS)) {
      collectUnknownFields(raw.palettes[kind], allowed, `$.palettes.${kind}`, issues);
    }
    collectUnknownFields(
      raw.palettes.intensity,
      new Set(["stops"]),
      "$.palettes.intensity",
      issues
    );
  }
  if (isPlainObject(raw.overrides)) {
    for (const [roleId, override] of Object.entries(raw.overrides)) {
      if (isPlainObject(override) && override.kind === "effect") {
        issues.push(
          issue(
            "unsupportedPortableOverride",
            `$.overrides.${roleId}.kind`,
            "Portable overrides support only color and reference intent."
          )
        );
      }
    }
  }

  let authoring;
  try {
    const candidate = asAuthoringDocument(raw);
    authoring = validateThemeDocument(candidate);
  } catch (error) {
    if (error instanceof ThemeDocumentError) issues.push(...error.issues);
    else throw error;
  }
  if (issues.length > 0) throw new PortableThemeError(issues);
  return portableFromAuthoring(authoring);
}

/** Convert any readable persisted Theme into its stable, provenance-free portable form. */
export function themeToPortable(raw) {
  const theme = normalizeThemeDocument(raw);
  if (!theme) {
    throw new PortableThemeError([
      issue("invalidTheme", "$", "The stored Theme cannot be read by this version of PLVS."),
    ]);
  }
  // Preset IDs are editor provenance, so even a stale/foreign preset ID must not prevent the
  // literal palette values from becoming portable content. The portable validator reconstructs
  // the authoring document with null provenance and still runs registry/compiler validation.
  return validatePortableTheme(portableFromAuthoring(theme));
}

/** Convert a portable Theme into the current persisted shape using a caller-owned local ID. */
export function portableToStoredTheme(raw, id) {
  const normalizedId = normalizeThemeId(id);
  if (!normalizedId) {
    throw new PortableThemeError([
      issue("invalidThemeId", "$.id", "The destination Theme ID is invalid."),
    ]);
  }
  const portable = validatePortableTheme(raw);
  const authoring = validateThemeDocument(asAuthoringDocument(portable));
  return { id: normalizedId, ...authoring };
}

/** Canonical UTF-8 JSON input used for portable Theme identity. */
export function serializePortableTheme(raw) {
  return JSON.stringify(validatePortableTheme(raw));
}

/** A reproducible content identity that deliberately excludes local IDs and preset provenance. */
export async function hashPortableTheme(raw) {
  const bytes = new TextEncoder().encode(serializePortableTheme(raw));
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `sha256:${hex}`;
}
