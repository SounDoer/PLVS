// src/persistence/index.js
/**
 * The single persistence "manager" entry point: two stable, versionless domains
 * over one backend, plus manager-level export/reset.
 *
 * Backend is localStorage today (dev + production). Plan 3 swaps in a
 * plugin-store backend for production behind this same seam — consumers and the
 * domain stores do not change.
 */
import { createLocalStorageBackend } from "./localStorageBackend.js";
import { createPluginStoreBackend } from "./pluginStoreBackend.js";
import { createDomainStore } from "./createDomainStore.js";
import { isTauri } from "../ipc/env.js";
import { normalizeThemeDocument } from "../theme/migrations/migrateV1Theme.js";

const backend = isTauri() ? createPluginStoreBackend() : createLocalStorageBackend();

function migrateWorkspace(raw) {
  const { customPresets: _customPresets, activePresetId: _activePresetId, ...rest } = raw;
  return rest;
}

export const settingsStore = createDomainStore({ name: "plvs:settings", backend });
export const workspaceStore = createDomainStore({
  name: "plvs:workspace",
  backend,
  migrate: migrateWorkspace,
});
export const presetsStore = createDomainStore({
  name: "plvs:presets",
  backend,
  notifySameContext: true,
});
function migrateThemes(raw) {
  const source = raw && typeof raw.themes === "object" && raw.themes ? raw.themes : {};
  const themes = {};
  for (const [id, theme] of Object.entries(source)) {
    const normalized = normalizeThemeDocument(theme);
    if (normalized && normalized.id === id) themes[id] = normalized;
  }
  const seen = new Set();
  const order = [];
  for (const id of Array.isArray(raw.order) ? raw.order : []) {
    if (themes[id] && !seen.has(id)) {
      order.push(id);
      seen.add(id);
    }
  }
  for (const id of Object.keys(themes)) {
    if (!seen.has(id)) order.push(id);
  }
  return { themes, order };
}

export const themesStore = createDomainStore({
  name: "plvs:themes",
  backend,
  migrate: migrateThemes,
});

/** Whole-app snapshot of every persisted domain (foundation for problem #5). */
export function exportAll() {
  return {
    settings: settingsStore.export(),
    workspace: workspaceStore.export(),
    presets: presetsStore.export(),
    themes: themesStore.export(),
  };
}

/** Wipe every persisted domain (foundation for problem #5). */
export function resetAll() {
  settingsStore.reset();
  workspaceStore.reset();
  presetsStore.reset();
  themesStore.reset();
}
