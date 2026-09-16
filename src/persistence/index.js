// src/persistence/index.js
/**
 * The single persistence "manager" entry point: the settings, workspace, presets and
 * themes domains over one backend, plus manager-level flush, export and reset.
 *
 * The desktop app uses the plugin-store backend (plvs-settings.json); a browser build
 * falls back to localStorage. Consumers and the domain stores see the same seam either
 * way. Each domain resolves its version lazily and may migrate on read.
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

/** Force every coalesced domain update into the selected backend, then wait for durable settling. */
export async function flushPersistence() {
  settingsStore.flush();
  workspaceStore.flush();
  presetsStore.flush();
  themesStore.flush();
  await backend.flush();
}

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
