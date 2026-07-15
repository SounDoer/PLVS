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
  it("normalizes known panel ids and clamps their preferred width range", () => {
    expect(normalizeDockPanelSizes(panelsById, { level: 20, spectrum: 1200, stale: 300 })).toEqual({
      level: 140,
      spectrum: 960,
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
    expect(
      resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: panelsById.level,
        rightPanel: panelsById.spectrum,
        leftWidth: 180,
        rightWidth: 200,
        delta: 999,
      })
    ).toEqual({ level: 200, spectrum: 180 });

    expect(
      resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: panelsById.level,
        rightPanel: panelsById.spectrum,
        leftWidth: 150,
        rightWidth: 200,
        delta: -999,
      })
    ).toEqual({ level: 140, spectrum: 210 });
  });

  it("clamps pair resizing at either panel preferred maximum", () => {
    expect(
      resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: panelsById.level,
        rightPanel: panelsById.spectrum,
        leftWidth: 300,
        rightWidth: 900,
        delta: 100,
      })
    ).toEqual({ level: 320, spectrum: 880 });

    expect(
      resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: panelsById.level,
        rightPanel: panelsById.spectrum,
        leftWidth: 180,
        rightWidth: 940,
        delta: -100,
      })
    ).toEqual({ level: 160, spectrum: 960 });
  });

  it("resets only the requested pair", () => {
    expect(
      resetDockPanelPair({ level: 200, spectrum: 400, other: 100 }, "level", "spectrum")
    ).toEqual({ other: 100 });
  });
});
