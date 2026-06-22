import { describe, expect, it } from "vitest";
import { deriveClampedPanelControls } from "./clampPanelControls.js";
import { buildSpectrumChannelOptions } from "../math/spectrumChannelOptions.js";

const STEREO_OPTIONS = buildSpectrumChannelOptions(2, ["L", "R"]);

function makeState(panels) {
  return {
    panelOrder: panels.map((p) => p.id),
    panelsById: Object.fromEntries(panels.map((p) => [p.id, { id: p.id, moduleId: p.moduleId }])),
    panelControlsById: Object.fromEntries(panels.map((p) => [p.id, p.controls])),
  };
}

const STEREO_CTX = {
  spectrumChannelOptions: STEREO_OPTIONS,
  channelCount: 2,
  peakLabelContext: {},
};

describe("deriveClampedPanelControls", () => {
  it("clamps only the out-of-range panel, not its in-range sibling", () => {
    const state = makeState([
      {
        id: "a",
        moduleId: "spectrum",
        controls: { spectrumChannel: { type: "pair", x: 0, y: 1 } },
      },
      { id: "b", moduleId: "spectrum", controls: { spectrumChannel: { type: "single", ch: 4 } } },
    ]);

    const updates = deriveClampedPanelControls(state, STEREO_CTX);

    expect(updates).toHaveLength(1);
    expect(updates[0].panelId).toBe("b");
    expect(updates[0].panelControls.spectrumChannel).toEqual({ type: "pair", x: 0, y: 1 });
  });

  it("clamps a spectrogram panel's out-of-range channel", () => {
    const state = makeState([
      {
        id: "g",
        moduleId: "spectrogram",
        controls: { spectrumChannel: { type: "single", ch: 5 } },
      },
    ]);

    const updates = deriveClampedPanelControls(state, STEREO_CTX);

    expect(updates).toHaveLength(1);
    expect(updates[0].panelId).toBe("g");
    expect(updates[0].panelControls.spectrumChannel).toEqual({ type: "pair", x: 0, y: 1 });
  });

  it("clamps a vectorscope panel's out-of-range pair", () => {
    const state = makeState([
      { id: "v", moduleId: "vectorscope", controls: { vectorscopePair: { x: 0, y: 4 } } },
    ]);

    const updates = deriveClampedPanelControls(state, STEREO_CTX);

    expect(updates).toHaveLength(1);
    expect(updates[0].panelId).toBe("v");
    expect(updates[0].panelControls.vectorscopePair).toEqual({ x: 0, y: 1 });
  });

  it("returns no updates when every selection is already valid", () => {
    const state = makeState([
      {
        id: "a",
        moduleId: "spectrum",
        controls: { spectrumChannel: { type: "pair", x: 0, y: 1 } },
      },
      { id: "v", moduleId: "vectorscope", controls: { vectorscopePair: { x: 0, y: 1 } } },
      { id: "m", moduleId: "levelMeter", controls: {} },
    ]);

    expect(deriveClampedPanelControls(state, STEREO_CTX)).toEqual([]);
  });
});
