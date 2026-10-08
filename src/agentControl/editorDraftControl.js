import {
  CORE_COLOR_KEYS,
  FREQUENCY_COLOR_KEYS,
  INTERFACE_COLOR_KEYS,
  STATUS_COLOR_KEYS,
} from "../theme/themeSchema.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { applyPalettePreset, PALETTE_KINDS, listPalettePresets } from "../theme/palettePresets.js";
import { THEME_ROLE_REGISTRY } from "../theme/themeRoleRegistry.js";
import { ThemeDocumentError, validateThemeDocument } from "../theme/themeLibrary.js";
import { RULEABLE_METRIC_IDS } from "../lib/loudnessProfileCatalog.js";
import {
  LoudnessProfileDocumentError,
  validateLoudnessProfileDocument,
} from "../lib/loudnessProfileLibrary.js";
import { STATS_META, roundToStatPrecision, statDecimals } from "../lib/statsCatalog.js";

const THEME_OPERATIONS = Object.freeze([
  "setName",
  "setColorScheme",
  "setCoreColor",
  "resetCore",
  "setPaletteColor",
  "setIntensityStops",
  "applyPalettePreset",
  "setOverrideColor",
  "setOverrideReference",
  "clearOverride",
  "clearOverrides",
]);
const PROFILE_OPERATIONS = Object.freeze([
  "setName",
  "setReferenceLufs",
  "addRule",
  "updateRule",
  "removeRule",
  "reorderRules",
]);
const MAX_PATCH_OPERATIONS = 64;
const SIMPLE_PALETTE_KEYS = Object.freeze({
  status: STATUS_COLOR_KEYS,
  frequency: FREQUENCY_COLOR_KEYS,
  interface: INTERFACE_COLOR_KEYS,
});

const issue = (code, path, message) => ({ code, path, message });
const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

function unknownFields(value, allowed, path, issues) {
  if (!plainObject(value)) return;
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      issues.push(issue("unknownField", `${path}.${field}`, `Unknown field: ${field}.`));
    }
  }
}

function visibleOverrideRoles() {
  return THEME_ROLE_REGISTRY.filter(
    (role) => role.advanced && role.advanced.editorVisible !== false
  );
}

const operationSchema = (op, fields) => ({
  required: ["op", ...Object.keys(fields)],
  properties: { op: { const: op }, ...fields },
  additionalProperties: false,
});

function themeOperationSchemas() {
  const overrideRoleIds = visibleOverrideRoles().map(({ id }) => id);
  return {
    setName: operationSchema("setName", { name: { type: "string" } }),
    setColorScheme: operationSchema("setColorScheme", {
      colorScheme: { enum: ["dark", "light"] },
    }),
    setCoreColor: operationSchema("setCoreColor", {
      key: { enum: CORE_COLOR_KEYS },
      color: { type: "cssColor" },
    }),
    resetCore: operationSchema("resetCore", {}),
    setPaletteColor: operationSchema("setPaletteColor", {
      palette: { enum: ["status", "frequency", "interface"] },
      key: { enum: [...STATUS_COLOR_KEYS, ...FREQUENCY_COLOR_KEYS, ...INTERFACE_COLOR_KEYS] },
      color: { type: "cssColor" },
    }),
    setIntensityStops: operationSchema("setIntensityStops", {
      stops: { type: "array", items: { position: "number", color: "cssColor" } },
    }),
    applyPalettePreset: operationSchema("applyPalettePreset", {
      palette: { enum: PALETTE_KINDS },
      presetId: { type: "string" },
    }),
    setOverrideColor: operationSchema("setOverrideColor", {
      roleId: { enum: overrideRoleIds },
      color: { type: "cssColor" },
    }),
    setOverrideReference: operationSchema("setOverrideReference", {
      roleId: { enum: overrideRoleIds },
      sourceRoleId: { type: "string" },
    }),
    clearOverride: operationSchema("clearOverride", { roleId: { enum: overrideRoleIds } }),
    clearOverrides: operationSchema("clearOverrides", {
      roleIds: { type: "array", items: { enum: overrideRoleIds } },
    }),
  };
}

function profileOperationSchemas() {
  const rule = {
    metricId: { enum: RULEABLE_METRIC_IDS },
    op: { enum: [">", "<"] },
    value: { type: "number", optional: true },
    severity: { enum: ["warn", "fail"] },
  };
  return {
    setName: operationSchema("setName", { name: { type: "string" } }),
    setReferenceLufs: operationSchema("setReferenceLufs", {
      value: { type: ["number", "null"], minimum: -70, maximum: 0 },
    }),
    addRule: operationSchema("addRule", { rule: { properties: rule } }),
    updateRule: operationSchema("updateRule", {
      index: { type: "integer", minimum: 0 },
      patch: { properties: rule, allOptional: true },
    }),
    removeRule: operationSchema("removeRule", { index: { type: "integer", minimum: 0 } }),
    reorderRules: operationSchema("reorderRules", {
      order: { type: "array", items: { type: "integer", minimum: 0 } },
    }),
  };
}

function conflictingTarget(claimed, target) {
  const wildcard = target.endsWith(":*");
  const prefix = wildcard ? target.slice(0, -1) : null;
  return [...claimed].find(
    (existing) =>
      existing === target ||
      (wildcard && existing.startsWith(prefix)) ||
      (existing.endsWith(":*") && target.startsWith(existing.slice(0, -1)))
  );
}

function operationTargets(kind, operation) {
  if (kind === "theme") {
    switch (operation.op) {
      case "setName":
      case "setColorScheme":
        return [operation.op];
      case "setCoreColor":
        return [`core:${operation.key}`];
      case "resetCore":
        return ["core:*"];
      case "setPaletteColor":
        return [`palette:${operation.palette}:${operation.key}`];
      case "setIntensityStops":
        return ["palette:intensity:*"];
      case "applyPalettePreset":
        return [`palette:${operation.palette}:*`];
      case "setOverrideColor":
      case "setOverrideReference":
      case "clearOverride":
        return [`override:${operation.roleId}`];
      case "clearOverrides":
        return Array.isArray(operation.roleIds)
          ? operation.roleIds.map((roleId) => `override:${roleId}`)
          : [];
      default:
        return [];
    }
  }
  if (kind === "loudnessProfile") {
    switch (operation.op) {
      case "setName":
      case "setReferenceLufs":
        return [operation.op];
      case "updateRule":
      case "removeRule":
        return [`rule:${operation.index}`];
      case "reorderRules":
        return ["ruleOrder"];
      default:
        return [];
    }
  }
  return [];
}

function detectOperationConflicts(kind, operations, issues) {
  const claimed = new Set();
  operations.forEach((operation, index) => {
    if (!plainObject(operation)) return;
    for (const target of operationTargets(kind, operation)) {
      const existing = conflictingTarget(claimed, target);
      if (existing) {
        issues.push(
          issue(
            "conflictingOperation",
            `$.operations[${index}]`,
            `Operation conflicts with an earlier operation targeting ${existing}.`
          )
        );
      } else {
        claimed.add(target);
      }
    }
  });
}

export function describeEditorDraft(kind) {
  if (kind === "theme") {
    return {
      kind,
      history: { undo: true, redo: true },
      operations: THEME_OPERATIONS,
      operationSchemas: themeOperationSchemas(),
      maximumOperations: MAX_PATCH_OPERATIONS,
      coreKeys: CORE_COLOR_KEYS,
      palettes: PALETTE_KINDS.map((palette) => ({
        id: palette,
        presets: listPalettePresets(palette).map(({ id, label }) => ({ id, label })),
      })),
      overrideRoles: visibleOverrideRoles().map((role) => ({
        id: role.id,
        label: role.advanced.label,
        modes: role.advanced.allowedModes,
        references: role.advanced.references,
      })),
    };
  }
  if (kind === "loudnessProfile") {
    return {
      kind,
      history: { undo: false, redo: false },
      operations: PROFILE_OPERATIONS,
      operationSchemas: profileOperationSchemas(),
      maximumOperations: MAX_PATCH_OPERATIONS,
      referenceLufs: { minimum: -70, maximum: 0, nullable: true },
      operators: [">", "<"],
      severities: ["warn", "fail"],
      metrics: RULEABLE_METRIC_IDS.map((id) => ({
        id,
        label: STATS_META[id].label,
        unit: STATS_META[id].unit,
        decimals: statDecimals(id),
      })),
    };
  }
  return null;
}

function applyThemeOperation(document, operation, index, issues) {
  const path = `$.operations[${index}]`;
  const role = operation.roleId
    ? visibleOverrideRoles().find(({ id }) => id === operation.roleId)
    : null;
  switch (operation.op) {
    case "setName":
      unknownFields(operation, new Set(["op", "name"]), path, issues);
      return { ...document, name: operation.name };
    case "setColorScheme":
      unknownFields(operation, new Set(["op", "colorScheme"]), path, issues);
      return { ...document, colorScheme: operation.colorScheme };
    case "setCoreColor":
      unknownFields(operation, new Set(["op", "key", "color"]), path, issues);
      if (!CORE_COLOR_KEYS.includes(operation.key)) {
        issues.push(issue("invalidCoreKey", `${path}.key`, "Unknown Theme Core color."));
        return document;
      }
      return { ...document, core: { ...document.core, [operation.key]: operation.color } };
    case "resetCore":
      unknownFields(operation, new Set(["op"]), path, issues);
      if (document.colorScheme !== "dark" && document.colorScheme !== "light") return document;
      return {
        ...document,
        core: structuredClone(BUILTIN_THEMES_V2[`plvs-${document.colorScheme}`].core),
      };
    case "setPaletteColor": {
      unknownFields(operation, new Set(["op", "palette", "key", "color"]), path, issues);
      const keys = SIMPLE_PALETTE_KEYS[operation.palette];
      if (!keys?.includes(operation.key)) {
        issues.push(issue("invalidPaletteKey", `${path}.key`, "Unknown Theme palette color."));
        return document;
      }
      return {
        ...document,
        palettes: {
          ...document.palettes,
          [operation.palette]: {
            ...document.palettes[operation.palette],
            presetId: null,
            [operation.key]: operation.color,
          },
        },
      };
    }
    case "setIntensityStops":
      unknownFields(operation, new Set(["op", "stops"]), path, issues);
      return {
        ...document,
        palettes: {
          ...document.palettes,
          intensity: { presetId: null, stops: structuredClone(operation.stops) },
        },
      };
    case "applyPalettePreset": {
      unknownFields(operation, new Set(["op", "palette", "presetId"]), path, issues);
      const palette = applyPalettePreset(operation.palette, operation.presetId);
      if (!palette) {
        issues.push(issue("invalidPalettePreset", `${path}.presetId`, "Unknown palette preset."));
        return document;
      }
      return {
        ...document,
        palettes: { ...document.palettes, [operation.palette]: palette },
      };
    }
    case "setOverrideColor":
      unknownFields(operation, new Set(["op", "roleId", "color"]), path, issues);
      if (!role?.advanced.allowedModes.includes("color")) {
        issues.push(issue("invalidOverrideRole", `${path}.roleId`, "Role is not color-editable."));
        return document;
      }
      return {
        ...document,
        overrides: {
          ...document.overrides,
          [operation.roleId]: { kind: "color", value: operation.color },
        },
      };
    case "setOverrideReference":
      unknownFields(operation, new Set(["op", "roleId", "sourceRoleId"]), path, issues);
      if (!role?.advanced.allowedModes.includes("reference")) {
        issues.push(
          issue("invalidOverrideRole", `${path}.roleId`, "Role is not reference-editable.")
        );
        return document;
      }
      if (!role.advanced.references.includes(operation.sourceRoleId)) {
        issues.push(
          issue("invalidOverrideReference", `${path}.sourceRoleId`, "Reference is not allowed.")
        );
        return document;
      }
      return {
        ...document,
        overrides: {
          ...document.overrides,
          [operation.roleId]: { kind: "reference", source: operation.sourceRoleId },
        },
      };
    case "clearOverride": {
      unknownFields(operation, new Set(["op", "roleId"]), path, issues);
      if (!role) {
        issues.push(issue("invalidOverrideRole", `${path}.roleId`, "Unknown editable Theme role."));
        return document;
      }
      const overrides = { ...document.overrides };
      delete overrides[operation.roleId];
      return { ...document, overrides };
    }
    case "clearOverrides": {
      unknownFields(operation, new Set(["op", "roleIds"]), path, issues);
      if (!Array.isArray(operation.roleIds)) {
        issues.push(issue("invalidRoleIds", `${path}.roleIds`, "roleIds must be an array."));
        return document;
      }
      const known = new Set(visibleOverrideRoles().map(({ id }) => id));
      const unknown = operation.roleIds.find((id) => !known.has(id));
      if (unknown) {
        issues.push(
          issue("invalidOverrideRole", `${path}.roleIds`, `Unknown editable role: ${unknown}.`)
        );
        return document;
      }
      const overrides = { ...document.overrides };
      for (const roleId of operation.roleIds) delete overrides[roleId];
      return { ...document, overrides };
    }
    default:
      issues.push(issue("unknownOperation", `${path}.op`, `Unknown Theme draft operation.`));
      return document;
  }
}

function applyProfileOperation(document, operation, index, issues) {
  const path = `$.operations[${index}]`;
  switch (operation.op) {
    case "setName":
      unknownFields(operation, new Set(["op", "name"]), path, issues);
      return { ...document, name: operation.name };
    case "setReferenceLufs":
      unknownFields(operation, new Set(["op", "value"]), path, issues);
      return { ...document, referenceLufs: operation.value };
    case "addRule":
      unknownFields(operation, new Set(["op", "rule"]), path, issues);
      return {
        ...document,
        rules: [
          ...document.rules,
          Object.hasOwn(operation.rule ?? {}, "value") && Number.isFinite(operation.rule.value)
            ? {
                ...structuredClone(operation.rule),
                value: roundToStatPrecision(operation.rule.metricId, operation.rule.value),
              }
            : structuredClone(operation.rule),
        ],
      };
    case "updateRule": {
      unknownFields(operation, new Set(["op", "index", "patch"]), path, issues);
      if (!Number.isInteger(operation.index) || !document.rules[operation.index]) {
        issues.push(issue("ruleNotFound", `${path}.index`, "Rule index does not exist."));
        return document;
      }
      if (!plainObject(operation.patch)) {
        issues.push(issue("invalidRulePatch", `${path}.patch`, "patch must be an object."));
        return document;
      }
      unknownFields(
        operation.patch,
        new Set(["metricId", "op", "value", "severity"]),
        `${path}.patch`,
        issues
      );
      const rules = document.rules.map((rule, ruleIndex) => {
        if (ruleIndex !== operation.index) return rule;
        const next = { ...rule, ...operation.patch };
        if (
          operation.patch.metricId !== undefined &&
          operation.patch.metricId !== rule.metricId &&
          !Object.hasOwn(operation.patch, "value")
        ) {
          delete next.value;
        }
        if (Object.hasOwn(operation.patch, "value") && operation.patch.value === null) {
          delete next.value;
        } else if (Number.isFinite(next.value)) {
          next.value = roundToStatPrecision(next.metricId, next.value);
        }
        return next;
      });
      return { ...document, rules };
    }
    case "removeRule":
      unknownFields(operation, new Set(["op", "index"]), path, issues);
      if (!Number.isInteger(operation.index) || !document.rules[operation.index]) {
        issues.push(issue("ruleNotFound", `${path}.index`, "Rule index does not exist."));
        return document;
      }
      return {
        ...document,
        rules: document.rules.filter((_, ruleIndex) => ruleIndex !== operation.index),
      };
    case "reorderRules": {
      unknownFields(operation, new Set(["op", "order"]), path, issues);
      const expected = document.rules.map((_, ruleIndex) => ruleIndex).sort((a, b) => a - b);
      const actual = Array.isArray(operation.order)
        ? [...operation.order].sort((a, b) => a - b)
        : [];
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        issues.push(
          issue("invalidPermutation", `${path}.order`, "order must contain every rule index once.")
        );
        return document;
      }
      return { ...document, rules: operation.order.map((ruleIndex) => document.rules[ruleIndex]) };
    }
    default:
      issues.push(issue("unknownOperation", `${path}.op`, `Unknown Profile draft operation.`));
      return document;
  }
}

export function planEditorDraftPatch(kind, currentDocument, input) {
  const issues = [];
  if (!plainObject(input)) {
    return {
      document: currentDocument,
      changed: false,
      issues: [issue("invalidPatch", "$", "The draft patch must be an object.")],
    };
  }
  unknownFields(input, new Set(["operations"]), "$", issues);
  if (!Array.isArray(input.operations) || input.operations.length === 0) {
    issues.push(
      issue("invalidOperations", "$.operations", "operations must be a non-empty array.")
    );
  } else if (input.operations.length > MAX_PATCH_OPERATIONS) {
    issues.push(
      issue(
        "tooManyOperations",
        "$.operations",
        `operations may contain at most ${MAX_PATCH_OPERATIONS} entries.`
      )
    );
  } else {
    detectOperationConflicts(kind, input.operations, issues);
  }
  if (issues.length > 0) return { document: currentDocument, changed: false, issues };

  let next = structuredClone(currentDocument);
  input.operations.forEach((operation, index) => {
    if (!plainObject(operation)) {
      issues.push(
        issue("invalidOperation", `$.operations[${index}]`, "Each operation must be an object.")
      );
      return;
    }
    next =
      kind === "theme"
        ? applyThemeOperation(next, operation, index, issues)
        : kind === "loudnessProfile"
          ? applyProfileOperation(next, operation, index, issues)
          : next;
  });
  if (kind !== "theme" && kind !== "loudnessProfile") {
    issues.push(issue("invalidEditorKind", "$.kind", "Unknown editor draft kind."));
  }
  if (issues.length > 0) return { document: currentDocument, changed: false, issues };

  try {
    const { id, ...authoring } = next;
    const validated =
      kind === "theme"
        ? validateThemeDocument(authoring)
        : validateLoudnessProfileDocument(authoring);
    next = { id, ...validated };
  } catch (error) {
    if (error instanceof ThemeDocumentError || error instanceof LoudnessProfileDocumentError) {
      return { document: currentDocument, changed: false, issues: error.issues };
    }
    throw error;
  }

  return {
    document: next,
    changed: JSON.stringify(next) !== JSON.stringify(currentDocument),
    issues: [],
  };
}
