import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { planEditorDraftPatch } from "../src/agentControl/editorDraftControl.js";
import { BUILTIN_THEMES_V2 } from "../src/theme/builtinThemesV2.js";
import {
  portableToStoredTheme,
  themeToPortable,
  validatePortableTheme,
} from "../src/theme/portableTheme.js";

const TOP_LEVEL_FIELDS = new Set(["version", "base", "variants"]);
const VARIANT_FIELDS = new Set(["id", "name", "colorScheme", "core", "palettes"]);
const PALETTE_FIELDS = new Set(["status", "intensity", "frequency", "interface"]);
const SIMPLE_PALETTE_KEYS = Object.freeze({
  status: new Set(["safe", "warning", "critical"]),
  frequency: new Set(["low", "mid", "high"]),
  interface: new Set(["success", "warning", "danger"]),
});
const CORE_KEYS = new Set([
  "workspace",
  "surface",
  "text",
  "interfaceAccent",
  "primaryData",
  "secondaryData",
]);

const plain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

function unknownFields(value, allowed, path, issues) {
  if (!plain(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${path}.${key} is not supported.`);
  }
}

function addPaletteOperations(palettes, operations, path, issues) {
  if (palettes === undefined) return;
  if (!plain(palettes)) {
    issues.push(`${path} must be an object.`);
    return;
  }
  unknownFields(palettes, PALETTE_FIELDS, path, issues);
  for (const palette of ["status", "frequency", "interface"]) {
    const value = palettes[palette];
    if (value === undefined) continue;
    if (!plain(value)) {
      issues.push(`${path}.${palette} must be an object.`);
      continue;
    }
    const keys = SIMPLE_PALETTE_KEYS[palette];
    unknownFields(value, new Set(["presetId", ...keys]), `${path}.${palette}`, issues);
    const literalKeys = [...keys].filter((key) => Object.hasOwn(value, key));
    if (value.presetId !== undefined && literalKeys.length > 0) {
      issues.push(`${path}.${palette} cannot combine presetId with literal colors.`);
      continue;
    }
    if (value.presetId !== undefined) {
      operations.push({ op: "applyPalettePreset", palette, presetId: value.presetId });
      continue;
    }
    for (const key of literalKeys) {
      operations.push({ op: "setPaletteColor", palette, key, color: value[key] });
    }
  }

  const intensity = palettes.intensity;
  if (intensity === undefined) return;
  if (!plain(intensity)) {
    issues.push(`${path}.intensity must be an object.`);
    return;
  }
  unknownFields(intensity, new Set(["presetId", "stops"]), `${path}.intensity`, issues);
  if (intensity.presetId !== undefined && intensity.stops !== undefined) {
    issues.push(`${path}.intensity cannot combine presetId with stops.`);
  } else if (intensity.presetId !== undefined) {
    operations.push({
      op: "applyPalettePreset",
      palette: "intensity",
      presetId: intensity.presetId,
    });
  } else if (intensity.stops !== undefined) {
    operations.push({ op: "setIntensityStops", stops: intensity.stops });
  }
}

function variantOperations(variant, index) {
  const path = `$.variants[${index}]`;
  const issues = [];
  if (!plain(variant)) return { operations: [], issues: [`${path} must be an object.`] };
  unknownFields(variant, VARIANT_FIELDS, path, issues);
  if (typeof variant.id !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(variant.id)) {
    issues.push(`${path}.id must be a lowercase filename-safe identifier.`);
  }
  const operations = [{ op: "setName", name: variant.name ?? variant.id }];
  if (variant.name !== undefined && typeof variant.name !== "string") {
    issues.push(`${path}.name must be a string.`);
  }
  if (variant.colorScheme !== undefined) {
    operations.push({ op: "setColorScheme", colorScheme: variant.colorScheme });
  }
  if (variant.core !== undefined) {
    if (!plain(variant.core)) {
      issues.push(`${path}.core must be an object.`);
    } else {
      unknownFields(variant.core, CORE_KEYS, `${path}.core`, issues);
      for (const key of CORE_KEYS) {
        if (Object.hasOwn(variant.core, key)) {
          operations.push({ op: "setCoreColor", key, color: variant.core[key] });
        }
      }
    }
  }
  addPaletteOperations(variant.palettes, operations, `${path}.palettes`, issues);
  return { operations, issues };
}

async function readBase(base, manifestPath) {
  if (typeof base === "string") {
    const builtin = BUILTIN_THEMES_V2[base];
    if (!builtin) throw new Error(`Unknown built-in base Theme: ${base}.`);
    return structuredClone(builtin);
  }
  if (!plain(base) || typeof base.file !== "string" || Object.keys(base).length !== 1) {
    throw new Error('$.base must be "plvs-dark", "plvs-light", or { "file": "..." }.');
  }
  const path = resolve(dirname(manifestPath), base.file);
  const portable = validatePortableTheme(JSON.parse(await readFile(path, "utf8")));
  return portableToStoredTheme(portable, "custom-theme-lab-base");
}

export async function buildThemeLabVariants(raw, manifestPath) {
  const issues = [];
  if (!plain(raw)) throw new Error("The Theme Lab manifest must be an object.");
  unknownFields(raw, TOP_LEVEL_FIELDS, "$", issues);
  if (raw.version !== 1) issues.push("$.version must be 1.");
  if (!Array.isArray(raw.variants) || raw.variants.length === 0) {
    issues.push("$.variants must be a non-empty array.");
  }
  const ids = new Set();
  const planned = Array.isArray(raw.variants)
    ? raw.variants.map((variant, index) => {
        const result = variantOperations(variant, index);
        if (typeof variant?.id === "string") {
          if (ids.has(variant.id)) result.issues.push(`$.variants[${index}].id is duplicated.`);
          ids.add(variant.id);
        }
        issues.push(...result.issues);
        return { variant, operations: result.operations };
      })
    : [];
  if (issues.length > 0) throw new Error(`Invalid Theme Lab manifest:\n- ${issues.join("\n- ")}`);

  const base = await readBase(raw.base, manifestPath);
  return planned.map(({ variant, operations }, index) => {
    const current = { ...structuredClone(base), id: `custom-theme-lab-${variant.id}` };
    const result = planEditorDraftPatch("theme", current, { operations });
    if (result.issues.length > 0) {
      const details = result.issues.map(({ path, message }) => `${path}: ${message}`).join("\n- ");
      throw new Error(`Variant ${variant.id} is invalid:\n- ${details}`);
    }
    return {
      id: variant.id,
      name: result.document.name,
      index,
      document: result.document,
      portable: themeToPortable(result.document),
    };
  });
}
