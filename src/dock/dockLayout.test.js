import { describe, expect, it } from "vitest";
import { fitDockPanelWidths, getDockPanelSizing } from "./dockPanelSizing.js";
import {
  DEFAULT_DOCK_MODULES,
  DEFAULT_DOCK_PANEL_SIZES,
  DOCK_MODULE_IDS,
  normalizeDockLayout,
  setDockPanelOrder,
  toggleDockModule,
  reorderDockModule,
} from "./dockLayout.js";

describe("normalizeDockLayout", () => {
  it("falls back to defaults for junk input", () => {
    expect(normalizeDockLayout(undefined).modules).toEqual(DEFAULT_DOCK_MODULES);
    expect(normalizeDockLayout(null).modules).toEqual(DEFAULT_DOCK_MODULES);
    expect(normalizeDockLayout({ modules: "nope" }).modules).toEqual(DEFAULT_DOCK_MODULES);
  });

  it("drops unknown ids and duplicates, keeps order", () => {
    const raw = { modules: ["spectrum", "ghost", "level", "spectrum"] };
    expect(normalizeDockLayout(raw).modules).toEqual(["spectrum", "level"]);
  });

  it("keeps an intentionally empty list empty", () => {
    expect(normalizeDockLayout({ modules: [] }).modules).toEqual([]);
  });

  it("leaves panelSizesById empty for both the module-list branch's inputs", () => {
    expect(normalizeDockLayout(undefined).panelSizesById).toEqual({});
    expect(normalizeDockLayout({ modules: ["spectrum", "level"] }).panelSizesById).toEqual({});
  });
});

describe("DEFAULT_DOCK_PANEL_SIZES", () => {
  it.each([1800, 2024, 2560])(
    "divides the remaining %i-pixel viewport equally among five plots",
    (width) => {
      const layout = normalizeDockLayout(undefined);
      const entries = layout.panelOrder.map((id) => ({
        id,
        ...getDockPanelSizing(layout.panelsById[id].moduleId, "default"),
        preferredWidth: DEFAULT_DOCK_PANEL_SIZES[id],
      }));
      const fitted = fitDockPanelWidths(entries, width);
      expect(fitted.stats).toBe(400);
      expect(fitted.level).toBe(180);
      expect(fitted.correlation).toBe(180);
      for (const id of ["loudness", "waveform", "spectrogram", "spectrum", "stereoMap"])
        expect(fitted[id]).toBeCloseTo((width - 760) / 5);
    }
  );

  it("pins the eight tuned first-run widths", () => {
    expect(DEFAULT_DOCK_PANEL_SIZES).toEqual({
      stats: 400,
      level: 180,
      loudness: 180,
      correlation: 180,
      waveform: 180,
      spectrogram: 180,
      spectrum: 180,
      stereoMap: 180,
    });
  });
});

describe("toggleDockModule", () => {
  it("removes an enabled module", () => {
    const next = toggleDockModule({ modules: ["level", "loudness"] }, "level");
    expect(next.modules).toEqual(["loudness"]);
  });

  it("appends a disabled module at the end", () => {
    const next = toggleDockModule({ modules: ["level"] }, "correlation");
    expect(next.modules).toEqual(["level", "correlation"]);
  });

  it("ignores unknown ids", () => {
    const layout = { modules: ["level"] };
    expect(toggleDockModule(layout, "ghost")).toEqual(layout);
  });
});

describe("reorderDockModule", () => {
  it("moves a module to a new index", () => {
    const next = reorderDockModule({ modules: ["level", "loudness", "spectrum"] }, 0, 2);
    expect(next.modules).toEqual(["loudness", "spectrum", "level"]);
  });

  it("clamps out-of-range indices", () => {
    const next = reorderDockModule({ modules: ["level", "loudness"] }, 5, -3);
    expect(next.modules).toEqual(["loudness", "level"]);
  });

  it("setDockPanelOrder does not append omitted legacy ids", () => {
    const next = setDockPanelOrder(
      {
        panelsById: {
          level: { id: "level", moduleId: "levelMeter" },
          levelMeter: { id: "levelMeter", moduleId: "levelMeter" },
          loudness: { id: "loudness", moduleId: "loudness" },
        },
        panelOrder: ["level", "levelMeter", "loudness"],
      },
      ["loudness", "levelMeter"]
    );

    expect(next.panelOrder).toEqual(["loudness", "levelMeter"]);
  });
});

describe("dock module catalog v1.5/v2", () => {
  it("includes the new module ids after the v1 four", () => {
    expect(DOCK_MODULE_IDS).toEqual([
      "level",
      "loudness",
      "spectrum",
      "correlation",
      "stats",
      "waveform",
      "spectrogram",
      "stereoMap",
    ]);
  });

  it("enables the tuned first-run panels in order", () => {
    expect(DEFAULT_DOCK_MODULES).toEqual([
      "stats",
      "level",
      "loudness",
      "waveform",
      "spectrogram",
      "spectrum",
      "stereoMap",
      "correlation",
    ]);
  });
});

it("discards legacy Timecode instances while retaining other panel ids and widths", () => {
  const layout = normalizeDockLayout({
    panelsById: {
      clock: { id: "clock", moduleId: "transport" },
      meter: { id: "meter", moduleId: "levelMeter" },
    },
    panelOrder: ["clock", "meter"],
    panelSizesById: { clock: 90, meter: 220 },
  });
  expect(layout.panelOrder).toEqual(["meter"]);
  expect(layout.panelSizesById).toEqual({ meter: 220 });
});
