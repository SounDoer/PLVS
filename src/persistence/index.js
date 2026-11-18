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
import { createMultiInstanceBackend } from "./multiInstanceBackend.js";
import { createDomainStore } from "./createDomainStore.js";
import { isTauri } from "../ipc/env.js";
import { normalizeDialogueVadEngine, normalizeSurfaceOpacity } from "../settings/defaults.js";

const transactionalBoot =
  typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.multiInstancePersistence;
export const usesTransactionalPersistence = isTauri() && Boolean(transactionalBoot);
const backend = isTauri()
  ? usesTransactionalPersistence
    ? createMultiInstanceBackend()
    : createPluginStoreBackend()
  : createLocalStorageBackend();

export const WORKSPACE_DOMAIN_VERSION = 1;
export const PRESETS_DOMAIN_VERSION = 1;

function turnOffLegacySpectrogramGrid(controlsById) {
  if (!controlsById || typeof controlsById !== "object" || Array.isArray(controlsById)) {
    return controlsById;
  }
  return Object.fromEntries(
    Object.entries(controlsById).map(([panelId, controls]) => [
      panelId,
      controls && typeof controls === "object" && !Array.isArray(controls)
        ? { ...controls, spectrogram3dFloor: false }
        : controls,
    ])
  );
}

/**
 * @param {number} version
 */
function migrateWorkspace(raw, version) {
  const { customPresets: _customPresets, activePresetId: _activePresetId, ...rest } = raw;
  if (version >= WORKSPACE_DOMAIN_VERSION) return rest;
  return {
    ...rest,
    version: WORKSPACE_DOMAIN_VERSION,
    ...(rest.panelControlsById !== undefined
      ? { panelControlsById: turnOffLegacySpectrogramGrid(rest.panelControlsById) }
      : null),
  };
}

function migrateSettings(raw) {
  const { panelOpacity, ...rest } = raw;
  if (!("surfaceOpacity" in rest) && panelOpacity != null) {
    rest.surfaceOpacity = normalizeSurfaceOpacity(panelOpacity);
  }
  if (rest.dialogueVadEngine !== undefined) {
    rest.dialogueVadEngine = normalizeDialogueVadEngine(rest.dialogueVadEngine);
  }
  return rest;
}

/**
 * @param {number} version
 */
function migratePresets(raw, version) {
  if (!Array.isArray(raw.list)) return raw;
  return {
    ...raw,
    ...(version < PRESETS_DOMAIN_VERSION ? { version: PRESETS_DOMAIN_VERSION } : null),
    list: raw.list.map((preset) => {
      if (!preset || typeof preset !== "object" || Array.isArray(preset)) return preset;
      const { panelOpacity, ...rest } = preset;
      if (!("surfaceOpacity" in rest) && panelOpacity != null) {
        rest.surfaceOpacity = normalizeSurfaceOpacity(panelOpacity);
      }
      return version < PRESETS_DOMAIN_VERSION
        ? {
            ...rest,
            panelControlsById: turnOffLegacySpectrogramGrid(rest.panelControlsById),
          }
        : rest;
    }),
  };
}

export const settingsStore = createDomainStore({
  name: "plvs:settings",
  backend,
  migrate: migrateSettings,
});
export const workspaceStore = createDomainStore({
  name: "plvs:workspace",
  backend,
  migrate: migrateWorkspace,
  writeVersion: WORKSPACE_DOMAIN_VERSION,
});
export const presetsStore = createDomainStore({
  name: "plvs:presets",
  backend,
  migrate: migratePresets,
  writeVersion: PRESETS_DOMAIN_VERSION,
  notifySameContext: true,
});
export const themesStore = createDomainStore({ name: "plvs:themes", backend });

export function subscribeLibraryConflicts(listener) {
  return backend.subscribeLibraryConflicts?.(listener) ?? (() => {});
}

export function resolveLibraryConflict(action) {
  return backend.resolveLibraryConflict?.(action) ?? Promise.resolve(null);
}

/**
 * @param {string} kind
 */
export function reportLibraryConflict(kind, document) {
  backend.reportLibraryConflict?.(kind, document);
}

export function establishDevelopmentLibraryConflict(fixtureId, conflict) {
  backend.establishDevelopmentLibraryConflict?.(fixtureId, conflict);
}

export function matchesDevelopmentLibraryConflict(fixtureId) {
  return backend.matchesDevelopmentLibraryConflict?.(fixtureId) === true;
}

export function resetDevelopmentLibraryConflict(fixtureId) {
  backend.resetDevelopmentLibraryConflict?.(fixtureId);
}

function flushDomainPatches() {
  settingsStore.flush();
  workspaceStore.flush();
  presetsStore.flush();
  themesStore.flush();
}

/** Force every coalesced domain update into the selected backend, then wait for durable settling. */
export async function flushPersistence() {
  flushDomainPatches();
  await backend.flush();
}

export async function appendLibraryCollections(additions, kinds, validate, appendFallback) {
  if (backend.appendLibrary) {
    flushDomainPatches();
    await backend.appendLibrary(additions, kinds, validate);
  } else {
    validate();
    appendFallback();
    await flushPersistence();
  }
}

/** Whole-app snapshot of every persisted domain. */
export function exportAll() {
  return {
    settings: settingsStore.export(),
    workspace: workspaceStore.export(),
    presets: presetsStore.export(),
    themes: themesStore.export(),
  };
}

/** Wipe every persisted domain. */
export function resetAll() {
  settingsStore.reset();
  workspaceStore.reset();
  presetsStore.reset();
  themesStore.reset();
}
