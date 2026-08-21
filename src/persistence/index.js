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
export const themesStore = createDomainStore({ name: "plvs:themes", backend });

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
