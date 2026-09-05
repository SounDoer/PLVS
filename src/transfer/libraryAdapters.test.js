/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from "vitest";
import { presetsStore, settingsStore, themesStore } from "../persistence/index.js";
// Built from a built-in rather than hand-written: `normalizeThemeDocument` rejects a document that
// is short of a single field, and a built-in is guaranteed to round-trip. `SettingsPanel.test.jsx`
// makes its custom-theme fixture the same way.
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import { getAdapter } from "./libraryAdapters.js";

const THEME = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "T1" };

beforeEach(() => {
  settingsStore.reset();
  presetsStore.reset();
  themesStore.reset();
});

describe("loudness adapter", () => {
  it("lists the profiles in the settings blob", () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "off",
        profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      },
    });
    expect(
      getAdapter("loudness")
        .list()
        .map((p) => p.id)
    ).toEqual(["a"]);
  });

  it("appends without disturbing the active selection", () => {
    settingsStore.patch({
      loudnessProfiles: {
        active: "profile:a",
        profiles: [{ id: "a", name: "A", referenceLufs: -23, rules: [] }],
      },
    });
    getAdapter("loudness").append([{ id: "b", name: "B", referenceLufs: -16, rules: [] }]);
    const blob = settingsStore.read().loudnessProfiles;
    expect(blob.profiles.map((p) => p.id)).toEqual(["a", "b"]);
    expect(blob.active).toBe("profile:a");
  });

  it("appends exactly the given item on a fresh store, injecting no starter profile", () => {
    settingsStore.reset();
    getAdapter("loudness").append([{ id: "b", name: "B", referenceLufs: -16, rules: [] }]);
    const blob = settingsStore.read().loudnessProfiles;
    expect(blob.profiles.map((p) => p.id)).toEqual(["b"]);
  });

  it("preserves a malformed profile already on disk", () => {
    // No `id` -- rejected by `normalizeRuleDocument`.
    const malformed = { name: "Malformed", referenceLufs: -23, rules: [] };
    settingsStore.patch({
      loudnessProfiles: { active: "off", profiles: [malformed] },
    });
    getAdapter("loudness").append([{ id: "b", name: "B", referenceLufs: -16, rules: [] }]);
    const blob = settingsStore.read().loudnessProfiles;
    expect(blob.profiles).toContainEqual(malformed);
    expect(blob.profiles.map((p) => p.id)).toEqual([undefined, "b"]);
  });

  it("does not reset active when the active profile would be dropped by the normalizer", () => {
    const malformed = { name: "Malformed", referenceLufs: -23, rules: [] };
    settingsStore.patch({
      loudnessProfiles: { active: "profile:ghost", profiles: [malformed] },
    });
    getAdapter("loudness").append([{ id: "b", name: "B", referenceLufs: -16, rules: [] }]);
    const blob = settingsStore.read().loudnessProfiles;
    expect(blob.active).toBe("profile:ghost");
  });
});

describe("presets adapter", () => {
  it("appends to the list without touching activeId or dirty", () => {
    presetsStore.patch({ list: [], activeId: null, dirty: false });
    getAdapter("presets").append([{ id: "p1", name: "P1", loudnessProfileActive: "off" }]);
    const raw = presetsStore.read();
    expect(raw.list.map((p) => p.id)).toEqual(["p1"]);
    expect(raw.activeId).toBe(null);
    expect(raw.dirty).toBe(false);
  });
});

describe("themes adapter", () => {
  it("appends a theme and puts it at the end of the order", () => {
    getAdapter("themes").append([THEME]);
    const raw = themesStore.read();
    expect(Object.keys(raw.themes)).toEqual(["t1"]);
    expect(raw.order).toEqual(["t1"]);
  });

  it("skips an item whose id already exists, leaving the existing entry untouched", () => {
    getAdapter("themes").append([THEME]);
    const collidingTheme = {
      ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]),
      id: "t1",
      name: "Colliding",
    };
    getAdapter("themes").append([collidingTheme]);
    const raw = themesStore.read();
    expect(raw.themes.t1.name).toBe("T1");
    expect(raw.order).toEqual(["t1"]);
  });

  it("writes only the first of two items sharing an id in one batch", () => {
    const dup = { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id: "t1", name: "Second" };
    getAdapter("themes").append([THEME, dup]);
    const raw = themesStore.read();
    expect(raw.themes.t1.name).toBe("T1");
    expect(raw.order).toEqual(["t1"]);
  });
});
