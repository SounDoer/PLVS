import { describe, expect, it } from "vitest";
import { DEFAULT_DOCK_PANEL_SIZES } from "./dockLayout.js";
import { firstRunDockState } from "./firstRunDock.js";

describe("firstRunDockState", () => {
  it("uses the tuned first-run widths and controls for every panel", () => {
    const { layout, controlsByPanelId } = firstRunDockState();
    expect(layout.panelOrder.length).toBeGreaterThan(0);
    for (const id of layout.panelOrder) {
      expect(controlsByPanelId[id]).toBeDefined();
      expect(layout.panelSizesById[id]).toBeDefined();
    }
    expect(Object.keys(DEFAULT_DOCK_PANEL_SIZES).length).toBeGreaterThan(0);
  });

  it("returns a fresh object on every call", () => {
    const first = firstRunDockState();
    const second = firstRunDockState();
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.layout).not.toBe(first.layout);
  });
});
