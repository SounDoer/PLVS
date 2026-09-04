import { describe, expect, it } from "vitest";
import { presetWorkspaceView } from "./presetWorkspaceView.js";
import { workspaceReducer } from "../workspace/reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";

const VIEW_KEYS = [
  "tree",
  "panelsById",
  "panelOrder",
  "panelControlsById",
  "pinnedPanelsById",
  "axisViewports",
  // Compared by the persistence wait, so it belongs to the view as much as the six above.
  "fullscreenId",
];

const stale = {
  id: "preset-1",
  name: "Saved Long Ago",
  ...DEFAULT_WORKSPACE_STATE,
  // Stored before some controls existed, and carrying one that has since been removed.
  panelControlsById: { spectrum: { spectrumSpeedPercent: 40, removedLegacyControl: 7 } },
};

describe("presetWorkspaceView", () => {
  it("migrates the stored controls rather than echoing them", () => {
    const view = presetWorkspaceView(stale);
    expect(view.panelControlsById.spectrum.spectrumSpeedPercent).toBe(40);
    expect(view.panelControlsById.spectrum).not.toHaveProperty("removedLegacyControl");
    // The point of the whole helper: the applied Workspace is not the stored record.
    expect(JSON.stringify(view.panelControlsById)).not.toBe(
      JSON.stringify(stale.panelControlsById)
    );
  });

  it("is a fixed point of the reducer that stores it", () => {
    // A settlement waits for the state the reducer produces to equal this view. If SET_VIEW applies
    // a normalization the view does not, they can never be equal and the wait never ends — which is
    // exactly how `preset.apply` came to hang. Anything added to SET_VIEW has to land here too.
    const view = presetWorkspaceView(stale);
    const stored = workspaceReducer(DEFAULT_WORKSPACE_STATE, { type: "SET_VIEW", payload: view });
    for (const key of VIEW_KEYS) {
      expect(JSON.stringify(stored[key]), `SET_VIEW changed ${key}`).toBe(
        JSON.stringify(view[key])
      );
    }
  });
});
