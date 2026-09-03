import { describe, expect, it } from "vitest";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { readPublicPanelAxes } from "./panelAxes.js";

describe("readPublicPanelAxes", () => {
  it("reports a linked Spectrum frequency axis from the Workspace", () => {
    expect(readPublicPanelAxes(DEFAULT_WORKSPACE_STATE, "spectrum")).toEqual({
      frequency: {
        linked: true,
        source: "workspace",
        writable: true,
        range: { minHz: 20, maxHz: 20000 },
      },
    });
  });

  it("reports an unlinked Loudness time axis from the panel", () => {
    const workspace = {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        loudness: {
          ...DEFAULT_WORKSPACE_STATE.panelControlsById.loudness,
          linkTimeViewport: false,
          historyWindowSec: 25,
          historyOffsetSec: 5,
        },
      },
    };

    expect(readPublicPanelAxes(workspace, "loudness")).toEqual({
      time: {
        linked: false,
        source: "panel",
        writable: true,
        range: { windowSec: 25, offsetSec: 5 },
      },
    });
  });
});
