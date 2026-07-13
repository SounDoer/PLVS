import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK_MODULES,
  DEFAULT_DOCK_STATS_IDS,
  DOCK_MODULE_IDS,
  normalizeDockLayout,
  normalizeDockStatsIds,
  toggleDockModule,
  toggleDockStatId,
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

  it("keeps the v1 default enabled set (new modules are opt-in)", () => {
    expect(DEFAULT_DOCK_MODULES).toEqual(["level", "loudness", "spectrum", "correlation"]);
  });
});

describe("normalizeDockStatsIds", () => {
  it("falls back to defaults for junk input", () => {
    expect(normalizeDockStatsIds(undefined)).toEqual(DEFAULT_DOCK_STATS_IDS);
    expect(normalizeDockStatsIds("nope")).toEqual(DEFAULT_DOCK_STATS_IDS);
  });

  it("drops unknown ids and duplicates, caps at MAX_DOCK_STATS_IDS", () => {
    const raw = ["truePeak", "ghost", "lra", "truePeak", "integrated", "psr", "plr"];
    expect(normalizeDockStatsIds(raw)).toEqual(["truePeak", "lra", "integrated", "psr"]);
  });

  it("keeps an intentionally empty list empty", () => {
    expect(normalizeDockStatsIds([])).toEqual([]);
  });
});

describe("toggleDockStatId", () => {
  it("removes a present id and appends an absent one", () => {
    expect(toggleDockStatId(["lra"], "lra")).toEqual([]);
    expect(toggleDockStatId(["lra"], "psr")).toEqual(["lra", "psr"]);
  });

  it("refuses to exceed the cap", () => {
    const full = ["integrated", "truePeak", "lra", "psr"];
    expect(toggleDockStatId(full, "plr")).toEqual(full);
  });

  it("ignores unknown ids", () => {
    expect(toggleDockStatId(["lra"], "ghost")).toEqual(["lra"]);
  });
});
