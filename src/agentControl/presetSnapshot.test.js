import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { buildPublicPresetSnapshot } from "./presetSnapshot.js";

describe("buildPublicPresetSnapshot", () => {
  it("converts a stored Preset into public Workspace and presentation shapes", () => {
    const stored = {
      id: "preset-1",
      name: "  Mixing  ",
      ...DEFAULT_WORKSPACE_STATE,
      windowBounds: { x: 10, y: 20, width: 800, height: 600, isMaximized: false },
      windowPinned: true,
      focusView: { autoHideControls: true, compactPanels: false, borderless: true },
      panelOpacity: 75,
      glassEnabled: true,
      dock: {
        enabled: false,
        edge: "top",
        monitor: "monitor-1",
        reserveSpace: true,
        height: 84,
        panelsById: {},
        panelOrder: [],
        panelSizesById: {},
        controlsByPanelId: {},
      },
      loudnessProfileActive: "profile:broadcast",
    };

    const result = buildPublicPresetSnapshot(stored, {
      loudnessProfiles: [{ id: "broadcast", referenceLufs: -23 }],
    });

    expect(result).toMatchObject({
      id: "preset-1",
      name: "Mixing",
      workspace: {
        layout: expect.any(Object),
        panels: expect.arrayContaining([
          expect.objectContaining({
            id: "spectrum",
            moduleId: "spectrum",
            controls: expect.any(Object),
          }),
        ]),
      },
      window: {
        bounds: stored.windowBounds,
        pinned: true,
        focusView: { autoHideControls: true, compactPanels: false, borderless: true },
        panelOpacity: 75,
        glassEnabled: true,
      },
      dock: {
        enabled: false,
        edge: "top",
        monitor: "monitor-1",
        reserveSpace: true,
        height: 84,
        panels: [],
      },
      loudnessProfile: { activeId: "broadcast" },
    });
    expect(result.workspace.panels[0]).not.toHaveProperty("analysis");
    expect(result).not.toHaveProperty("panelControlsById");
  });

  it("uses the saved Profile selection to interpret Loudness reference availability", () => {
    const base = { id: "preset-1", name: "Mixing", ...DEFAULT_WORKSPACE_STATE };
    const profiles = [{ id: "broadcast", referenceLufs: -23 }];
    const withReference = buildPublicPresetSnapshot(
      { ...base, loudnessProfileActive: "profile:broadcast" },
      { loudnessProfiles: profiles }
    );
    const withoutReference = buildPublicPresetSnapshot(
      { ...base, loudnessProfileActive: "off" },
      { loudnessProfiles: profiles }
    );
    const loudnessWith = withReference.workspace.panels.find(({ id }) => id === "loudness");
    const loudnessWithout = withoutReference.workspace.panels.find(({ id }) => id === "loudness");

    expect(loudnessWith.controls.layers).toContain("reference");
    expect(loudnessWithout.controls.layers).not.toContain("reference");
  });

  it("reports unavailable capture-time bounds as null", () => {
    const result = buildPublicPresetSnapshot({
      id: "preset-1",
      name: "Mixing",
      ...DEFAULT_WORKSPACE_STATE,
    });

    expect(result.window.bounds).toBeNull();
  });
});
