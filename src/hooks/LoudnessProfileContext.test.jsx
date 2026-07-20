/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { presetsStore, settingsStore } from "../persistence/index.js";
import { LoudnessProfileProvider, useLoudnessProfile } from "./LoudnessProfileContext.jsx";
import {
  LOUDNESS_PROFILE_CUSTOM,
  LOUDNESS_PROFILE_OFF,
  builtinSelectionId,
} from "../lib/loudnessProfileCatalog.js";

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

describe("the custom scratch pad", () => {
  it("seeds a default draft on first use", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    expect(result.current.active).toBe(LOUDNESS_PROFILE_CUSTOM);
    expect(result.current.document.metrics.integrated.target).toBe(-23);
  });

  it("keeps draft edits when switching away and back", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.updateCustomDraft({ referenceLufs: -16 }));
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    expect(result.current.referenceLufs).toBe(-23);

    act(() => result.current.selectUnsavedCustom());
    expect(result.current.referenceLufs).toBe(-16);
  });

  it("duplicates a built-in into the scratch pad rather than the library", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.duplicateBuiltin("ebu-r128-s1"));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_CUSTOM);
    expect(result.current.document.basedOn).toBe("ebu-r128-s1");
    expect(result.current.document.metrics.shortTermMax.max).toBe(-18);
    expect(result.current.userProfiles).toEqual([]);
  });

  it("ignores a duplicate of a built-in that does not exist", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.duplicateBuiltin("nope"));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });
});

describe("the user library", () => {
  function withSavedProfile(name = "My Show") {
    const hook = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => hook.result.current.selectUnsavedCustom());
    act(() => hook.result.current.updateCustomDraft({ referenceLufs: -16 }));
    act(() => hook.result.current.saveCustomAs(name));
    return hook;
  }

  it("saves the draft as a named profile and selects it", () => {
    const { result } = withSavedProfile();
    expect(result.current.userProfiles).toHaveLength(1);
    expect(result.current.document.name).toBe("My Show");
    expect(result.current.document.kind).toBe("user");
    expect(result.current.referenceLufs).toBe(-16);
  });

  it("leaves the scratch pad intact after saving out of it", () => {
    const { result } = withSavedProfile();
    expect(result.current.customDraft.referenceLufs).toBe(-16);
  });

  it("gives each saved profile its own identity", () => {
    const { result } = withSavedProfile("First");
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.saveCustomAs("Second"));
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
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.saveCustomAs("Second"));
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
});

describe("preset snapshots", () => {
  it("captures the active selection, not the library", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("streaming-14")));
    const snapshot = result.current.snapshotForPreset();
    expect(snapshot.loudnessProfileActive).toBe(builtinSelectionId("streaming-14"));
    expect(snapshot).not.toHaveProperty("userProfiles");
  });

  it("round-trips a built-in selection", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("streaming-14")));
    const snapshot = result.current.snapshotForPreset();

    act(() => result.current.selectOff());
    act(() => result.current.applyPresetSnapshot(snapshot));
    expect(result.current.referenceLufs).toBe(-14);
  });

  it("round-trips an unsaved custom draft", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.updateCustomDraft({ referenceLufs: -18 }));
    const snapshot = result.current.snapshotForPreset();

    act(() => result.current.selectOff());
    act(() => result.current.applyPresetSnapshot(snapshot));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_CUSTOM);
    expect(result.current.referenceLufs).toBe(-18);
  });

  it("falls back to Off when the preset names a profile that is gone", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.saveCustomAs("Temporary"));
    const snapshot = result.current.snapshotForPreset();
    const { id } = result.current.userProfiles[0];

    act(() => result.current.removeUser(id));
    act(() => result.current.applyPresetSnapshot(snapshot));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("leaves the library untouched when applying a snapshot", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.saveCustomAs("Keep me"));
    const snapshot = { loudnessProfileActive: LOUDNESS_PROFILE_OFF };

    act(() => result.current.applyPresetSnapshot(snapshot));
    expect(result.current.userProfiles.map((p) => p.name)).toEqual(["Keep me"]);
  });

  it("does not let a built-in preset discard a draft in progress", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    act(() => result.current.updateCustomDraft({ referenceLufs: -18 }));

    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: builtinSelectionId("ebu-r128"),
        loudnessProfileCustomDraft: null,
      })
    );
    expect(result.current.customDraft.referenceLufs).toBe(-18);
  });

  it("ignores an absent snapshot", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.select(builtinSelectionId("ebu-r128")));
    act(() => result.current.applyPresetSnapshot(undefined));
    expect(result.current.active).toBe(builtinSelectionId("ebu-r128"));
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

  it("marks the active preset dirty when the draft is edited", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.selectUnsavedCustom());
    presetsStore.patch({ dirty: false });

    act(() => result.current.updateCustomDraft({ referenceLufs: -18 }));
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
