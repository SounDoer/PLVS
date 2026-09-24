import { normalizeThemeDocumentShape } from "./themeSchema.js";
import {
  isThemeValueOfKind,
  recipeContract,
  rgbaCssValue,
  THEME_RECIPES,
  THEME_VALUE_KINDS,
} from "./themeRecipes.js";
import { THEME_ROLE_REGISTRY, validateThemeRoleRegistry } from "./themeRoleRegistry.js";

export class ThemeCompilerError extends Error {
  constructor(issues) {
    super(issues.map(({ message }) => message).join("\n"));
    this.name = "ThemeCompilerError";
    this.code = "themeCompilerError";
    this.issues = issues;
  }
}

function compilerError(code, path, message) {
  return new ThemeCompilerError([{ code, path, message }]);
}

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

function cssValue(value, valueKind) {
  if (valueKind === THEME_VALUE_KINDS.SOLID_COLOR) return value;
  if (valueKind === THEME_VALUE_KINDS.COLOR_EFFECT) return rgbaCssValue(value);
  throw new Error("A palette cannot be published as one CSS color.");
}

function resolveOverride(entry, override, roles, automaticValue) {
  if (!override) return undefined;
  if (!entry.advanced) {
    throw compilerError(
      "overrideNotAllowed",
      `$.overrides.${entry.id}`,
      `Role ${entry.id} does not support Advanced overrides.`
    );
  }
  if (!entry.advanced.allowedModes.includes(override.kind)) {
    throw compilerError(
      "overrideNotAllowed",
      `$.overrides.${entry.id}.kind`,
      `Override mode ${override.kind} is not allowed for ${entry.id}.`
    );
  }
  if (override.kind === "color") {
    if (entry.valueKind === THEME_VALUE_KINDS.COLOR_EFFECT) {
      return { ...automaticValue, color: override.value };
    }
    return override.value;
  }
  if (override.kind === "effect") return { color: override.color, opacity: override.opacity };
  if (!entry.advanced.references.includes(override.source)) {
    throw compilerError(
      "incompatibleReference",
      `$.overrides.${entry.id}.source`,
      `Reference ${override.source} is not compatible with ${entry.id}.`
    );
  }
  return structuredClone(roles[override.source]);
}

/** Purely compile one current, normalized Theme authoring document into runtime output. */
export function compileTheme(rawTheme, options = {}) {
  const theme = normalizeThemeDocumentShape(rawTheme);
  if (!theme) {
    throw compilerError("invalidDocument", "$", "Invalid current Theme authoring document.");
  }
  const registry = options.registry ?? THEME_ROLE_REGISTRY;
  const registryErrors = validateThemeRoleRegistry(registry);
  if (registryErrors.length) {
    throw new ThemeCompilerError(
      registryErrors.map((message) => ({ code: "invalidRegistry", path: "$.registry", message }))
    );
  }
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
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
      const dependencies = entry.dependencies.map((dependency) => roles[dependency]);
      const recipe = THEME_RECIPES[entry.recipe];
      if (!recipe) {
        throw compilerError(
          "unknownRecipe",
          `$.registry.${id}.recipe`,
          `Unknown recipe for ${id}: ${entry.recipe}.`
        );
      }
      const contract = recipeContract(entry.recipe, entry.valueKind);
      if (contract.outputKind !== entry.valueKind) {
        throw compilerError(
          "recipeOutputKind",
          `$.registry.${id}.valueKind`,
          `Recipe ${entry.recipe} outputs ${contract.outputKind}, not ${entry.valueKind}, for ${id}.`
        );
      }
      const actualInputKinds = entry.dependencies.map(
        (dependency) => registryById.get(dependency)?.valueKind
      );
      if (
        !contract.inputKinds.some(
          (signature) =>
            signature.length === actualInputKinds.length &&
            signature.every((kind, index) => kind === actualInputKinds[index])
        )
      ) {
        throw compilerError(
          "recipeInputKinds",
          `$.registry.${id}.dependencies`,
          `Recipe input kinds do not match for ${id}.`
        );
      }
      const automatic = authored ?? recipe.resolve(dependencies, context);
      const overridden = resolveOverride(entry, override, roles, automatic);
      const resolved = overridden ?? automatic;
      if (!isThemeValueOfKind(resolved, entry.valueKind)) {
        throw compilerError(
          "resolvedValueKind",
          `$.roles.${id}`,
          `Role ${id} did not resolve to ${entry.valueKind}.`
        );
      }
      roles[id] = structuredClone(resolved);
      pending.delete(id);
      progressed = true;
    }
    if (!progressed) {
      throw compilerError(
        "unresolvableRoles",
        "$.roles",
        `Unresolvable theme roles: ${[...pending.keys()].join(", ")}.`
      );
    }
  }

  for (const roleId of Object.keys(theme.overrides)) {
    if (!roles[roleId]) {
      throw compilerError(
        "unknownRole",
        `$.overrides.${roleId}`,
        `Unknown override role: ${roleId}.`
      );
    }
  }

  const css = {};
  const canvas = {};
  const native = { colorScheme: theme.colorScheme };
  for (const entry of registry) {
    const value = roles[entry.id];
    for (const binding of entry.bindings.css ?? []) css[binding] = cssValue(value, entry.valueKind);
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

export { THEME_RECIPES as RECIPES };
