import { describe, expect, it } from "vitest";
import {
  getDockPanelSizing,
  fitDockPanelWidths,
  DOCK_MAX_PREFERRED_WIDTH,
  normalizeDockPanelSizes,
  resetDockPanelPair,
  resizeDockPanelPair,
} from "./dockPanelSizing.js";

const panelsById = {
  level: { id: "level", moduleId: "levelMeter" },
  spectrum: { id: "spectrum", moduleId: "spectrum" },
};

describe("dock panel sizing", () => {
  it("shares a readable plot baseline and grows horizontal Level meters", () => {
    for (const moduleId of ["loudness", "waveform", "spectrum", "spectrogram", "stereo-map"]) {
      expect(getDockPanelSizing(moduleId).minWidth).toBe(180);
      expect(getDockPanelSizing(moduleId, "extra-large").minWidth).toBeGreaterThan(180);
    }
    for (const direction of ["left-to-right", "right-to-left"]) {
      expect(
        getDockPanelSizing("levelMeter", "small", true, {
          controls: { levelMeterOrientation: direction },
          channelCount: 8,
        })
      ).toMatchObject({ minWidth: 180, growthPolicy: "flexible" });
    }
    expect(
      getDockPanelSizing("levelMeter", "small", true, { channelCount: 8 }).minWidth
    ).toBeGreaterThan(400);
    expect(
      getDockPanelSizing("levelMeter", "small", true, {
        channelCount: 8,
        controls: { levelMeterMode: "momentary" },
      }).minWidth
    ).toBeLessThan(140);
  });

  it("recommends more Stats space for shorter strips, larger text and more readings", () => {
    const controls = {
      statsVisibleIds: [
        "momentary",
        "shortTerm",
        "integrated",
        "momentaryMax",
        "shortTermMax",
        "lra",
        "psr",
        "plr",
        "dialogueCoverage",
        "dialogueIntegrated",
        "dialogueRange",
        "loudnessToDialogueRatio",
        "truePeak",
        "correlation",
        "sideToMid",
      ],
    };
    const size = (height, interfaceSize = "default") =>
      getDockPanelSizing("stats", interfaceSize, true, { height, controls });
    // Normal label line boxes: seven rows fit at 180px, so fifteen readings need three columns.
    expect(size(180).defaultWidth).toBeGreaterThan(size(180).minWidth);
    expect(size(56).defaultWidth).toBeGreaterThan(size(180).defaultWidth);
    expect(size(180, "extra-large").defaultWidth).toBeGreaterThan(size(180).defaultWidth);
  });
  it.each([
    ["small", 71],
    ["default", 76],
    ["large", 86],
    ["extra-large", 96],
  ])(
    "uses readable Vector widths for %s without changing the preferred width",
    (interfaceSize, minWidth) => {
      expect(getDockPanelSizing("vectorscope", interfaceSize)).toMatchObject({
        minWidth,
        defaultWidth: 220,
      });
      const next = resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: { id: "v", moduleId: "vectorscope" },
        rightPanel: { id: "s", moduleId: "spectrum" },
        leftWidth: 220,
        rightWidth: 360,
        delta: -1000,
        interfaceSize,
      });
      expect(next.v).toBe(minWidth);
      expect(next.v + next.s).toBe(580);
    }
  );

  it("preserves narrow saved widths independently of the active text profile", () => {
    expect(normalizeDockPanelSizes({ v: { moduleId: "vectorscope" } }, { v: 71 })).toEqual({
      v: 71,
    });
  });

  it("gives the shared Loudness timeline the same range as other time plots", () => {
    expect(getDockPanelSizing("loudness")).toMatchObject({
      minWidth: 180,
      maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
      growthPolicy: "flexible",
    });
  });

  it("allows Level Meter to grow beyond its original narrow preferred range", () => {
    expect(getDockPanelSizing("levelMeter")).toMatchObject({
      minWidth: 140,
      defaultWidth: 180,
      maxPreferredWidth: DOCK_MAX_PREFERRED_WIDTH,
    });
  });

  it("normalizes known panel ids and clamps their preferred width range", () => {
    expect(normalizeDockPanelSizes(panelsById, { level: 20, spectrum: 1200, stale: 300 })).toEqual({
      level: 20,
      spectrum: 1200,
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

  it("allows manual resizing beyond the old arbitrary maxima", () => {
    expect(
      resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: panelsById.level,
        rightPanel: panelsById.spectrum,
        leftWidth: 300,
        rightWidth: 900,
        delta: 200,
      })
    ).toEqual({ level: 500, spectrum: 700 });

    expect(
      resizeDockPanelPair({
        panelSizesById: {},
        leftPanel: panelsById.level,
        rightPanel: panelsById.spectrum,
        leftWidth: 180,
        rightWidth: 940,
        delta: -100,
      })
    ).toEqual({ level: 140, spectrum: 980 });
  });

  it("resets only the requested pair", () => {
    expect(
      resetDockPanelPair({ level: 200, spectrum: 400, other: 100 }, "level", "spectrum")
    ).toEqual({ other: 100 });
  });
});

describe("Dock width allocation", () => {
  const entries = [
    { id: "stats", minWidth: 160, preferredWidth: 440, autoStats: true, growthPolicy: "fixed" },
    { id: "a", minWidth: 180, preferredWidth: 260, growthPolicy: "flexible" },
    { id: "b", minWidth: 180, preferredWidth: 260, growthPolicy: "flexible" },
  ];
  it("shares surplus equally without a 960px cap", () => {
    expect(fitDockPanelWidths(entries, 3000)).toEqual({ stats: 440, a: 1280, b: 1280 });
  });
  it("protects automatic Stats only while there is room", () => {
    expect(fitDockPanelWidths(entries, 800)).toEqual({ stats: 440, a: 180, b: 180 });
    expect(fitDockPanelWidths(entries, 600)).toEqual({ stats: 240, a: 180, b: 180 });
    expect(fitDockPanelWidths(entries, 400)).toEqual({ stats: 160, a: 180, b: 180 });
    expect(entries[0].preferredWidth).toBe(440);
  });
  it("honours a manual Stats width and restores preferences after a narrow viewport", () => {
    const manual = entries.map((entry) => ({ ...entry, autoStats: false }));
    expect(fitDockPanelWidths(manual, 800).stats).toBeLessThan(440);
    fitDockPanelWidths(manual, 400);
    expect(fitDockPanelWidths(manual, 960)).toEqual({ stats: 440, a: 260, b: 260 });
  });
  it("keeps untouched panels still after a resize begins from rendered geometry", () => {
    const before = fitDockPanelWidths(entries, 1400);
    const after = resizeDockPanelPair({
      panelSizesById: before,
      leftPanel: { id: "a", moduleId: "spectrum" },
      rightPanel: { id: "b", moduleId: "waveform" },
      leftWidth: before.a,
      rightWidth: before.b,
      delta: 100,
    });
    const fitted = fitDockPanelWidths(
      entries.map((entry) => ({ ...entry, preferredWidth: after[entry.id] })),
      1400
    );
    expect(fitted).toEqual({ stats: before.stats, a: before.a + 100, b: before.b - 100 });
  });
});
