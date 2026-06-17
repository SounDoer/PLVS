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

export const settingsStore = createDomainStore({ name: "plvs:settings", backend });
export const workspaceStore = createDomainStore({ name: "plvs:workspace", backend });

/** Whole-app snapshot of every persisted domain (foundation for problem #5). */
export function exportAll() {
  return { settings: settingsStore.export(), workspace: workspaceStore.export() };
}

/** Wipe every persisted domain (foundation for problem #5). */
export function resetAll() {
  settingsStore.reset();
  workspaceStore.reset();
}
