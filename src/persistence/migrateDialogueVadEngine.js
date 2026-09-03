// src/persistence/migrateDialogueVadEngine.js
/**
 * One-shot, idempotent lift of the dialogue VAD engine from panel controls into settings.
 *
 * The engine used to be a Stats panel control. `normalizePanelControls` rebuilds its output from
 * the control table, so deleting that row drops the key from workspace state and from every stored
 * preset on the next normalize -- which also means the value is gone for good. This runs first and
 * saves the one value that was actually in effect.
 *
 * "First Stats panel in `panelOrder` wins" is deliberately the rule `deriveDialogueRuntime` used
 * when it resolved the same conflict, so nobody's effective engine changes across the upgrade.
 * Presets are not migrated: there is one global engine now, and five conflicting old values have
 * nowhere to go.
 */
import { settingsStore, workspaceStore } from "./index.js";
import { normalizeDialogueVadEngine } from "../settings/defaults.js";

export function migrateDialogueVadEngine() {
  const settings = settingsStore.read();
  if (settings.dialogueVadEngine !== undefined) return;

  const workspace = workspaceStore.read();
  const panelOrder = Array.isArray(workspace.panelOrder) ? workspace.panelOrder : [];
  const panelsById = workspace.panelsById ?? {};
  const controlsById = workspace.panelControlsById ?? {};

  for (const panelId of panelOrder) {
    if (panelsById[panelId]?.moduleId !== "stats") continue;
    const stored = controlsById[panelId]?.dialogueVadEngine;
    if (stored === undefined) continue;
    settingsStore.patch({ dialogueVadEngine: normalizeDialogueVadEngine(stored) });
    return;
  }
}
