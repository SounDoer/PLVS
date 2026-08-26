import { describe, expect, it } from "vitest";
import { workspaceReducer } from "./reducer";
import { DEFAULT_WORKSPACE_STATE } from "./constants";
import { countLinkedParticipants, resolveAxisViewport } from "./axisViewports";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls";

const RANGE = { spectrum: ["spectrumXMinFreq", "spectrumXMaxFreq"] };

/** A workspace holding one panel per module id, each with its own controls. */
function stateWith(panels) {
  const panelsById = {};
  const panelControlsById = {};
  for (const [id, { moduleId, controls }] of Object.entries(panels)) {
    panelsById[id] = { id, moduleId };
    panelControlsById[id] = normalizePanelControls({ ...DEFAULT_PANEL_CONTROLS, ...controls });
  }
  return {
    ...DEFAULT_WORKSPACE_STATE,
    panelsById,
    panelOrder: Object.keys(panels),
    panelControlsById,
  };
}

const linkedSpectrum = { moduleId: "spectrum", controls: { linkFrequencyViewport: true } };
const unlinkedSpectrum = (min, max) => ({
  moduleId: "spectrum",
  controls: { linkFrequencyViewport: false, spectrumXMinFreq: min, spectrumXMaxFreq: max },
});
const unlinkedSpectrogram = (min, max) => ({
  moduleId: "spectrogram",
  controls: { linkFrequencyViewport: false, spectrogramYMinFreq: min, spectrogramYMaxFreq: max },
});

describe("countLinkedParticipants", () => {
  it("counts only members of the kind that are linked", () => {
    const state = stateWith({
      a: linkedSpectrum,
      b: unlinkedSpectrum(200, 5000),
      c: { moduleId: "levelMeter", controls: { linkFrequencyViewport: true } },
    });

    expect(countLinkedParticipants(state, "frequency")).toBe(1);
  });

  it("can leave one panel out of the count", () => {
    const state = stateWith({ a: linkedSpectrum, b: { ...linkedSpectrum } });

    expect(countLinkedParticipants(state, "frequency", "a")).toBe(1);
  });
});

describe("SET_AXIS_VIEWPORT", () => {
  it("repairs what it is given", () => {
    const next = workspaceReducer(stateWith({ a: linkedSpectrum }), {
      type: "SET_AXIS_VIEWPORT",
      payload: { kindId: "frequency", range: { min: 1, max: 90000 } },
    });

    expect(next.axisViewports.frequency).toEqual({ min: 20, max: 20000 });
  });

  it("leaves dormant local ranges alone", () => {
    const state = stateWith({ a: unlinkedSpectrum(200, 5000) });
    const next = workspaceReducer(state, {
      type: "SET_AXIS_VIEWPORT",
      payload: { kindId: "frequency", range: { min: 1000, max: 8000 } },
    });

    expect(next.panelControlsById.a.spectrumXMinFreq).toBe(200);
    expect(next.panelControlsById.a.spectrumXMaxFreq).toBe(5000);
  });
});

describe("JOIN_AXIS_VIEWPORT", () => {
  it("seeds the shared viewport from the first panel to join", () => {
    const state = stateWith({ a: unlinkedSpectrum(200, 5000) });
    const next = workspaceReducer(state, {
      type: "JOIN_AXIS_VIEWPORT",
      payload: { kindId: "frequency", panelId: "a" },
    });

    expect(next.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
    expect(next.panelControlsById.a.linkFrequencyViewport).toBe(true);
  });

  it("adopts the group's viewport when one already exists", () => {
    const state = {
      ...stateWith({ a: linkedSpectrum, b: unlinkedSpectrogram(200, 5000) }),
      axisViewports: { frequency: { min: 1000, max: 8000 } },
    };
    const next = workspaceReducer(state, {
      type: "JOIN_AXIS_VIEWPORT",
      payload: { kindId: "frequency", panelId: "b" },
    });

    expect(next.axisViewports.frequency).toEqual({ min: 1000, max: 8000 });
    expect(resolveAxisViewport(next, "b", "frequency")).toEqual({
      min: 1000,
      max: 8000,
      linked: true,
    });
  });

  it("keeps the joiner's local range dormant rather than overwriting it", () => {
    const state = {
      ...stateWith({ a: linkedSpectrum, b: unlinkedSpectrogram(200, 5000) }),
      axisViewports: { frequency: { min: 1000, max: 8000 } },
    };
    const next = workspaceReducer(state, {
      type: "JOIN_AXIS_VIEWPORT",
      payload: { kindId: "frequency", panelId: "b" },
    });

    expect(next.panelControlsById.b.spectrogramYMinFreq).toBe(200);
    expect(next.panelControlsById.b.spectrogramYMaxFreq).toBe(5000);
  });

  it("ignores a panel that is not a member of the kind", () => {
    const state = stateWith({ a: { moduleId: "levelMeter", controls: {} } });

    expect(
      workspaceReducer(state, {
        type: "JOIN_AXIS_VIEWPORT",
        payload: { kindId: "frequency", panelId: "a" },
      })
    ).toBe(state);
  });
});

describe("LEAVE_AXIS_VIEWPORT", () => {
  it("copies the shared viewport into the leaver's local range", () => {
    const state = {
      ...stateWith({ a: linkedSpectrum, b: { ...linkedSpectrum } }),
      axisViewports: { frequency: { min: 1000, max: 8000 } },
    };
    const next = workspaceReducer(state, {
      type: "LEAVE_AXIS_VIEWPORT",
      payload: { kindId: "frequency", panelId: "a" },
    });

    // The panel looks unchanged at the moment it unlinks, and diverges only on its next gesture.
    expect(next.panelControlsById.a.linkFrequencyViewport).toBe(false);
    expect(resolveAxisViewport(next, "a", "frequency")).toEqual({
      min: 1000,
      max: 8000,
      linked: false,
    });
  });

  it("leaves the other participants where they were", () => {
    const state = {
      ...stateWith({ a: linkedSpectrum, b: { ...linkedSpectrum } }),
      axisViewports: { frequency: { min: 1000, max: 8000 } },
    };
    const next = workspaceReducer(state, {
      type: "LEAVE_AXIS_VIEWPORT",
      payload: { kindId: "frequency", panelId: "a" },
    });

    expect(resolveAxisViewport(next, "b", "frequency")).toEqual({
      min: 1000,
      max: 8000,
      linked: true,
    });
  });

  it("does not revive a dormant shared value when the group re-forms", () => {
    const emptied = workspaceReducer(
      {
        ...stateWith({ a: linkedSpectrum }),
        axisViewports: { frequency: { min: 1000, max: 8000 } },
      },
      { type: "LEAVE_AXIS_VIEWPORT", payload: { kindId: "frequency", panelId: "a" } }
    );
    const rejoined = workspaceReducer(
      {
        ...emptied,
        panelControlsById: {
          a: normalizePanelControls({
            ...emptied.panelControlsById.a,
            spectrumXMinFreq: 200,
            spectrumXMaxFreq: 5000,
          }),
        },
      },
      { type: "JOIN_AXIS_VIEWPORT", payload: { kindId: "frequency", panelId: "a" } }
    );

    expect(rejoined.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
  });
});

describe("resolveAxisViewport", () => {
  it("reads the shared value while linked and the local one after", () => {
    const state = {
      ...stateWith({ a: unlinkedSpectrum(200, 5000) }),
      axisViewports: { frequency: { min: 1000, max: 8000 } },
    };

    expect(resolveAxisViewport(state, "a", "frequency")).toEqual({
      min: 200,
      max: 5000,
      linked: false,
    });

    const joined = workspaceReducer(state, {
      type: "JOIN_AXIS_VIEWPORT",
      payload: { kindId: "frequency", panelId: "a" },
    });
    expect(resolveAxisViewport(joined, "a", "frequency").linked).toBe(true);
  });

  it("reports nothing for a panel outside the kind", () => {
    const state = stateWith({ a: { moduleId: "levelMeter", controls: {} } });

    expect(resolveAxisViewport(state, "a", "frequency")).toBeNull();
  });

  it("names each member's own control keys", () => {
    // Guards the mapping the adapter depends on, per module rather than per axis orientation.
    const state = stateWith({ a: unlinkedSpectrum(200, 5000) });
    const [minKey, maxKey] = RANGE.spectrum;

    expect(state.panelControlsById.a[minKey]).toBe(200);
    expect(state.panelControlsById.a[maxKey]).toBe(5000);
  });
});
