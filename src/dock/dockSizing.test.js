import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOCK_DEFAULT_HEIGHT,
  clampDockHeight,
  dockHeightFromPointer,
  dockHeightKeyboardDelta,
  dockHeightMode,
} from "./dockSizing.js";

describe("dock sizing", () => {
  it("clamps height to 56-160 logical pixels", () => {
    expect(clampDockHeight(20)).toBe(56);
    expect(clampDockHeight(96.4)).toBe(96);
    expect(clampDockHeight(999)).toBe(160);
  });

  it("falls back to the compact first-run height", () => {
    expect(clampDockHeight(undefined)).toBe(56);
    expect(clampDockHeight("tall")).toBe(56);
  });

  it("matches Rust's default Dock height", () => {
    const dockRs = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", "..", "src-tauri", "src", "dock.rs"),
      "utf8"
    );
    const match = dockRs.match(/pub const DOCK_DEFAULT_LOGICAL_HEIGHT: u32 = (\d+);/);
    expect(match).not.toBeNull();
    expect(Number(match[1])).toBe(DOCK_DEFAULT_HEIGHT);
  });

  it("grows toward the inside edge for top and bottom docks", () => {
    expect(
      dockHeightFromPointer({ edge: "bottom", startHeight: 72, startY: 100, currentY: 80 })
    ).toBe(92);
    expect(
      dockHeightFromPointer({ edge: "top", startHeight: 72, startY: 100, currentY: 120 })
    ).toBe(92);
  });

  it("maps keyboard motion to the physical divider direction", () => {
    expect(dockHeightKeyboardDelta("bottom", "ArrowUp", 4)).toBe(4);
    expect(dockHeightKeyboardDelta("bottom", "ArrowDown", 4)).toBe(-4);
    expect(dockHeightKeyboardDelta("top", "ArrowDown", 16)).toBe(16);
  });

  it("uses compact, standard, and expanded presentation tiers", () => {
    expect(dockHeightMode(56)).toBe("compact");
    expect(dockHeightMode(63)).toBe("compact");
    expect(dockHeightMode(64)).toBe("standard");
    expect(dockHeightMode(119)).toBe("standard");
    expect(dockHeightMode(120)).toBe("expanded");
    expect(dockHeightMode(160)).toBe("expanded");
  });
});
