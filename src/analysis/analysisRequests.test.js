import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import { deriveAnalysisRequests, spectrumRequestKeyFromControls } from "./analysisRequests.js";

function leaf(ids) {
  return { type: "leaf", tabs: ids, activeTab: ids[0] };
}

function state({ panelsById, panelOrder = Object.keys(panelsById), panelControlsById = {}, tree }) {
  return {
    tree: tree ?? leaf(panelOrder),
    panelsById,
    panelOrder,
    panelControlsById,
  };
}

describe("analysisRequests", () => {
  it("deduplicates identical spectrum requests", () => {
    const s = state({
      panelsById: {
        spectrum: { id: "spectrum", moduleId: "spectrum" },
        "spectrum-2": { id: "spectrum-2", moduleId: "spectrum" },
      },
    });

    const result = deriveAnalysisRequests(s);

    expect(result.spectrumRequests).toHaveLength(1);
    expect(result.spectrumRequests[0]).toMatchObject({
      key: "spectrum:pair:0:1:combined",
      panelIds: ["spectrum", "spectrum-2"],
    });
  });

  it("keeps different spectrum controls as different requests", () => {
    const s = state({
      panelsById: {
        spectrum: { id: "spectrum", moduleId: "spectrum" },
        "spectrum-2": { id: "spectrum-2", moduleId: "spectrum" },
      },
      panelControlsById: {
        spectrum: DEFAULT_PANEL_CONTROLS,
        "spectrum-2": {
          ...DEFAULT_PANEL_CONTROLS,
          spectrumChannel: { type: "single", ch: 2 },
        },
      },
    });

    expect(deriveAnalysisRequests(s).spectrumRequests.map((r) => r.key)).toEqual([
      "spectrum:pair:0:1:combined",
      "spectrum:single:2:combined",
    ]);
  });

  it("does not include peak hold in the spectrum request key", () => {
    expect(
      spectrumRequestKeyFromControls({ ...DEFAULT_PANEL_CONTROLS, spectrumPeakHold: false })
    ).toBe(spectrumRequestKeyFromControls({ ...DEFAULT_PANEL_CONTROLS, spectrumPeakHold: true }));
  });

  it("includes spectrogram in spectrum-like requests", () => {
    const s = state({
      panelsById: {
        spectrogram: { id: "spectrogram", moduleId: "spectrogram" },
      },
    });

    expect(deriveAnalysisRequests(s).spectrumRequests[0].panelIds).toEqual(["spectrogram"]);
  });

  it("derives vectorscope pair requests", () => {
    const s = state({
      panelsById: {
        vectorscope: { id: "vectorscope", moduleId: "vectorscope" },
      },
      panelControlsById: {
        vectorscope: {
          ...DEFAULT_PANEL_CONTROLS,
          vectorscopePair: { x: 1, y: 2 },
        },
      },
    });

    expect(deriveAnalysisRequests(s).vectorscopeRequests[0]).toMatchObject({
      key: "vectorscope:pair:1:2",
      pair: { x: 1, y: 2 },
      panelIds: ["vectorscope"],
    });
  });

  it("applies caps by unique request key in panel order", () => {
    const panelsById = Object.fromEntries(
      Array.from({ length: 5 }, (_, i) => [
        `spectrum-${i + 1}`,
        { id: `spectrum-${i + 1}`, moduleId: "spectrum" },
      ])
    );
    const panelOrder = Object.keys(panelsById);
    const panelControlsById = Object.fromEntries(
      panelOrder.map((id, i) => [
        id,
        {
          ...DEFAULT_PANEL_CONTROLS,
          spectrumChannel: { type: "single", ch: i },
        },
      ])
    );

    const result = deriveAnalysisRequests(state({ panelsById, panelOrder, panelControlsById }));

    expect(result.spectrumRequests).toHaveLength(4);
    expect(result.overCapSpectrumRequests).toHaveLength(1);
    expect(result.statusByPanelId["spectrum-5"]).toBe("overCap");
  });

  it("ignores stale panels not present in the tree", () => {
    const result = deriveAnalysisRequests(
      state({
        panelsById: {
          spectrum: { id: "spectrum", moduleId: "spectrum" },
          "spectrum-2": { id: "spectrum-2", moduleId: "spectrum" },
        },
        panelOrder: ["spectrum", "spectrum-2"],
        tree: leaf(["spectrum"]),
      })
    );

    expect(result.spectrumRequests[0].panelIds).toEqual(["spectrum"]);
  });
});
