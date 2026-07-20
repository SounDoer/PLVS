import { useCallback, useEffect, useMemo, useState } from "react";
import { settingsStore } from "../persistence/index.js";
import {
  LOUDNESS_PROFILE_CUSTOM,
  LOUDNESS_PROFILE_OFF,
  createDefaultCustomDraft,
  duplicateAsDraft,
  parseSelection,
  resolveActiveDocument,
  userSelectionId,
} from "../lib/loudnessProfileCatalog.js";
import { normalizeLoudnessProfiles } from "../lib/loudnessProfileNormalize.js";

/// Session state for the active Loudness Profile plus the user library.
///
/// One writer: everything that used to read a per-panel `loudnessReferenceLufs` now reads
/// `document.referenceLufs` from here (null when Off). See the design doc, §Persistence.

function readState() {
  return normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles);
}

function writeState(next) {
  settingsStore.patch({ loudnessProfiles: next });
}

export function useLoudnessProfile() {
  const [state, setState] = useState(readState);

  useEffect(() => settingsStore.subscribe(() => setState(readState())), []);

  const commit = useCallback((updater) => {
    setState((prev) => {
      const next = normalizeLoudnessProfiles(updater(prev));
      writeState(next);
      return next;
    });
  }, []);

  const document = useMemo(() => resolveActiveDocument(state), [state]);

  const select = useCallback(
    (selection) => commit((prev) => ({ ...prev, active: selection })),
    [commit]
  );

  const selectOff = useCallback(() => select(LOUDNESS_PROFILE_OFF), [select]);

  /// Selecting Custom revives the stashed draft rather than starting over, so Custom behaves as
  /// a single scratch pad the user can leave and come back to.
  const selectUnsavedCustom = useCallback(
    () =>
      commit((prev) => ({
        ...prev,
        active: LOUDNESS_PROFILE_CUSTOM,
        customDraft: prev.customDraft ?? createDefaultCustomDraft(),
      })),
    [commit]
  );

  /// Duplicating a built-in lands in the scratch pad, never straight into the library: naming is
  /// the user's decision, made at Save as.
  const duplicateBuiltin = useCallback(
    (builtinId) =>
      commit((prev) => {
        const draft = duplicateAsDraft(builtinId);
        if (!draft) return prev;
        return { ...prev, active: LOUDNESS_PROFILE_CUSTOM, customDraft: draft };
      }),
    [commit]
  );

  const updateCustomDraft = useCallback(
    (patch) =>
      commit((prev) => {
        const base = prev.customDraft ?? createDefaultCustomDraft();
        return { ...prev, customDraft: { ...base, ...patch } };
      }),
    [commit]
  );

  const saveCustomAs = useCallback(
    (name) =>
      commit((prev) => {
        if (!prev.customDraft) return prev;
        const id = crypto.randomUUID();
        const saved = { ...prev.customDraft, id, name, kind: "user" };
        return {
          ...prev,
          active: userSelectionId(id),
          userProfiles: [...prev.userProfiles, saved],
          // The draft stays behind: Save as copies out of the scratch pad, it does not empty it.
          customDraft: prev.customDraft,
        };
      }),
    [commit]
  );

  const updateUser = useCallback(
    (id, patch) =>
      commit((prev) => ({
        ...prev,
        userProfiles: prev.userProfiles.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      })),
    [commit]
  );

  const renameUser = useCallback((id, name) => updateUser(id, { name }), [updateUser]);

  /// Deleting the active profile drops the session to Off; normalize would do it anyway, but
  /// doing it here keeps the transition explicit.
  const removeUser = useCallback(
    (id) =>
      commit((prev) => {
        const userProfiles = prev.userProfiles.filter((p) => p.id !== id);
        const active = prev.active === userSelectionId(id) ? LOUDNESS_PROFILE_OFF : prev.active;
        return { ...prev, userProfiles, active };
      }),
    [commit]
  );

  const setRefLayerWanted = useCallback(
    (wanted) => commit((prev) => ({ ...prev, refLayerWanted: wanted === true })),
    [commit]
  );

  /// Layout presets snapshot which profile was active, never the library itself -- the same way
  /// a view snapshot records the active theme rather than every theme.
  const snapshotForPreset = useCallback(
    () => ({
      loudnessProfileActive: state.active,
      loudnessProfileCustomDraft: state.customDraft,
    }),
    [state]
  );

  const applyPresetSnapshot = useCallback(
    (snapshot) =>
      commit((prev) => {
        if (!snapshot) return prev;
        const { kind } = parseSelection(snapshot.loudnessProfileActive);
        return {
          ...prev,
          active: snapshot.loudnessProfileActive,
          // Only a Custom selection may overwrite the scratch pad; a preset on a built-in has no
          // business discarding a draft the user is still working on.
          customDraft: kind === "draft" ? snapshot.loudnessProfileCustomDraft : prev.customDraft,
        };
      }),
    [commit]
  );

  return {
    active: state.active,
    document,
    userProfiles: state.userProfiles,
    customDraft: state.customDraft,
    refLayerWanted: state.refLayerWanted,
    referenceLufs: document?.referenceLufs ?? null,
    select,
    selectOff,
    selectUnsavedCustom,
    duplicateBuiltin,
    updateCustomDraft,
    saveCustomAs,
    updateUser,
    renameUser,
    removeUser,
    setRefLayerWanted,
    snapshotForPreset,
    applyPresetSnapshot,
  };
}
