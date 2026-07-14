import { describe, expect, it } from "vitest";
import {
  normalizeDockPanelSizes,
  resetDockPanelPair,
  resizeDockPanelPair,
} from "./dockPanelSizing.js";

const panelsById = {
  level: { id: "level", moduleId: "levelMeter" },
  spectrum: { id: "spectrum", moduleId: "spectrum" },
};

describe("dock panel sizing", () => {
  it("normalizes known panel ids and clamps their minimum widths", () => {
    expect(normalizeDockPanelSizes(panelsById, { level: 20, spectrum: 420, stale: 300 })).toEqual({
      level: 140,
      spectrum: 420,
    });
  });

  it("resizes only an adjacent pair while preserving its total", () => {
    const next = resizeDockPanelPair({
      panelSizesById: { untouched: 200 },
      leftPanel: panelsById.level,
      rightPanel: panelsById.spectrum,
      leftWidth: 180,
      rightWidth: 360,
      delta: 50,
    });
    expect(next).toEqual({ untouched: 200, level: 230, spectrum: 310 });
  });

  it("clamps pair resizing at either panel minimum", () => {
    const next = resizeDockPanelPair({
      panelSizesById: {},
      leftPanel: panelsById.level,
      rightPanel: panelsById.spectrum,
      leftWidth: 180,
      rightWidth: 360,
      delta: 999,
    });
    expect(next).toEqual({ level: 360, spectrum: 180 });
  });

  it("resets only the requested pair", () => {
    expect(
      resetDockPanelPair({ level: 200, spectrum: 400, other: 100 }, "level", "spectrum")
    ).toEqual({ other: 100 });
  });
});
