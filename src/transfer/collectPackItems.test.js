/** @vitest-environment jsdom */
import { describe, expect, it, beforeEach } from "vitest";
import { resetAll, presetsStore, settingsStore } from "../persistence/index.js";
import { collectPackItems } from "./collectPackItems.js";

const PROFILE_A = { id: "prof-a", name: "EBU R128", referenceLufs: -23, rules: [] };
const PROFILE_B = { id: "prof-b", name: "ATSC A/85", referenceLufs: -24, rules: [] };

function seedPresets() {
  presetsStore.patch({
    list: [
      {
        id: "p-1",
        name: "Mix",
        panelOrder: [],
        panelsById: {},
        loudnessProfileActive: "profile:prof-a",
      },
      { id: "p-2", name: "Master", panelOrder: [], panelsById: {}, loudnessProfileActive: "off" },
    ],
  });
  settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A, PROFILE_B] } });
}

describe("collectPackItems", () => {
  beforeEach(() => {
    resetAll();
  });

  it("returns the selected items for a plain library", () => {
    settingsStore.patch({ loudnessProfiles: { profiles: [PROFILE_A, PROFILE_B] } });
    const result = collectPackItems("loudness", ["prof-b"]);
    expect(result.missingIds).toEqual([]);
    expect(result.items.map((item) => item.id)).toEqual(["prof-b"]);
    expect(result.options).toEqual({});
  });

  it("bundles the profiles the selected presets refer to", () => {
    seedPresets();
    const result = collectPackItems("presets", ["p-1", "p-2"]);
    expect(result.items.map((item) => item.id)).toEqual(["p-1", "p-2"]);
    expect(result.options.loudnessProfiles.map((p) => p.id)).toEqual(["prof-a"]);
  });

  it("reports ids that are not in the library instead of dropping them", () => {
    seedPresets();
    const result = collectPackItems("presets", ["p-1", "ghost", "gone"]);
    expect(result.missingIds).toEqual(["ghost", "gone"]);
  });

  it("selects the whole library when ids is null", () => {
    seedPresets();
    const result = collectPackItems("presets", null);
    expect(result.items.map((item) => item.id)).toEqual(["p-1", "p-2"]);
    expect(result.missingIds).toEqual([]);
  });
});
