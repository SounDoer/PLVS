import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS } from "../lib/panelControls.js";
import {
  MAX_STEREO_MAP_REQUESTS,
  deriveAnalysisRequests,
  deriveRetainedAnalysisKeys,
  spectrumRequestKeyFromControls,
  stereoMapRequestKeyFromControls,
} from "./analysisRequests.js";

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

function stereoMapControls(first, second, overrides = {}) {
  return {
    stereoMapPair: { x: first, y: second },
    stereoMapSpeedPercent: 25,
    stereoMapOctaveSmoothing: "1/12",
    ...overrides,
  };
}

describe("analysisRequests", () => {
  it("activates shared spectral Waveform analysis for either display toggle", () => {
    const makeState = (controls) =>
      state({
        panelsById: { waveform: { id: "waveform", moduleId: "waveform" } },
        panelControlsById: { waveform: { ...DEFAULT_PANEL_CONTROLS, ...controls } },
      });

    expect(deriveAnalysisRequests(makeState({})).spectralWaveform).toBe(false);
    expect(
      deriveAnalysisRequests(makeState({ waveformFrequencyColor: true })).spectralWaveform
    ).toBe(true);
    expect(deriveAnalysisRequests(makeState({ waveformCentroid: true })).spectralWaveform).toBe(
      true
    );
  });

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
      key: "spectrum:pair:0:1:combined:sp25:tilt300:smoff",
      panelIds: ["spectrum", "spectrum-2"],
      speedPercent: 25,
      tiltDbPerOctave: 3,
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
          spectrumView: "ms",
        },
      },
    });

    const requests = deriveAnalysisRequests(s).spectrumRequests;
    expect(requests.map((r) => r.key)).toEqual([
      "spectrum:pair:0:1:combined:sp25:tilt300:smoff",
      "spectrum:single:2:combined:sp25:tilt300:smoff",
    ]);
    expect(requests[1].view).toBe("combined");
  });

  it("does not include max hold in the spectrum request key", () => {
    expect(
      spectrumRequestKeyFromControls({ ...DEFAULT_PANEL_CONTROLS, spectrumMaxDecay: false })
    ).toBe(spectrumRequestKeyFromControls({ ...DEFAULT_PANEL_CONTROLS, spectrumMaxDecay: true }));
  });

  it("does not include Y-axis display controls in the spectrum request key", () => {
    expect(
      spectrumRequestKeyFromControls({
        ...DEFAULT_PANEL_CONTROLS,
        spectrumYMaxDb: -24,
        spectrumYRangeDb: 60,
      })
    ).toBe(spectrumRequestKeyFromControls(DEFAULT_PANEL_CONTROLS));
  });

  it("defines an independent four-request Stereo Map cap", () => {
    expect(MAX_STEREO_MAP_REQUESTS).toBe(4);
  });

  it("excludes every Stereo Map display-only control from the request key", () => {
    const measurementControls = {
      stereoMapPair: { x: 2, y: 3 },
      stereoMapSpeedPercent: 50,
      stereoMapOctaveSmoothing: "1/6",
    };
    const expected = stereoMapRequestKeyFromControls(measurementControls);

    expect(
      stereoMapRequestKeyFromControls({
        ...measurementControls,
        stereoMapMode: "correlation",
      })
    ).toBe(expected);
    expect(
      stereoMapRequestKeyFromControls({
        ...measurementControls,
        stereoMapHold: true,
      })
    ).toBe(expected);
    expect(
      stereoMapRequestKeyFromControls({
        ...measurementControls,
        stereoMapXMinFreq: 100,
        stereoMapXMaxFreq: 10000,
      })
    ).toBe(expected);
    expect(
      stereoMapRequestKeyFromControls({
        ...measurementControls,
        stereoMapMonoLossYMinDb: -60,
      })
    ).toBe(expected);
    expect(
      stereoMapRequestKeyFromControls({
        ...measurementControls,
        stereoMapMsRatioYMinDb: -96,
        stereoMapMsRatioYMaxDb: 48,
      })
    ).toBe(expected);
  });

  it("deduplicates matching Stereo Map Workspace instances", () => {
    const result = deriveAnalysisRequests(
      state({
        panelsById: {
          map: { id: "map", moduleId: "stereo-map" },
          "map-2": { id: "map-2", moduleId: "stereo-map" },
        },
        panelControlsById: {
          map: stereoMapControls(0, 1),
          "map-2": stereoMapControls(0, 1),
        },
      }),
      { channelCount: 2 }
    );

    expect(result.stereoMapRequests).toEqual([
      {
        key: "stereoMap:pair:0:1:sp25:sm12",
        panelIds: ["map", "map-2"],
        pair: { first: 0, second: 1 },
        speedPercent: 25,
        octaveSmoothing: "1/12",
      },
    ]);
  });

  it("deduplicates matching Workspace and future Dock Stereo Map instances", () => {
    const controls = stereoMapControls(0, 1);
    const result = deriveAnalysisRequests(
      state({
        panelsById: { map: { id: "map", moduleId: "stereo-map" } },
        panelControlsById: { map: controls },
      }),
      {
        channelCount: 2,
        additionalPanelInstances: [{ panelId: "dock-map", moduleId: "stereo-map", controls }],
      }
    );

    expect(result.stereoMapRequests).toHaveLength(1);
    expect(result.stereoMapRequests[0].panelIds).toEqual(["map", "dock:dock-map"]);
  });

  it("keeps matching Workspace and future Dock local panel ids status-independent", () => {
    const workspaceIds = ["map", "map-2", "map-3", "map-4"];
    const result = deriveAnalysisRequests(
      state({
        panelsById: Object.fromEntries(
          workspaceIds.map((id) => [id, { id, moduleId: "stereo-map" }])
        ),
        panelOrder: workspaceIds,
        panelControlsById: Object.fromEntries(
          workspaceIds.map((id, index) => [id, stereoMapControls(index, index + 1)])
        ),
      }),
      {
        channelCount: 6,
        additionalPanelInstances: [
          {
            panelId: "map",
            moduleId: "stereo-map",
            controls: stereoMapControls(4, 5),
          },
        ],
      }
    );

    expect(result.stereoMapRequests).toHaveLength(4);
    expect(result.overCapStereoMapRequests).toEqual([
      expect.objectContaining({ panelIds: ["dock:map"] }),
    ]);
    expect(result.statusByPanelId.map).toBe("active");
    expect(result.statusByPanelId["dock:map"]).toBe("overCap");
  });

  it("keeps same-key Workspace and future Dock panel identities distinct", () => {
    const controls = stereoMapControls(0, 1);
    const result = deriveAnalysisRequests(
      state({
        panelsById: { map: { id: "map", moduleId: "stereo-map" } },
        panelControlsById: { map: controls },
      }),
      {
        channelCount: 2,
        additionalPanelInstances: [{ panelId: "map", moduleId: "stereo-map", controls }],
      }
    );

    expect(result.stereoMapRequests[0].panelIds).toEqual(["map", "dock:map"]);
    expect(new Set(result.stereoMapRequests[0].panelIds).size).toBe(2);
  });

  it("admits four unique Stereo Map keys and marks the fifth over cap", () => {
    const panelOrder = Array.from({ length: 5 }, (_, index) => `map-${index + 1}`);
    const panelsById = Object.fromEntries(
      panelOrder.map((id) => [id, { id, moduleId: "stereo-map" }])
    );
    const panelControlsById = Object.fromEntries(
      panelOrder.map((id, index) => [id, stereoMapControls(index, index + 1)])
    );

    const result = deriveAnalysisRequests(state({ panelsById, panelOrder, panelControlsById }), {
      channelCount: 6,
    });

    expect(result.stereoMapRequests).toHaveLength(4);
    expect(result.overCapStereoMapRequests).toHaveLength(1);
    expect(result.statusByPanelId["map-5"]).toBe("overCap");
  });

  it("applies Spectrum and Stereo Map caps independently", () => {
    const spectrumIds = Array.from({ length: 4 }, (_, index) => `spectrum-${index + 1}`);
    const stereoMapIds = Array.from({ length: 4 }, (_, index) => `map-${index + 1}`);
    const panelOrder = [...spectrumIds, ...stereoMapIds];
    const panelsById = Object.fromEntries([
      ...spectrumIds.map((id) => [id, { id, moduleId: "spectrum" }]),
      ...stereoMapIds.map((id) => [id, { id, moduleId: "stereo-map" }]),
    ]);
    const panelControlsById = Object.fromEntries([
      ...spectrumIds.map((id, index) => [
        id,
        { ...DEFAULT_PANEL_CONTROLS, spectrumChannel: { type: "single", ch: index } },
      ]),
      ...stereoMapIds.map((id, index) => [id, stereoMapControls(index, index + 1)]),
    ]);

    const result = deriveAnalysisRequests(state({ panelsById, panelOrder, panelControlsById }), {
      channelCount: 5,
    });

    expect(result.spectrumRequests).toHaveLength(4);
    expect(result.stereoMapRequests).toHaveLength(4);
    expect(result.overCapSpectrumRequests).toEqual([]);
    expect(result.overCapStereoMapRequests).toEqual([]);
  });

  it("does not request Stereo Map for mono input or an unavailable pair", () => {
    const workspaceState = state({
      panelsById: { map: { id: "map", moduleId: "stereo-map" } },
      panelControlsById: { map: stereoMapControls(0, 1) },
    });

    expect(deriveAnalysisRequests(workspaceState, { channelCount: 1 }).stereoMapRequests).toEqual(
      []
    );

    const unavailablePairState = state({
      panelsById: { map: { id: "map", moduleId: "stereo-map" } },
      panelControlsById: { map: stereoMapControls(0, 2) },
    });
    expect(
      deriveAnalysisRequests(unavailablePairState, { channelCount: 2 }).stereoMapRequests
    ).toEqual([]);
  });

  it.each([undefined, 0, Number.NaN, 2.5])(
    "does not request Stereo Map for invalid effective channel count %s",
    (channelCount) => {
      const workspaceState = state({
        panelsById: { map: { id: "map", moduleId: "stereo-map" } },
        panelControlsById: { map: stereoMapControls(0, 1) },
      });

      expect(deriveAnalysisRequests(workspaceState, { channelCount }).stereoMapRequests).toEqual(
        []
      );
    }
  );

  it("does not count a fifth Stereo Map instance when its key is already admitted", () => {
    const workspaceIds = ["map-1", "map-2", "map-3", "map-4"];
    const result = deriveAnalysisRequests(
      state({
        panelsById: Object.fromEntries(
          workspaceIds.map((id) => [id, { id, moduleId: "stereo-map" }])
        ),
        panelOrder: workspaceIds,
        panelControlsById: Object.fromEntries(
          workspaceIds.map((id, index) => [id, stereoMapControls(index, index + 1)])
        ),
      }),
      {
        channelCount: 5,
        additionalPanelInstances: [
          {
            panelId: "duplicate",
            moduleId: "stereo-map",
            controls: stereoMapControls(0, 1),
          },
        ],
      }
    );

    expect(result.stereoMapRequests).toHaveLength(4);
    expect(result.overCapStereoMapRequests).toEqual([]);
    expect(result.stereoMapRequests[0].panelIds).toEqual(["map-1", "dock:duplicate"]);
    expect(result.statusByPanelId["dock:duplicate"]).toBe("active");
  });

  it("includes speed and tilt in the spectrum request key", () => {
    expect(
      spectrumRequestKeyFromControls({
        ...DEFAULT_PANEL_CONTROLS,
        spectrumSpeedPercent: 25,
        spectrumTiltDbPerOctave: 1.25,
      })
    ).toBe("spectrum:pair:0:1:combined:sp25:tilt125:smoff");
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

  it("deduplicates vectorscope modes that use the same pair", () => {
    const s = state({
      panelsById: {
        vectorscope: { id: "vectorscope", moduleId: "vectorscope" },
        "vectorscope-2": { id: "vectorscope-2", moduleId: "vectorscope" },
      },
      panelControlsById: {
        vectorscope: {
          ...DEFAULT_PANEL_CONTROLS,
          vectorscopeMode: "polarSample",
        },
        "vectorscope-2": {
          ...DEFAULT_PANEL_CONTROLS,
          vectorscopeMode: "polarLevel",
          vectorscopePolarLevelMaxHold: true,
        },
      },
    });

    expect(deriveAnalysisRequests(s).vectorscopeRequests).toEqual([
      {
        key: "vectorscope:pair:0:1",
        pair: { x: 0, y: 1 },
        panelIds: ["vectorscope", "vectorscope-2"],
      },
    ]);
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

  describe("deriveRetainedAnalysisKeys", () => {
    it("keeps a key per open panel, past the request cap", () => {
      // MAX_SPECTRUM_REQUESTS is 4. Five Spectrum panels with five distinct speeds are five
      // distinct keys; capRequests would drop the fifth, but the panel is still open and still
      // wants its history.
      const panelsById = {};
      const panelControlsById = {};
      for (let i = 0; i < 5; i += 1) {
        panelsById[`spec-${i}`] = { moduleId: "spectrum" };
        panelControlsById[`spec-${i}`] = {
          ...DEFAULT_PANEL_CONTROLS,
          spectrumSpeedPercent: 10 * (i + 1),
        };
      }
      const retained = deriveRetainedAnalysisKeys(state({ panelsById, panelControlsById }));
      expect(retained.spectrum.size).toBe(5);
    });

    it("puts Spectrogram panels in the Spectrum family", () => {
      const retained = deriveRetainedAnalysisKeys(
        state({
          panelsById: { spec: { moduleId: "spectrum" }, gram: { moduleId: "spectrogram" } },
          panelControlsById: {
            spec: { ...DEFAULT_PANEL_CONTROLS, spectrumView: "ms" },
            gram: { ...DEFAULT_PANEL_CONTROLS, spectrumView: "combined" },
          },
        })
      );
      expect(retained.spectrum.size).toBe(2);
      expect(retained.vectorscope.size).toBe(0);
    });

    it("keeps a Stereo Map key even when no channel pair is available", () => {
      // deriveAnalysisRequests gates Stereo Map on channelCount, because Rust cannot compute it
      // without a pair. Retention must not: channelCount comes from the live frame shape, so a
      // device blip would otherwise delete hours of history.
      const workspace = state({
        panelsById: { sm: { moduleId: "stereo-map" } },
        panelControlsById: { sm: DEFAULT_PANEL_CONTROLS },
      });
      expect(deriveAnalysisRequests(workspace, { channelCount: 1 }).stereoMapRequests).toHaveLength(
        0
      );
      expect(deriveRetainedAnalysisKeys(workspace).stereoMap).toContain(
        stereoMapRequestKeyFromControls(DEFAULT_PANEL_CONTROLS)
      );
    });

    it("ignores panels that are not in the tree", () => {
      const retained = deriveRetainedAnalysisKeys({
        tree: leaf(["spec"]),
        panelsById: { spec: { moduleId: "spectrum" }, gone: { moduleId: "vectorscope" } },
        panelOrder: ["spec", "gone"],
        panelControlsById: {},
      });
      expect(retained.spectrum.size).toBe(1);
      expect(retained.vectorscope.size).toBe(0);
    });
  });
});
