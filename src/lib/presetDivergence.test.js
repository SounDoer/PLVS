import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { normalizeDockLayout } from "../dock/dockLayout.js";
import { normalizePanelPresentation } from "./panelPresentation.js";
import { presetWorkspaceView } from "./presetWorkspaceView.js";
import { presetDiverges } from "./presetDivergence.js";

const BOUNDS = { x: 100, y: 80, width: 1200, height: 700, isMaximized: false };

const PRESET = {
  id: "p1",
  name: "Preset",
  tree: DEFAULT_WORKSPACE_STATE.tree,
  panelsById: DEFAULT_WORKSPACE_STATE.panelsById,
  panelOrder: DEFAULT_WORKSPACE_STATE.panelOrder,
  panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
  windowPinned: false,
  focusView: { autoHideControls: false, compactPanels: false, borderless: true },
  panelPresentation: normalizePanelPresentation(null),
  surfaceOpacity: 100,
  glassEnabled: false,
  dock: {
    enabled: false,
    edge: "bottom",
    monitor: null,
    reserveSpace: false,
    height: 72,
    ...normalizeDockLayout(undefined),
  },
  loudnessProfileActive: "off",
  windowBounds: BOUNDS,
};

/// The scene applying `preset` produces, which by definition does not diverge from it.
function sceneOf(preset, overrides = {}) {
  const { fullscreenId: _fullscreenId, ...workspace } = presetWorkspaceView(preset);
  return {
    ...workspace,
    windowPinned: preset.windowPinned === true,
    focusView: {
      autoHideControls: false,
      compactPanels: false,
      borderless: false,
      ...preset.focusView,
    },
    panelPresentation: preset.panelPresentation ?? normalizePanelPresentation(null),
    surfaceOpacity: preset.surfaceOpacity ?? 100,
    glassEnabled: preset.glassEnabled === true,
    dock: { ...preset.dock },
    loudnessProfileActive: preset.loudnessProfileActive ?? "off",
    windowBounds: preset.windowBounds ?? BOUNDS,
    ...overrides,
  };
}

const options = {
  dockReserveSpaceSupported: true,
  normalizeLoudnessProfileActive: (raw) => (raw === "profile:a" ? raw : "off"),
};

function diverges(preset, scene) {
  return presetDiverges(preset, scene, options);
}

describe("presetDiverges", () => {
  it("does not diverge from the scene the preset produces", () => {
    expect(diverges(PRESET, sceneOf(PRESET))).toBe(false);
  });

  it.each([
    ["windowPinned", { windowPinned: true }],
    ["focusView", { focusView: { ...sceneOf(PRESET).focusView, autoHideControls: true } }],
    ["surfaceOpacity", { surfaceOpacity: 80 }],
    ["glassEnabled", { glassEnabled: true }],
    ["loudnessProfileActive", { loudnessProfileActive: "profile:a" }],
    ["windowBounds", { windowBounds: { ...BOUNDS, x: 101 } }],
    ["dock enabled", { dock: { ...PRESET.dock, enabled: true } }],
    ["panelOrder", { panelOrder: [...PRESET.panelOrder].reverse() }],
    [
      "panelPresentation",
      {
        panelPresentation: {
          ...PRESET.panelPresentation,
          workspace: { ...PRESET.panelPresentation.workspace, hideAxesAndLabels: true },
        },
      },
    ],
  ])("diverges on %s", (_field, overrides) => {
    expect(diverges(PRESET, sceneOf(PRESET, overrides))).toBe(true);
  });

  it("diverges on a panel control and returns to clean when it is changed back", () => {
    const scene = sceneOf(PRESET);
    const [panelId] = PRESET.panelOrder;
    const original = scene.panelControlsById[panelId];
    const changed = {
      ...scene,
      panelControlsById: { ...scene.panelControlsById, [panelId]: { ...original, probe: 1 } },
    };
    expect(diverges(PRESET, changed)).toBe(true);
    const restored = {
      ...scene,
      panelControlsById: { ...scene.panelControlsById, [panelId]: { ...original } },
    };
    expect(diverges(PRESET, restored)).toBe(false);
  });

  it("ignores fields an older preset never stored", () => {
    const {
      windowPinned: _pinned,
      focusView: _focus,
      panelPresentation: _presentation,
      surfaceOpacity: _opacity,
      glassEnabled: _glass,
      windowBounds: _bounds,
      ...legacy
    } = PRESET;
    const scene = sceneOf(PRESET, {
      windowPinned: true,
      focusView: { autoHideControls: true, compactPanels: true, borderless: false },
      panelPresentation: normalizePanelPresentation({ workspace: { hidePanelHeaders: true } }),
      surfaceOpacity: 40,
      glassEnabled: true,
      windowBounds: { ...BOUNDS, x: 5 },
    });
    expect(diverges(legacy, scene)).toBe(false);
  });

  it("compares the loudness profile selection even when an older preset never stored it", () => {
    const { loudnessProfileActive: _active, ...legacy } = PRESET;
    expect(diverges(legacy, sceneOf(PRESET))).toBe(false);
    expect(diverges(legacy, sceneOf(PRESET, { loudnessProfileActive: "profile:a" }))).toBe(true);
  });

  it("treats a selection naming a deleted profile as Off", () => {
    const preset = { ...PRESET, loudnessProfileActive: "profile:deleted" };
    expect(diverges(preset, sceneOf(PRESET, { loudnessProfileActive: "off" }))).toBe(false);
  });

  it("ignores the strip layout and Dock presentation of a dock-disabled preset", () => {
    const scene = sceneOf(PRESET, {
      dock: { ...PRESET.dock, panelOrder: [...PRESET.dock.panelOrder].reverse(), height: 140 },
      panelPresentation: { ...PRESET.panelPresentation, dock: { hideAxesAndLabels: true } },
    });
    expect(diverges(PRESET, scene)).toBe(false);
  });

  describe("with the Dock enabled", () => {
    const docked = {
      ...PRESET,
      dock: { ...PRESET.dock, enabled: true, monitor: "DISPLAY1", reserveSpace: true, height: 96 },
    };

    it("compares the strip layout and geometry", () => {
      expect(diverges(docked, sceneOf(docked))).toBe(false);
      const reordered = [...docked.dock.panelOrder].reverse();
      expect(
        diverges(docked, sceneOf(docked, { dock: { ...docked.dock, panelOrder: reordered } }))
      ).toBe(true);
      expect(diverges(docked, sceneOf(docked, { dock: { ...docked.dock, height: 120 } }))).toBe(
        true
      );
    });

    it("ignores window bounds, which a docked window does not use", () => {
      expect(diverges(docked, sceneOf(docked, { windowBounds: { ...BOUNDS, x: 9 } }))).toBe(false);
    });

    it("accepts whichever monitor the Dock picked for a preset without one", () => {
      const anyMonitor = { ...docked, dock: { ...docked.dock, monitor: null } };
      expect(diverges(anyMonitor, sceneOf(docked))).toBe(false);
    });

    it("ignores reserve space where the platform cannot reserve", () => {
      const scene = sceneOf(docked, { dock: { ...docked.dock, reserveSpace: false } });
      expect(diverges(docked, scene)).toBe(true);
      expect(presetDiverges(docked, scene, { ...options, dockReserveSpaceSupported: false })).toBe(
        false
      );
    });
  });

  describe("window bounds", () => {
    it("are not compared when the window cannot report them", () => {
      expect(diverges(PRESET, sceneOf(PRESET, { windowBounds: undefined }))).toBe(false);
    });

    it("match while both are maximised, whatever normal rectangle each keeps", () => {
      const maximised = { ...PRESET, windowBounds: { ...BOUNDS, isMaximized: true } };
      const scene = sceneOf(PRESET, {
        windowBounds: { x: 0, y: 0, width: 800, height: 600, isMaximized: true },
      });
      expect(diverges(maximised, scene)).toBe(false);
      expect(diverges(PRESET, scene)).toBe(true);
    });
  });
});
