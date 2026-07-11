import { describe, expect, it } from "vitest";
import {
  DEFAULT_DOCK_MODULES,
  normalizeDockLayout,
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
});
