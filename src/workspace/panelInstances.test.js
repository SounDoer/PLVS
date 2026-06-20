import { describe, expect, it } from "vitest";
import {
  createPanel,
  createPanelId,
  resolvePanelDisplayName,
  trimCustomTitle,
} from "./panelInstances.js";

function state(panelsById, panelOrder = Object.keys(panelsById)) {
  return { panelsById, panelOrder };
}

describe("panelInstances", () => {
  it("creates unique ids for duplicate module instances", () => {
    const panelsById = { spectrum: createPanel("spectrum", {}, { id: "spectrum" }) };

    expect(createPanelId("spectrum", panelsById)).toBe("spectrum-2");
    expect(
      createPanelId("spectrum", {
        ...panelsById,
        "spectrum-2": createPanel("spectrum", panelsById, { id: "spectrum-2" }),
      })
    ).toBe("spectrum-3");
  });

  it("trims empty custom titles to null", () => {
    expect(trimCustomTitle("  Dialogue  ")).toBe("Dialogue");
    expect(trimCustomTitle("   ")).toBeNull();
  });

  it("uses the registry title for a single unnamed panel", () => {
    const panelsById = { spectrum: createPanel("spectrum", {}, { id: "spectrum" }) };

    expect(resolvePanelDisplayName(state(panelsById), "spectrum")).toBe("Spectrum");
  });

  it("numbers unnamed duplicate panels", () => {
    const panelsById = {
      spectrum: createPanel("spectrum", {}, { id: "spectrum" }),
      "spectrum-2": createPanel("spectrum", {}, { id: "spectrum-2" }),
    };

    expect(resolvePanelDisplayName(state(panelsById), "spectrum")).toBe("Spectrum 1");
    expect(resolvePanelDisplayName(state(panelsById), "spectrum-2")).toBe("Spectrum 2");
  });

  it("uses custom titles and excludes them from automatic numbering", () => {
    const panelsById = {
      spectrum: createPanel("spectrum", {}, { id: "spectrum" }),
      "spectrum-2": createPanel("spectrum", {}, { id: "spectrum-2", customTitle: "Dialogue" }),
      "spectrum-3": createPanel("spectrum", {}, { id: "spectrum-3" }),
    };

    const s = state(panelsById);
    expect(resolvePanelDisplayName(s, "spectrum")).toBe("Spectrum 1");
    expect(resolvePanelDisplayName(s, "spectrum-2")).toBe("Dialogue");
    expect(resolvePanelDisplayName(s, "spectrum-3")).toBe("Spectrum 2");
  });
});
