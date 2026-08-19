import { describe, expect, it } from "vitest";

import {
  applyPalettePreset,
  getPalettePreset,
  listPalettePresets,
  PALETTE_KINDS,
} from "./palettePresets.js";

describe("palette presets", () => {
  it("publishes stable kind-scoped preset IDs", () => {
    expect(PALETTE_KINDS).toEqual(["status", "intensity", "frequency"]);
    for (const kind of PALETTE_KINDS) {
      const presets = listPalettePresets(kind);
      expect(presets.length).toBeGreaterThan(0);
      expect(new Set(presets.map(({ id }) => id)).size).toBe(presets.length);
    }
  });

  it("returns an editable value snapshot rather than live preset inheritance", () => {
    const snapshot = applyPalettePreset("intensity", "intensity-inferno");
    const preset = getPalettePreset("intensity", "intensity-inferno");

    snapshot.stops[0].color = "#ffffff";

    expect(snapshot.presetId).toBe("intensity-inferno");
    expect(preset.value[0].color).toBe("#000004");
  });

  it("returns null for an unknown preset", () => {
    expect(applyPalettePreset("status", "missing")).toBeNull();
    expect(getPalettePreset("missing", "status-plvs")).toBeNull();
  });
});
