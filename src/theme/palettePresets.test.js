import { describe, expect, it } from "vitest";

import {
  applyPalettePreset,
  findMatchingPalettePresetId,
  getPalettePreset,
  listPalettePresets,
  PALETTE_KINDS,
} from "./palettePresets.js";

describe("palette presets", () => {
  it("publishes stable kind-scoped preset IDs", () => {
    expect(PALETTE_KINDS).toEqual(["status", "intensity", "frequency", "interface"]);
    for (const kind of PALETTE_KINDS) {
      const presets = listPalettePresets(kind);
      expect(presets.length).toBeGreaterThan(0);
      expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length);
    }
    expect(listPalettePresets("status").map(({ id, label }) => [id, label])).toEqual([
      ["status-plvs", "PLVS"],
    ]);
    expect(listPalettePresets("frequency").map(({ id, label }) => [id, label])).toEqual([
      ["frequency-plvs", "PLVS"],
    ]);
    expect(listPalettePresets("interface").map(({ id, label }) => [id, label])).toEqual([
      ["interface-plvs", "PLVS"],
    ]);
  });

  it("returns an editable value snapshot rather than live preset inheritance", () => {
    const snapshot = applyPalettePreset("intensity", "intensity-inferno");
    const preset = getPalettePreset("intensity", "intensity-inferno");

    snapshot.stops[0].color = "#ffffff";

    expect(snapshot.presetId).toBe("intensity-inferno");
    expect(preset.value[0].color).toBe("#000004");
  });

  it("samples every color preset at the same eleven reproducible source positions", () => {
    const expectedPositions = [0, 26, 51, 77, 102, 128, 153, 179, 204, 230, 255].map(
      (position) => position / 255
    );
    const expectedColors = {
      "intensity-inferno": [
        "#000004",
        "#180c3c",
        "#420a68",
        "#6c186e",
        "#932667",
        "#bc3754",
        "#dd513a",
        "#f37819",
        "#fca50a",
        "#f6d746",
        "#fcffa4",
      ],
      "intensity-viridis": [
        "#440154",
        "#482576",
        "#414487",
        "#34608d",
        "#2a788e",
        "#21918c",
        "#22a884",
        "#44bf70",
        "#7ad151",
        "#bddf26",
        "#fde725",
      ],
      "intensity-magma": [
        "#000004",
        "#150e38",
        "#3b0f70",
        "#651a80",
        "#8c2981",
        "#b73779",
        "#de4968",
        "#f7705c",
        "#fe9f6d",
        "#fecf92",
        "#fcfdbf",
      ],
    };

    for (const id of ["intensity-inferno", "intensity-viridis", "intensity-magma"]) {
      expect(getPalettePreset("intensity", id).value).toHaveLength(11);
      expect(getPalettePreset("intensity", id).value.map(({ position }) => position)).toEqual(
        expectedPositions
      );
      expect(getPalettePreset("intensity", id).value.map(({ color }) => color)).toEqual(
        expectedColors[id]
      );
    }
  });

  it("returns null for an unknown preset", () => {
    expect(applyPalettePreset("status", "missing")).toBeNull();
    expect(getPalettePreset("missing", "status-plvs")).toBeNull();
    expect(getPalettePreset("status", "status-bold")).toBeNull();
    expect(getPalettePreset("status", "status-cool")).toBeNull();
    expect(getPalettePreset("frequency", "frequency-spectrum")).toBeNull();
    expect(getPalettePreset("frequency", "frequency-cool")).toBeNull();
    expect(getPalettePreset("status", "status-plvs-light")).toBeNull();
    expect(getPalettePreset("frequency", "frequency-plvs-light")).toBeNull();
  });

  it("matches presets by their value instead of stale provenance", () => {
    const inferno = applyPalettePreset("intensity", "intensity-inferno");
    expect(findMatchingPalettePresetId("intensity", { ...inferno, presetId: null })).toBe(
      "intensity-inferno"
    );

    const oldApproximation = {
      presetId: "intensity-inferno",
      stops: inferno.stops.filter((_, index) => index % 2 === 0),
    };
    expect(findMatchingPalettePresetId("intensity", oldApproximation)).toBeNull();

    expect(
      findMatchingPalettePresetId("status", {
        presetId: "status-plvs-light",
        safe: "#18976a",
        warning: "#9f6200",
        critical: "#d03535",
      })
    ).toBeNull();
  });
});
