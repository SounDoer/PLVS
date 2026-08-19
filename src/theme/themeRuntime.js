import { BUILTIN_THEMES_V2 } from "./builtinThemesV2.js";
import { compileTheme } from "./compileTheme.js";
import { normalizeThemeDocument } from "./migrations/migrateV1Theme.js";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function applyResolvedThemeToDocument(resolved, target = globalThis.document) {
  if (!target?.documentElement) return;
  const root = target.documentElement;
  root.dataset.theme = resolved.id;
  root.dataset.themeRevision = String(resolved.revision);
  root.style.setProperty("color-scheme", resolved.colorScheme);
  for (const [name, value] of Object.entries(resolved.css)) root.style.setProperty(name, value);
}

export function createThemePublication(resolved) {
  if (!resolved) return null;
  return {
    id: resolved.id,
    revision: resolved.revision,
    colorScheme: resolved.colorScheme,
    css: { ...resolved.css },
  };
}

export function isThemePublication(value) {
  return (
    value &&
    typeof value.id === "string" &&
    Number.isSafeInteger(value.revision) &&
    value.revision >= 0 &&
    (value.colorScheme === "dark" || value.colorScheme === "light") &&
    value.css &&
    typeof value.css === "object"
  );
}

export function createThemeRuntime({ apply = applyResolvedThemeToDocument } = {}) {
  let revision = 0;
  let current = null;
  const subscriptions = new Set();

  function notify(next, previous) {
    for (const subscription of subscriptions) {
      const value = subscription.select(next);
      const previousValue = previous ? subscription.select(previous) : undefined;
      if (!subscription.equal(value, previousValue)) subscription.listener(value, next);
    }
  }

  function publishAuthoring(rawTheme) {
    const authoring = normalizeThemeDocument(rawTheme);
    if (!authoring) throw new Error("Cannot publish an invalid theme document.");
    const previous = current;
    revision += 1;
    current = deepFreeze(compileTheme(authoring, { revision }));
    apply(current);
    notify(current, previous);
    return current;
  }

  function publishSelection(id, customThemes = {}) {
    let authoring = BUILTIN_THEMES_V2[id];
    if (!authoring && typeof id === "string" && customThemes[id]) {
      authoring = normalizeThemeDocument(customThemes[id]);
    }
    return publishAuthoring(authoring ?? BUILTIN_THEMES_V2["plvs-dark"]);
  }

  function subscribe(select, listener, equal = Object.is) {
    const subscription = { select, listener, equal };
    subscriptions.add(subscription);
    return () => subscriptions.delete(subscription);
  }

  return {
    publishAuthoring,
    publishSelection,
    getSnapshot: () => current,
    subscribe,
  };
}

export const themeRuntime = createThemeRuntime();
export const selectColorScheme = (resolved) => resolved?.colorScheme ?? null;
