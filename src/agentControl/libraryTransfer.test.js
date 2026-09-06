/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { resetAll, presetsStore, settingsStore } from "../persistence/index.js";
import { BUILTIN_THEMES_V2 } from "../theme/builtinThemesV2.js";
import {
  LIBRARY_FAMILIES,
  buildLibraryList,
  libraryFamily,
  planLibraryExport,
  planLibraryImport,
} from "./libraryTransfer.js";

const PROFILE_A = { id: "prof-a", name: "EBU R128", referenceLufs: -23, rules: [] };

// `packShape.js`'s theme normalizer runs full Theme V2 validation, so a test theme must be a real
// one -- a bare `{ id, name, tokens }` document is silently dropped by `normalizeThemeDocument`
// and never reaches the pack's `items`, same as `packShape.test.js` deals with this.
function makeTheme(id, name) {
  return { ...structuredClone(BUILTIN_THEMES_V2["plvs-dark"]), id, name };
}

describe("LIBRARY_FAMILIES", () => {
  it("maps each Agent Control family to its pack type", () => {
    expect(LIBRARY_FAMILIES.preset.packType).toBe("presets");
    expect(LIBRARY_FAMILIES.theme.packType).toBe("themes");
    expect(LIBRARY_FAMILIES.loudnessProfile.packType).toBe("loudness");
  });

  it("gives each family a distinct not-found code and state key", () => {
    expect(LIBRARY_FAMILIES.preset.notFoundCode).toBe("presetNotFound");
    expect(LIBRARY_FAMILIES.theme.notFoundCode).toBe("themeNotFound");
    expect(LIBRARY_FAMILIES.loudnessProfile.notFoundCode).toBe("loudnessProfileNotFound");
    expect(LIBRARY_FAMILIES.theme.stateKey).toBe("themes");
    expect(LIBRARY_FAMILIES.loudnessProfile.stateKey).toBe("profiles");
  });

  it("rejects a family outside Agent Control's wire vocabulary, naming it in the message", () => {
    // `src/transfer/`'s internal vocabulary (`presets`/`themes`/`loudness`) must not leak through
    // here: a typo'd or wrong-vocabulary family should fail with a message a CLI caller wrote.
    expect(() => libraryFamily("presets")).toThrow(/Unknown library family: presets/);
  });
});

describe("buildLibraryList", () => {
  beforeEach(() => resetAll());

  it("returns id and name summaries only", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    expect(buildLibraryList("loudnessProfile")).toEqual([{ id: "prof-a", name: "EBU R128" }]);
  });
});

describe("planLibraryExport", () => {
  beforeEach(() => resetAll());

  it("builds a pack for the whole library", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    const planned = planLibraryExport("loudnessProfile", null);
    expect(planned.missingIds).toEqual([]);
    expect(planned.pack.kind).toBe("loudness-pack");
    expect(planned.pack.items.map((item) => item.id)).toEqual(["prof-a"]);
  });

  it("reports missing ids and builds no pack", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    const planned = planLibraryExport("loudnessProfile", ["prof-a", "ghost"]);
    expect(planned.missingIds).toEqual(["ghost"]);
    expect(planned.pack).toBeNull();
  });

  it("treats an empty ids array as 'export nothing', distinct from the whole library", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A] } });
    const planned = planLibraryExport("loudnessProfile", []);
    expect(planned.missingIds).toEqual([]);
    expect(planned.pack.items).toEqual([]);
  });
});

describe("planLibraryImport", () => {
  beforeEach(() => resetAll());

  function themePack(items) {
    return { app: "PLVS", kind: "theme-pack", version: 1, exportedAt: "", items };
  }

  it("plans an addition without writing", () => {
    const planned = planLibraryImport("theme", themePack([makeTheme("t-1", "Studio")]));
    expect(planned.changed).toBe(true);
    expect(planned.plan.items).toEqual([
      { sourceId: "t-1", finalId: "t-1", name: "Studio", disposition: "added" },
    ]);
    expect(planned.commit).toBeTypeOf("function");
  });

  it("rejects a pack of the wrong kind with a readable message", () => {
    expect(() =>
      planLibraryImport("theme", { app: "PLVS", kind: "preset-pack", version: 1, items: [] })
    ).toThrow(/Presets file/);
  });

  it("reports an identical entry as a no-op", () => {
    const theme = makeTheme("t-1", "Studio");
    planLibraryImport("theme", themePack([theme])).commit();
    const planned = planLibraryImport("theme", themePack([theme]));
    expect(planned.changed).toBe(false);
    expect(planned.plan.items[0].disposition).toBe("skipped");
  });

  it("carries the bundled profile plan for presets", () => {
    presetsStore.patch({ list: [] });
    const pack = {
      app: "PLVS",
      kind: "preset-pack",
      version: 1,
      exportedAt: "",
      items: [
        {
          id: "p-1",
          name: "Mix",
          panelOrder: [],
          panelsById: {},
          loudnessProfileActive: "profile:prof-a",
        },
      ],
      loudnessProfiles: [PROFILE_A],
    };
    const planned = planLibraryImport("preset", pack);
    expect(planned.plan.loudnessProfiles.map((entry) => entry.sourceId)).toEqual(["prof-a"]);
  });
});
