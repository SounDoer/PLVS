import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { presetsStore, settingsStore } from "../persistence/index.js";
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
///
/// One instance too, not one per consumer: Stats, Dock Stats, the Level Meter and the panel
/// settings all read the same document, and a preview draft has to be visible to every one of
/// them at once -- a draft held in any single consumer would be invisible to the other three.

const LoudnessProfileContext = createContext(null);

function readState() {
  return normalizeLoudnessProfiles(settingsStore.read().loudnessProfiles);
}

function writeState(next) {
  settingsStore.patch({ loudnessProfiles: next });
}

export function LoudnessProfileProvider({ children }) {
  const [state, setState] = useState(readState);

  useEffect(() => settingsStore.subscribe(() => setState(readState())), []);

  /// The active profile is part of the layout preset snapshot, so editing it diverges from the
  /// preset exactly the way a workspace or dock edit does, and has to say so -- otherwise the
  /// preset reads as clean while carrying a profile the user has since changed.
  ///
  /// `presetDirty: false` is for the one write that is not a divergence: restoring a snapshot.
  const commit = useCallback((updater, { presetDirty = true } = {}) => {
    setState((prev) => {
      const next = normalizeLoudnessProfiles(updater(prev));
      writeState(next);
      if (presetDirty) presetsStore.patch({ dirty: true });
      return next;
    });
  }, []);

  /// The preview overlay: a draft that outranks the persisted selection for every reader without
  /// ever reaching disk.
  ///
  /// `{ editingId: string | null, document: RuleDocument, dirty: boolean }`; `editingId` is null
  /// for a profile that is not in the library yet.
  ///
  /// ThemeEditor previews by mutating the real selection and eagerly upserting new themes, so it
  /// needs `wasNewRef` / `prevRef` to unwind on cancel. An overlay has no side effects to unwind:
  /// cancel is throwing an object away.
  const [draft, setDraft] = useState(null);

  /// The ref mirrors the draft synchronously, the way `useThemeEditor` keeps a `draftRef`, and for
  /// the same reason: save has to read the draft as it is, not as it was last rendered. Two calls
  /// batched into one tick -- an Enter handler committing a field before saving, a debounced edit
  /// landing with the click -- would otherwise both see the pre-edit document.
  ///
  /// The alternative, reading the draft inside a `setDraft` updater, is not available: StrictMode
  /// re-invokes updaters, so a `commit` (and its `crypto.randomUUID()`) in there inserts twice.
  const draftRef = useRef(null);

  const putDraft = useCallback((next) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const beginCreate = useCallback(() => {
    putDraft({ editingId: null, document: createDefaultCustomDraft(), dirty: false });
  }, [putDraft]);

  const beginDuplicate = useCallback(
    (builtinId) => {
      const next = duplicateAsDraft(builtinId);
      if (!next) return;
      putDraft({ editingId: null, document: next, dirty: false });
    },
    [putDraft]
  );

  const beginEdit = useCallback(
    (id) => {
      const found = state.userProfiles.find((p) => p.id === id);
      if (!found) return;
      putDraft({ editingId: id, document: structuredClone(found), dirty: false });
    },
    [putDraft, state.userProfiles]
  );

  const editDraft = useCallback(
    (mutate) => {
      const prev = draftRef.current;
      if (!prev) return;
      putDraft({ ...prev, document: mutate(prev.document), dirty: true });
    },
    [putDraft]
  );

  const cancelDraft = useCallback(() => putDraft(null), [putDraft]);

  /// The only path out of the overlay that writes anything. Insert when `editingId` is null,
  /// replace in place otherwise -- editing twice must not leave two entries behind.
  const saveDraft = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    const id = current.editingId ?? crypto.randomUUID();
    const saved = { ...current.document, id, kind: "user" };
    commit((prev) => ({
      ...prev,
      active: userSelectionId(id),
      userProfiles: current.editingId
        ? prev.userProfiles.map((p) => (p.id === id ? saved : p))
        : [...prev.userProfiles, saved],
    }));
    putDraft(null);
  }, [commit, putDraft]);

  // The draft outranks the selection: while one exists, Stats colours, the reference line, the
  // footer and the TP Max marker all follow what the user is typing.
  const document = useMemo(() => draft?.document ?? resolveActiveDocument(state), [draft, state]);

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
      commit(
        (prev) => {
          if (!snapshot) return prev;
          const { kind } = parseSelection(snapshot.loudnessProfileActive);
          return {
            ...prev,
            active: snapshot.loudnessProfileActive,
            // Only a Custom selection may overwrite the scratch pad; a preset on a built-in has no
            // business discarding a draft the user is still working on.
            customDraft: kind === "draft" ? snapshot.loudnessProfileCustomDraft : prev.customDraft,
          };
        },
        { presetDirty: false }
      ),
    [commit]
  );

  const value = useMemo(
    () => ({
      active: state.active,
      document,
      userProfiles: state.userProfiles,
      customDraft: state.customDraft,
      referenceLufs: document?.referenceLufs ?? null,
      draft,
      beginCreate,
      beginDuplicate,
      beginEdit,
      editDraft,
      cancelDraft,
      saveDraft,
      select,
      selectOff,
      selectUnsavedCustom,
      duplicateBuiltin,
      updateCustomDraft,
      saveCustomAs,
      updateUser,
      renameUser,
      removeUser,
      snapshotForPreset,
      applyPresetSnapshot,
    }),
    [
      state,
      document,
      draft,
      beginCreate,
      beginDuplicate,
      beginEdit,
      editDraft,
      cancelDraft,
      saveDraft,
      select,
      selectOff,
      selectUnsavedCustom,
      duplicateBuiltin,
      updateCustomDraft,
      saveCustomAs,
      updateUser,
      renameUser,
      removeUser,
      snapshotForPreset,
      applyPresetSnapshot,
    ]
  );

  return (
    <LoudnessProfileContext.Provider value={value}>{children}</LoudnessProfileContext.Provider>
  );
}

/// Throws outside the provider on purpose: a component rendered outside it would silently read a
/// second, unshared copy of the profile, which is exactly the dock/main split this owner exists
/// to prevent.
export function useLoudnessProfile() {
  const value = useContext(LoudnessProfileContext);
  if (!value) throw new Error("useLoudnessProfile must be used inside LoudnessProfileProvider");
  return value;
}
