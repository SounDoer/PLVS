import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK_MODULES,
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
      "transport",
    ]);
  });

  it("enables all panels in the first-run product order", () => {
    expect(DEFAULT_DOCK_MODULES).toEqual([
      "transport",
      "level",
      "loudness",
      "stats",
      "correlation",
      "spectrum",
      "spectrogram",
      "waveform",
    ]);
  });
});
