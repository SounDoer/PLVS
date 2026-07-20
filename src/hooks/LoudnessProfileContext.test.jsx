/** @vitest-environment jsdom */
import { StrictMode } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { presetsStore, settingsStore } from "../persistence/index.js";
import { LoudnessProfileProvider, useLoudnessProfile } from "./LoudnessProfileContext.jsx";
import { LOUDNESS_PROFILE_OFF, builtinSelectionId } from "../lib/loudnessProfileCatalog.js";

function persisted() {
  return settingsStore.read().loudnessProfiles;
}

const wrapper = ({ children }) => <LoudnessProfileProvider>{children}</LoudnessProfileProvider>;

beforeEach(() => {
  settingsStore.reset();
});

describe("useLoudnessProfile cold start", () => {
  it("starts Off with no document and no reference", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.current.document).toBe(null);
    expect(result.current.referenceLufs).toBe(null);
    expect(result.current.userProfiles).toEqual([]);
  });
});

describe("selecting profiles", () => {
  it("resolves a built-in and exposes its reference", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("atsc-a85")));
    expect(result.current.document.name).toBe("ATSC A/85");
    expect(result.current.referenceLufs).toBe(-24);
  });

  it("persists the selection so it survives a remount", () => {
    const first = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => first.result.current.select(builtinSelectionId("ebu-r128")));
    first.unmount();

    const second = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(second.result.current.active).toBe(builtinSelectionId("ebu-r128"));
    expect(second.result.current.referenceLufs).toBe(-23);
  });

  it("drops back to Off with no reference", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    act(() => result.current.selectOff());
    expect(result.current.document).toBe(null);
    expect(result.current.referenceLufs).toBe(null);
  });

  it("refuses a selection that cannot be honoured", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("not-a-standard")));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });
});

describe("the user library", () => {
  /// Saves one profile through the editor path, which is the only way into the library.
  function withSavedProfile(name = "My Show", referenceLufs = -16) {
    const hook = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => hook.result.current.beginCreate());
    act(() => hook.result.current.editDraft((d) => ({ ...d, name, referenceLufs })));
    act(() => hook.result.current.saveDraft());
    return hook;
  }

  it("saves the draft as a named profile and selects it", () => {
    const { result } = withSavedProfile();
    expect(result.current.userProfiles).toHaveLength(1);
    expect(result.current.document.name).toBe("My Show");
    expect(result.current.document.kind).toBe("user");
    expect(result.current.referenceLufs).toBe(-16);
  });

  it("gives each saved profile its own identity", () => {
    const { result } = withSavedProfile("First");
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Second" })));
    act(() => result.current.saveDraft());
    const [a, b] = result.current.userProfiles;
    expect(a.id).not.toBe(b.id);
    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["First", "Second"]);
  });

  it("renames without disturbing the selection", () => {
    const { result } = withSavedProfile();
    const { id } = result.current.userProfiles[0];
    act(() => result.current.renameUser(id, "Renamed"));
    expect(result.current.document.name).toBe("Renamed");
  });

  it("edits a saved profile's rules", () => {
    const { result } = withSavedProfile();
    const { id } = result.current.userProfiles[0];
    act(() => result.current.updateUser(id, { referenceLufs: -20 }));
    expect(result.current.referenceLufs).toBe(-20);
  });

  it("drops to Off when the active profile is deleted", () => {
    const { result } = withSavedProfile();
    const { id } = result.current.userProfiles[0];
    act(() => result.current.removeUser(id));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.current.userProfiles).toEqual([]);
  });

  it("leaves the selection alone when a different profile is deleted", () => {
    const { result } = withSavedProfile("First");
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Second" })));
    act(() => result.current.saveDraft());
    const [first] = result.current.userProfiles;
    act(() => result.current.removeUser(first.id));
    expect(result.current.document.name).toBe("Second");
  });

  it("survives a remount with the library intact", () => {
    const first = withSavedProfile();
    first.unmount();
    const second = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(second.result.current.userProfiles.map((p) => p.name)).toEqual(["My Show"]);
    expect(second.result.current.document.name).toBe("My Show");
  });

  it("ignores a duplicate of a built-in that does not exist", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginDuplicate("nope"));
    expect(result.current.draft).toBe(null);
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });
});

describe("preset snapshots", () => {
  /// Saves one profile through the editor path.
  function saveProfile(hook, name) {
    act(() => hook.result.current.beginCreate());
    act(() => hook.result.current.editDraft((d) => ({ ...d, name })));
    act(() => hook.result.current.saveDraft());
  }

  it("captures the active selection, not the library", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("streaming-14")));
    const snapshot = result.current.snapshotForPreset();
    expect(snapshot).toEqual({ loudnessProfileActive: builtinSelectionId("streaming-14") });
  });

  it("round-trips a built-in selection", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("streaming-14")));
    const snapshot = result.current.snapshotForPreset();

    act(() => result.current.selectOff());
    act(() => result.current.applyPresetSnapshot(snapshot));
    expect(result.current.referenceLufs).toBe(-14);
  });

  it("falls back to Off when the preset names a profile that is gone", () => {
    const hook = renderHook(() => useLoudnessProfile(), { wrapper });
    saveProfile(hook, "Temporary");
    const snapshot = hook.result.current.snapshotForPreset();
    const { id } = hook.result.current.userProfiles[0];

    act(() => hook.result.current.removeUser(id));
    act(() => hook.result.current.applyPresetSnapshot(snapshot));
    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("leaves the library untouched when applying a snapshot", () => {
    const hook = renderHook(() => useLoudnessProfile(), { wrapper });
    saveProfile(hook, "Keep me");
    const snapshot = { loudnessProfileActive: LOUDNESS_PROFILE_OFF };

    act(() => hook.result.current.applyPresetSnapshot(snapshot));
    expect(hook.result.current.userProfiles.map((p) => p.name)).toEqual(["Keep me"]);
  });

  it("ignores an absent snapshot", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Half typed" })));

    act(() => result.current.applyPresetSnapshot(undefined));
    expect(result.current.active).toBe(builtinSelectionId("ebu-r128"));
    // Nothing was restored, so nothing was worth the draft.
    expect(result.current.draft.document.name).toBe("Half typed");
  });
});

describe("single instance", () => {
  it("shows one consumer's selection to another", () => {
    // Two consumers under one provider must agree; four independent hook instances could not
    // share a draft, which is what the preview overlay needs.
    const both = renderHook(() => ({ a: useLoudnessProfile(), b: useLoudnessProfile() }), {
      wrapper,
    });
    act(() => both.result.current.a.select(builtinSelectionId("ebu-r128")));
    expect(both.result.current.b.referenceLufs).toBe(-23);
  });
});

describe("preview draft", () => {
  it("outranks the persisted selection for every reader", () => {
    const both = renderHook(() => ({ a: useLoudnessProfile(), b: useLoudnessProfile() }), {
      wrapper,
    });
    act(() => both.result.current.a.select(builtinSelectionId("ebu-r128")));
    act(() => both.result.current.a.beginCreate());
    act(() => both.result.current.a.editDraft((d) => ({ ...d, referenceLufs: -16 })));

    expect(both.result.current.b.referenceLufs).toBe(-16);
  });

  it("never reaches the settings store", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Scratch" })));

    expect(settingsStore.read().loudnessProfiles?.userProfiles ?? []).toEqual([]);
  });

  it("cannot dirty a preset, because nothing is written", () => {
    presetsStore.reset();
    presetsStore.patch({ activeId: "p1", dirty: false });
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));

    expect(presetsStore.read().dirty).toBe(false);
  });

  it("cancel throws the draft away and restores what was showing", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));
    act(() => result.current.cancelDraft());

    expect(result.current.draft).toBe(null);
    expect(result.current.referenceLufs).toBe(-23);
    expect(result.current.userProfiles).toEqual([]);
  });

  it("saving a new draft inserts it and selects it", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "My Show", referenceLufs: -20 })));
    act(() => result.current.saveDraft());

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["My Show"]);
    expect(result.current.document.name).toBe("My Show");
    expect(result.current.referenceLufs).toBe(-20);
    expect(result.current.draft).toBe(null);
  });

  it("saving an edited profile replaces it rather than adding a second", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Before" })));
    act(() => result.current.saveDraft());
    const { id } = result.current.userProfiles[0];

    act(() => result.current.beginEdit(id));
    act(() => result.current.editDraft((d) => ({ ...d, name: "After" })));
    act(() => result.current.saveDraft());

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["After"]);
  });

  it("tracks whether the draft has been touched", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    expect(result.current.draft.dirty).toBe(false);
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));
    expect(result.current.draft.dirty).toBe(true);
  });

  it("opens a duplicate of a built-in as an unsaved draft", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginDuplicate("ebu-r128-s1"));

    expect(result.current.draft.document.basedOn).toBe("ebu-r128-s1");
    expect(result.current.draft.editingId).toBe(null);
    expect(result.current.userProfiles).toEqual([]);
  });

  it("saves the edit that landed in the same tick as the save", () => {
    // An Enter handler that commits the focused field and then saves batches both into one tick.
    // Reading the draft from the render closure would persist the document as it was before the
    // edit, losing the user's last keystroke with no error.
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => {
      result.current.editDraft((d) => ({ ...d, name: "Typed" }));
      result.current.saveDraft();
    });

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["Typed"]);
  });

  it("does not insert twice when Save is double-clicked", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Once" })));
    act(() => {
      result.current.saveDraft();
      result.current.saveDraft();
    });

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["Once"]);
  });

  it("composes two edits landing in the same tick", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => {
      result.current.editDraft((d) => ({ ...d, name: "First" }));
      result.current.editDraft((d) => ({ ...d, referenceLufs: -16 }));
    });

    expect(result.current.draft.document.name).toBe("First");
    expect(result.current.draft.document.referenceLufs).toBe(-16);
  });

  it("inserts once under StrictMode, which re-invokes state updaters", () => {
    // The original approach called commit() inside a setDraft updater. StrictMode double-invokes
    // updaters, and crypto.randomUUID() inside one yields two ids and two library entries.
    const strictWrapper = ({ children }) => (
      <StrictMode>
        <LoudnessProfileProvider>{children}</LoudnessProfileProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper: strictWrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Strict" })));
    act(() => result.current.saveDraft());

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["Strict"]);
  });

  it("previews what Save would persist, not what was typed", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: "not-a-number" })));

    // The editor still shows the raw text it is bound to...
    expect(result.current.draft.document.referenceLufs).toBe("not-a-number");
    // ...but nothing judges against it, and the chart draws no line.
    expect(result.current.referenceLufs).toBe(null);
  });

  it("keeps a half-typed rule visible to the editor and inert everywhere else", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() =>
      result.current.editDraft((d) => ({
        ...d,
        metrics: { ...d.metrics, correlation: { role: "limit", severity: "fail" } },
        preferredMetricIds: [...d.preferredMetricIds, "correlation"],
      }))
    );

    expect(result.current.draft.document.metrics.correlation).toBeTruthy();
    expect(result.current.document.metrics.correlation).toBeTruthy();
    expect(result.current.document.preferredMetricIds).toContain("correlation");
  });
});

describe("a draft versus the library", () => {
  /// Saves one profile through the editor path and leaves the draft closed.
  function withProfile(name = "Mine") {
    const hook = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => hook.result.current.beginCreate());
    act(() => hook.result.current.editDraft((d) => ({ ...d, name })));
    act(() => hook.result.current.saveDraft());
    return hook;
  }

  it("closes the panel when the profile it edits is deleted with nothing typed", () => {
    const { result } = withProfile();
    const { id } = result.current.userProfiles[0];
    act(() => result.current.beginEdit(id));
    act(() => result.current.removeUser(id));

    expect(result.current.draft).toBe(null);
    expect(result.current.userProfiles).toEqual([]);
  });

  it("refuses to delete the profile a dirty draft is editing", () => {
    const { result } = withProfile();
    const { id } = result.current.userProfiles[0];
    act(() => result.current.beginEdit(id));
    act(() => result.current.editDraft((d) => ({ ...d, name: "Half typed" })));
    act(() => result.current.removeUser(id));

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["Mine"]);
    expect(result.current.draft.document.name).toBe("Half typed");
  });

  it("inserts rather than writing nothing when the edited profile has vanished", () => {
    // Reaching past the guards deliberately. Batched into one tick, the delete has not re-rendered
    // yet, so beginEdit still finds the profile in its render closure and opens a draft on an id
    // the library no longer holds. The guards cannot see this one; the fallback inside saveDraft
    // is what stands between it and a Save that writes nothing and closes anyway.
    const { result } = withProfile();
    const { id } = result.current.userProfiles[0];
    act(() => {
      result.current.removeUser(id);
      result.current.beginEdit(id);
    });
    expect(result.current.draft.editingId).toBe(id);
    expect(result.current.userProfiles).toEqual([]);

    act(() => result.current.editDraft((d) => ({ ...d, name: "Rescued" })));
    act(() => result.current.saveDraft());

    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["Rescued"]);
  });

  it("leaves a dirty draft alone when another editor entry point is used", () => {
    const { result } = withProfile("Beta");
    const { id } = result.current.userProfiles[0];
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Half typed" })));

    act(() => result.current.beginEdit(id));
    expect(result.current.draft.document.name).toBe("Half typed");
    act(() => result.current.beginCreate());
    expect(result.current.draft.document.name).toBe("Half typed");
    act(() => result.current.beginDuplicate("ebu-r128-s1"));
    expect(result.current.draft.document.name).toBe("Half typed");
  });

  it("replaces an untouched draft from any editor entry point", () => {
    const { result } = withProfile("Beta");
    const { id } = result.current.userProfiles[0];

    act(() => result.current.beginCreate());
    act(() => result.current.beginEdit(id));
    expect(result.current.draft.editingId).toBe(id);

    act(() => result.current.beginDuplicate("ebu-r128-s1"));
    expect(result.current.draft.document.basedOn).toBe("ebu-r128-s1");

    act(() => result.current.beginCreate());
    expect(result.current.draft.document.basedOn).toBeUndefined();
  });

  it("refuses a selection change under a dirty draft, including the preset divergence", () => {
    presetsStore.reset();
    presetsStore.patch({ activeId: "p1", dirty: false });
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Half typed" })));

    act(() => result.current.select(builtinSelectionId("ebu-r128-live")));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    act(() => result.current.selectOff());
    expect(result.current.draft.document.name).toBe("Half typed");
    expect(presetsStore.read().dirty).toBe(false);
  });

  it("cancels an untouched draft and applies the selection", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.select(builtinSelectionId("ebu-r128")));

    expect(result.current.draft).toBe(null);
    expect(result.current.referenceLufs).toBe(-23);
  });

  it("lets a preset apply win over a dirty draft", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));

    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: builtinSelectionId("ebu-r128"),
      })
    );
    expect(result.current.draft).toBe(null);
    expect(result.current.referenceLufs).toBe(-23);
  });

  it("tells the popover when the library is blocked", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(result.current.draftBlocksLibraryActions).toBe(false);
    act(() => result.current.beginCreate());
    expect(result.current.draftBlocksLibraryActions).toBe(false);
    act(() => result.current.editDraft((d) => ({ ...d, referenceLufs: -16 })));
    expect(result.current.draftBlocksLibraryActions).toBe(true);
  });
});

describe("preset divergence", () => {
  beforeEach(() => {
    presetsStore.reset();
    presetsStore.patch({ activeId: "p1", dirty: false });
  });

  it("marks the active preset dirty when the selection changes", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    expect(presetsStore.read().dirty).toBe(true);
  });

  it("marks the active preset dirty when a profile is written", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((d) => ({ ...d, name: "Mine" })));
    presetsStore.patch({ dirty: false });

    act(() => result.current.saveDraft());
    expect(presetsStore.read().dirty).toBe(true);
  });

  // Applying a preset is the one write that must not diverge from it: the profile it restores is
  // by definition the profile that preset carries.
  it("does not dirty the preset it is restoring", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: builtinSelectionId("ebu-r128"),
      })
    );
    expect(presetsStore.read().dirty).toBe(false);
  });
});
