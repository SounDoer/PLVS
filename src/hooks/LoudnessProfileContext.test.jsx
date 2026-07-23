/** @vitest-environment jsdom */
import { StrictMode, useLayoutEffect } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { presetsStore, resetAll, settingsStore } from "../persistence/index.js";
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "../lib/loudnessProfileCatalog.js";
import { LoudnessProfileProvider, useLoudnessProfile } from "./LoudnessProfileContext.jsx";

const wrapper = ({ children }) => <LoudnessProfileProvider>{children}</LoudnessProfileProvider>;

function profile(id, name = id, referenceLufs = null) {
  return { id, name, referenceLufs, rules: [] };
}

function seed(profiles, active = LOUDNESS_PROFILE_OFF) {
  settingsStore.patch({ loudnessProfiles: { active, profiles } });
}

function saveProfile(hook, name = "Mine", referenceLufs = -16) {
  act(() => hook.result.current.beginCreate());
  act(() => hook.result.current.editDraft((document) => ({ ...document, name, referenceLufs })));
  act(() => hook.result.current.saveDraft());
}

beforeEach(() => {
  vi.restoreAllMocks();
  settingsStore.reset();
  presetsStore.reset();
});

describe("cold initialization", () => {
  it("uses one starter identity for first render and persisted Configuration", async () => {
    const hook = renderHook(() => useLoudnessProfile(), { wrapper });
    const starterId = hook.result.current.profiles[0].id;

    expect(hook.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(hook.result.current.document).toBe(null);
    await waitFor(() =>
      expect(settingsStore.read().loudnessProfiles?.profiles[0].id).toBe(starterId)
    );
  });

  it("preserves an explicitly empty library without seeding it", () => {
    seed([]);
    const first = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(first.result.current.profiles).toEqual([]);
    expect(settingsStore.read().loudnessProfiles.profiles).toEqual([]);
    first.unmount();

    const second = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(second.result.current.profiles).toEqual([]);
  });

  it("does not recreate a deleted starter after remount", async () => {
    const first = renderHook(() => useLoudnessProfile(), { wrapper });
    await waitFor(() => expect(settingsStore.read().loudnessProfiles?.profiles).toHaveLength(1));
    act(() => first.result.current.removeProfile(first.result.current.profiles[0].id));
    expect(settingsStore.read().loudnessProfiles.profiles).toEqual([]);
    first.unmount();

    const second = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(second.result.current.profiles).toEqual([]);
  });

  it("seeds the exact cold library after reset and provider remount", async () => {
    const custom = profile("custom", "Custom", -18);
    seed([custom], profileSelectionId(custom.id));
    const first = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(first.result.current.active).toBe(profileSelectionId(custom.id));

    act(() => resetAll());
    first.unmount();
    const second = renderHook(() => useLoudnessProfile(), { wrapper });
    await waitFor(() => expect(settingsStore.read().loudnessProfiles?.profiles).toHaveLength(1));

    const expectedStarter = {
      name: "I −23 ±0.5 · TP ≤ −1",
      referenceLufs: -23,
      rules: [
        { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
        { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
        { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
      ],
    };
    expect(second.result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(second.result.current.profiles).toHaveLength(1);
    expect(second.result.current.profiles[0]).toMatchObject(expectedStarter);
    expect(settingsStore.read().loudnessProfiles).toMatchObject({
      active: LOUDNESS_PROFILE_OFF,
      profiles: [expectedStarter],
    });
  });

  it("observes a store update between render and the provider effect", () => {
    const external = profile("external", "External", -20);
    const hook = renderHook(
      () => {
        const value = useLoudnessProfile();
        useLayoutEffect(() => seed([external], profileSelectionId(external.id)), []);
        return value;
      },
      { wrapper }
    );

    expect(hook.result.current.profiles).toEqual([external]);
    expect(hook.result.current.active).toBe(profileSelectionId(external.id));
    expect(settingsStore.read().loudnessProfiles.profiles).toEqual([external]);
  });
});

describe("public flat-library API", () => {
  it("exposes profiles/removeProfile without legacy or duplicate APIs", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.removeProfile).toBeTypeOf("function");
    expect(result.current).not.toHaveProperty("userProfiles");
    expect(result.current).not.toHaveProperty("removeUser");
    expect(result.current).not.toHaveProperty("beginDuplicate");
  });

  it("creates an immediately savable inert Untitled profile and selects it", () => {
    seed([]);
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    expect(result.current.draft.document).toEqual({
      id: "draft",
      name: "Untitled",
      referenceLufs: null,
      rules: [],
    });

    act(() => result.current.saveDraft());
    expect(result.current.profiles).toHaveLength(1);
    expect(result.current.profiles[0]).toMatchObject({
      name: "Untitled",
      referenceLufs: null,
      rules: [],
    });
    expect(result.current.profiles[0].id).not.toBe("draft");
    expect(result.current.profiles[0]).not.toHaveProperty("kind");
    expect(result.current.profiles[0]).not.toHaveProperty("basedOn");
    expect(result.current.active).toBe(profileSelectionId(result.current.profiles[0].id));
    expect(result.current.document).toEqual(result.current.profiles[0]);
    expect(settingsStore.read().loudnessProfiles).toEqual({
      active: result.current.active,
      profiles: result.current.profiles,
    });
  });

  it("edits any seeded profile while preserving the selection it started under", () => {
    const starter = profile("starter", "Starter", -23);
    const other = profile("other", "Other", -18);
    seed([starter, other], profileSelectionId(other.id));
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });

    act(() => result.current.beginEdit(starter.id));
    expect(result.current.draft.document.name).toBe("Starter");
    act(() => result.current.editDraft((document) => ({ ...document, referenceLufs: -20 })));
    act(() => result.current.saveDraft());

    expect(result.current.active).toBe(profileSelectionId(other.id));
    expect(result.current.profiles.find(({ id }) => id === starter.id).referenceLufs).toBe(-20);
    expect(settingsStore.read().loudnessProfiles).toEqual({
      active: profileSelectionId(other.id),
      profiles: result.current.profiles,
    });
  });

  it("restores a saved profile, its rules, and active selection after remount", () => {
    seed([]);
    const first = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => first.result.current.beginCreate());
    act(() =>
      first.result.current.editDraft((document) => ({
        ...document,
        name: "Ruleful",
        rules: [
          {
            metricId: "integrated",
            op: ">",
            value: -22,
            severity: "fail",
          },
        ],
      }))
    );
    act(() => first.result.current.saveDraft());
    const saved = first.result.current.profiles[0];
    const active = profileSelectionId(saved.id);
    first.unmount();

    const second = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(second.result.current.profiles).toEqual([saved]);
    expect(second.result.current.document).toEqual(saved);
    expect(second.result.current.active).toBe(active);
  });

  it("saves a same-tick final edit and inserts only once under StrictMode", () => {
    seed([]);
    const strictWrapper = ({ children }) => (
      <StrictMode>
        <LoudnessProfileProvider>{children}</LoudnessProfileProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper: strictWrapper });
    act(() => result.current.beginCreate());
    act(() => {
      result.current.editDraft((document) => ({ ...document, name: "Typed" }));
      result.current.saveDraft();
      result.current.saveDraft();
    });
    expect(result.current.profiles.map(({ name }) => name)).toEqual(["Typed"]);
  });
});

describe("preview draft", () => {
  it("is shared, normalized without metadata, and never persisted", () => {
    const both = renderHook(() => ({ first: useLoudnessProfile(), second: useLoudnessProfile() }), {
      wrapper,
    });
    const before = settingsStore.read().loudnessProfiles;
    act(() => both.result.current.first.beginCreate());
    act(() =>
      both.result.current.first.editDraft((document) => ({
        ...document,
        kind: "user",
        basedOn: "legacy",
        referenceLufs: "not-a-number",
      }))
    );

    expect(both.result.current.second.referenceLufs).toBe(null);
    expect(both.result.current.second.document).not.toHaveProperty("kind");
    expect(both.result.current.second.document).not.toHaveProperty("basedOn");
    expect(settingsStore.read().loudnessProfiles).toEqual(before);
  });

  it("keeps a half-filled rule visible but inert", () => {
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() =>
      result.current.editDraft((document) => ({
        ...document,
        rules: [{ metricId: "correlation", op: ">", severity: "fail" }],
      }))
    );
    expect(result.current.draft.document.rules[0].value).toBeUndefined();
    expect(result.current.document.rules[0].value).toBeUndefined();
  });
});

describe("draft versus library actions", () => {
  it("blocks deletion and selection under a dirty draft", () => {
    const mine = profile("mine", "Mine");
    seed([mine]);
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginEdit(mine.id));
    act(() => result.current.editDraft((document) => ({ ...document, name: "Half typed" })));
    act(() => result.current.removeProfile(mine.id));
    act(() => result.current.select(profileSelectionId(mine.id)));

    expect(result.current.profiles).toEqual([mine]);
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.current.draft.document.name).toBe("Half typed");
    expect(result.current.draftBlocksLibraryActions).toBe(true);
  });

  it("closes a clean draft when deleting or selecting", () => {
    const mine = profile("mine", "Mine");
    seed([mine]);
    const first = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => first.result.current.beginEdit(mine.id));
    act(() => first.result.current.removeProfile(mine.id));
    expect(first.result.current.draft).toBe(null);
    expect(first.result.current.profiles).toEqual([]);
  });

  it("lets preset apply cancel a dirty draft", () => {
    const mine = profile("mine", "Mine", -20);
    seed([mine]);
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((document) => ({ ...document, name: "Half typed" })));
    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: profileSelectionId(mine.id),
      })
    );
    expect(result.current.draft).toBe(null);
    expect(result.current.document).toEqual(mine);
  });
});

describe("profile deletion", () => {
  it("switches an active deleted profile to Off", () => {
    const mine = profile("mine", "Mine");
    seed([mine], profileSelectionId(mine.id));
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.removeProfile(mine.id));
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.current.document).toBe(null);
  });

  it("permanently clears every matching preset reference and preserves unrelated state", () => {
    const doomed = profile("doomed", "Same name");
    seed([doomed]);
    presetsStore.patch({
      list: [
        { id: "a", name: "A", loudnessProfileActive: profileSelectionId(doomed.id) },
        { id: "b", name: "B", loudnessProfileActive: profileSelectionId("other") },
        { id: "c", name: "C", loudnessProfileActive: profileSelectionId(doomed.id) },
        { id: "d", name: "D" },
      ],
      activeId: "b",
      dirty: false,
    });
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.removeProfile(doomed.id));

    expect(presetsStore.read()).toMatchObject({ activeId: "b", dirty: false });
    expect(presetsStore.read().list).toEqual([
      { id: "a", name: "A", loudnessProfileActive: LOUDNESS_PROFILE_OFF },
      { id: "b", name: "B", loudnessProfileActive: profileSelectionId("other") },
      { id: "c", name: "C", loudnessProfileActive: LOUDNESS_PROFILE_OFF },
      { id: "d", name: "D" },
    ]);

    act(() => result.current.beginCreate());
    act(() => result.current.editDraft((document) => ({ ...document, name: doomed.name })));
    act(() => result.current.saveDraft());
    expect(presetsStore.read().list[0].loudnessProfileActive).toBe(LOUDNESS_PROFILE_OFF);
  });
});

describe("preset snapshots and dirty state", () => {
  it("writes settings and preset dirty exactly once for one StrictMode selection commit", () => {
    const mine = profile("mine", "Mine");
    seed([mine]);
    presetsStore.patch({ list: [], activeId: "preset", dirty: false });
    const settingsPatch = vi.spyOn(settingsStore, "patch");
    const presetsPatch = vi.spyOn(presetsStore, "patch");
    const strictWrapper = ({ children }) => (
      <StrictMode>
        <LoudnessProfileProvider>{children}</LoudnessProfileProvider>
      </StrictMode>
    );
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper: strictWrapper });
    settingsPatch.mockClear();
    presetsPatch.mockClear();

    act(() => result.current.select(profileSelectionId(mine.id)));

    expect(settingsPatch).toHaveBeenCalledTimes(1);
    expect(presetsPatch).toHaveBeenCalledTimes(1);
    expect(presetsPatch).toHaveBeenCalledWith({ dirty: true });
  });

  it("round-trips an opaque active selection and normalizes a dangling one to Off", () => {
    const mine = profile("mine", "Mine");
    seed([mine], profileSelectionId(mine.id));
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    expect(result.current.snapshotForPreset()).toEqual({
      loudnessProfileActive: profileSelectionId(mine.id),
    });

    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: profileSelectionId("gone"),
      })
    );
    expect(result.current.active).toBe(LOUDNESS_PROFILE_OFF);
  });

  it("marks selection changes dirty but not rule edits or preset restore", () => {
    const mine = profile("mine", "Mine");
    seed([mine]);
    presetsStore.patch({ list: [], activeId: "preset", dirty: false });
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });

    act(() => result.current.select(profileSelectionId(mine.id)));
    expect(presetsStore.read().dirty).toBe(true);
    act(() => presetsStore.patch({ dirty: false }));
    act(() => result.current.beginEdit(mine.id));
    act(() => result.current.editDraft((document) => ({ ...document, name: "Renamed" })));
    act(() => result.current.saveDraft());
    expect(presetsStore.read().dirty).toBe(false);

    act(() => result.current.selectOff());
    expect(presetsStore.read().dirty).toBe(true);
    act(() => presetsStore.patch({ dirty: false }));
    act(() =>
      result.current.applyPresetSnapshot({
        loudnessProfileActive: profileSelectionId(mine.id),
      })
    );
    expect(presetsStore.read().dirty).toBe(false);
  });

  it("marks deleting the active profile dirty without a second updater side effect", () => {
    const mine = profile("mine", "Mine");
    seed([mine], profileSelectionId(mine.id));
    presetsStore.patch({ list: [], activeId: "preset", dirty: false });
    const { result } = renderHook(() => useLoudnessProfile(), { wrapper });
    act(() => result.current.removeProfile(mine.id));
    expect(presetsStore.read().dirty).toBe(true);
  });
});
