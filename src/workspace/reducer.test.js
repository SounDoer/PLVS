import { describe, expect, it } from "vitest";
import { workspaceReducer } from "./reducer.js";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";

describe("workspaceReducer RESET_WORKSPACE", () => {
  it("restores tree, panels, order, and panel controls to defaults", () => {
    const mutated = {
      ...DEFAULT_WORKSPACE_STATE,
      panelOrder: ["peak"],
      panelsById: { peak: { id: "peak", moduleId: "peak", customTitle: "My Peak" } },
      tree: { type: "leaf", tabs: ["peak"], activeTab: "peak" },
    };

    const next = workspaceReducer(mutated, { type: "RESET_WORKSPACE" });

    expect(next.tree).toEqual(DEFAULT_WORKSPACE_STATE.tree);
    expect(next.panelsById).toEqual(DEFAULT_WORKSPACE_STATE.panelsById);
    expect(next.panelOrder).toEqual(DEFAULT_WORKSPACE_STATE.panelOrder);
    expect(next.panelControlsById).toEqual(DEFAULT_WORKSPACE_STATE.panelControlsById);
    expect(next.fullscreenId).toBeNull();
  });
});
