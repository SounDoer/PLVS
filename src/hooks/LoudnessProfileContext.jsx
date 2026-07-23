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
  LOUDNESS_PROFILE_OFF,
  createProfileDraft,
  profileSelectionId,
  resolveActiveDocument,
} from "../lib/loudnessProfileCatalog.js";
import {
  normalizeLoudnessProfiles,
  normalizeRuleDocument,
} from "../lib/loudnessProfileNormalize.js";

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

function replacePresetProfileSelection(selection) {
  const raw = presetsStore.read();
  const list = Array.isArray(raw.list) ? raw.list : [];
  let changed = false;
  const nextList = list.map((preset) => {
    if (preset?.loudnessProfileActive !== selection) return preset;
    changed = true;
    return { ...preset, loudnessProfileActive: LOUDNESS_PROFILE_OFF };
  });
  if (changed) presetsStore.patch({ list: nextList });
}

export function LoudnessProfileProvider({ children }) {
  const [state, setState] = useState(readState);
  const initialStateRef = useRef(state);
  const stateRef = useRef(state);

  useEffect(() => {
    const syncState = () => {
      const next = readState();
      stateRef.current = next;
      setState(next);
    };
    const unsubscribe = settingsStore.subscribe(syncState);
    const raw = settingsStore.read().loudnessProfiles;
    if (!raw || typeof raw !== "object" || !Array.isArray(raw.profiles)) {
      stateRef.current = initialStateRef.current;
      setState(initialStateRef.current);
      writeState(initialStateRef.current);
    } else {
      syncState();
    }
    return unsubscribe;
  }, []);

  /// Layout presets snapshot which profile is active and nothing else, so only a change of
  /// selection diverges from the preset -- editing a profile's rules does not.
  ///
  /// Comparing `active` before and after is what makes that correct: two library operations move
  /// the selection as a side effect, and a per-call-site flag gets both wrong. Saving a draft
  /// selects what it saved; deleting the active profile falls back to Off.
  ///
  /// `presetDirty: false` is for the one selection change that is not a divergence: restoring a
  /// snapshot.
  const commit = useCallback((updater, { presetDirty = true } = {}) => {
    const prev = stateRef.current;
    const next = normalizeLoudnessProfiles(updater(prev));
    stateRef.current = next;
    setState(next);
    writeState(next);
    if (presetDirty && next.active !== prev.active) presetsStore.patch({ dirty: true });
  }, []);

  /// The preview overlay: a draft that outranks the persisted selection for every reader without
  /// ever reaching disk.
  ///
  /// `{ editingId, document, dirty, resumeSelection? }`. `editingId` is null for a profile not in
  /// the library yet; `resumeSelection` is the selection to restore on Save and is only carried by
  /// an edit of an existing profile (see `beginEdit` and `saveDraft`).
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

  /// One rule for every library action that would take an open draft with it: a dirty draft blocks
  /// it, a clean draft yields to it.
  ///
  /// The popover stays usable while the editor panel is open, so two surfaces mutate this state and
  /// somebody has to lose. Losing the typing is the wrong answer -- the draft outranks the
  /// selection for every reader, so the discard is invisible until much later. The way out is the
  /// panel's own Save or Cancel, which is on screen and already prompts.
  ///
  /// Enforced here rather than only in the popover so a second caller cannot route around it.
  ///
  /// Read from the ref, not from `draft`: a click landing in the same tick as a debounced edit must
  /// see the edit. See the `draftRef` comment above.
  const draftBlocks = useCallback(() => draftRef.current?.dirty === true, []);

  const beginCreate = useCallback(() => {
    if (draftBlocks()) return;
    putDraft({ editingId: null, document: createProfileDraft(), dirty: false });
  }, [draftBlocks, putDraft]);

  const beginEdit = useCallback(
    (id) => {
      if (draftBlocks()) return;
      const found = state.profiles.find((profile) => profile.id === id);
      if (!found) return;
      // Editing a profile's rules must not change which profile is being monitored -- editing from
      // Off should not silently start judging against the edited rules. Capture the selection now
      // so Save can restore it. Create carries no `resumeSelection`: it selects what it made,
      // which is what the user just asked to create.
      putDraft({
        editingId: id,
        resumeSelection: state.active,
        document: structuredClone(found),
        dirty: false,
      });
    },
    [draftBlocks, putDraft, state.profiles, state.active]
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
  ///
  /// An `editingId` no longer in the library falls back to inserting. Mapping over an array that
  /// does not contain the id matches nothing, so Save would write nothing and still close the
  /// panel: the user's whole profile, gone with no error. The guards above should keep the draft
  /// and the library in step; this is what happens when they do not.
  const saveDraft = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    const id = current.editingId ?? crypto.randomUUID();
    const saved = { ...current.document, id };
    // An edit restores the selection it began under, so changing a profile's rules never changes
    // which profile -- or whether any profile -- is being monitored. A new draft has no prior
    // selection to keep and selects what it created.
    const nextActive = current.editingId ? current.resumeSelection : profileSelectionId(id);
    commit((prev) => ({
      ...prev,
      active: nextActive,
      profiles: prev.profiles.some((profile) => profile.id === id)
        ? prev.profiles.map((profile) => (profile.id === id ? saved : profile))
        : [...prev.profiles, saved],
    }));
    putDraft(null);
  }, [commit, putDraft]);

  // The draft outranks the selection: while one exists, Stats colours, the reference line, the
  // footer and the TP Max marker all follow what the user is typing.
  //
  // Normalized here, and only here. The editor renders `draft.document` raw so its inputs show
  // exactly what was typed; everything that *judges* reads this, and it has to agree with what
  // Save would persist -- otherwise the meter answers "is this threshold sane" about a document
  // the persistence layer would reject.
  const document = useMemo(
    () => (draft ? normalizeRuleDocument(draft.document) : resolveActiveDocument(state)),
    [draft, state]
  );

  /// Blocked under a dirty draft: the draft outranks the selection, so the click would look like it
  /// did nothing while quietly persisting a selection and dirtying the preset.
  const select = useCallback(
    (selection) => {
      if (draftBlocks()) return;
      if (draftRef.current) cancelDraft();
      commit((prev) => ({ ...prev, active: selection }));
    },
    [cancelDraft, commit, draftBlocks]
  );

  const selectOff = useCallback(() => select(LOUDNESS_PROFILE_OFF), [select]);

  /// Deleting the active profile drops the session to Off; normalize would do it anyway, but
  /// doing it here keeps the transition explicit.
  ///
  /// Delete sits two icons from Edit in the same row, so the draft has to be dealt with here. A
  /// dirty draft blocks the delete; a clean one is closed, because leaving the panel open on a
  /// profile that no longer exists is how Save came to write nothing at all.
  const removeProfile = useCallback(
    (id) => {
      if (draftBlocks()) return;
      // Broader than "cancel the draft that edits this id" on purpose: that narrower rule is the
      // one that matters, and stating it as a special case would invite someone to relax the
      // general one and take it with them.
      if (draftRef.current) cancelDraft();
      const selection = profileSelectionId(id);
      commit((prev) => ({
        ...prev,
        active: prev.active === selection ? LOUDNESS_PROFILE_OFF : prev.active,
        profiles: prev.profiles.filter((profile) => profile.id !== id),
      }));
      replacePresetProfileSelection(selection);
    },
    [cancelDraft, commit, draftBlocks]
  );

  /// Layout presets snapshot which profile was active, never the library itself -- the same way
  /// a view snapshot records the active theme rather than every theme.
  const snapshotForPreset = useCallback(
    () => ({ loudnessProfileActive: state.active }),
    [state.active]
  );

  /// The one library action that overrides the block. A preset apply is not a popover click the
  /// user can be asked to reconsider -- it arrives from elsewhere and must win, or the restore
  /// silently does nothing because the draft still outranks the selection it just wrote.
  const applyPresetSnapshot = useCallback(
    (snapshot) => {
      // Nothing to restore is not a restore, and must not cost the draft anything.
      if (snapshot && draftRef.current) cancelDraft();
      commit((prev) => (snapshot ? { ...prev, active: snapshot.loudnessProfileActive } : prev), {
        presetDirty: false,
      });
    },
    [cancelDraft, commit]
  );

  const value = useMemo(
    () => ({
      active: state.active,
      document,
      profiles: state.profiles,
      referenceLufs: document?.referenceLufs ?? null,
      draft,
      // The provider already refuses these; the popover renders them disabled because a button
      // that silently does nothing is worse than one that looks disabled.
      draftBlocksLibraryActions: draft?.dirty === true,
      beginCreate,
      beginEdit,
      editDraft,
      cancelDraft,
      saveDraft,
      select,
      selectOff,
      removeProfile,
      snapshotForPreset,
      applyPresetSnapshot,
    }),
    [
      state,
      document,
      draft,
      beginCreate,
      beginEdit,
      editDraft,
      cancelDraft,
      saveDraft,
      select,
      selectOff,
      removeProfile,
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
