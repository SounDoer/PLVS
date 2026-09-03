import { describe, expect, it } from "vitest";
import { DEFAULT_PANEL_CONTROLS, normalizePanelControls } from "../lib/panelControls.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import {
  buildAxisInspection,
  buildAxisSchema,
  planPanelAxisReset,
  planPanelAxisUpdate,
  planSharedAxisReset,
  planSharedAxisUpdate,
} from "./axisControl.js";

function workspaceWith(controlsById = {}, axisViewports = DEFAULT_WORKSPACE_STATE.axisViewports) {
  return {
    ...DEFAULT_WORKSPACE_STATE,
    axisViewports,
    panelControlsById: Object.fromEntries(
      Object.entries(DEFAULT_WORKSPACE_STATE.panelControlsById).map(([id, controls]) => [
        id,
        normalizePanelControls({ ...controls, ...(controlsById[id] ?? {}) }),
      ])
    ),
  };
}

describe("Axis Control schemas and inspection", () => {
  it("describes fixed frequency and dynamic time bounds", () => {
    expect(buildAxisSchema({ timeMaxWindowSec: 3600, timeMaxOffsetSec: 3540 })).toMatchObject({
      frequency: {
        default: { minHz: 20, maxHz: 20000 },
        properties: { minHz: { minimum: 20 }, maxHz: { maximum: 20000 } },
        modules: ["spectrum", "spectrogram", "stereo-map"],
      },
      time: {
        default: { windowSec: 60, offsetSec: 0 },
        properties: {
          windowSec: { minimum: 5, maximum: 3600 },
          offsetSec: { minimum: 0, maximum: 3540 },
        },
      },
    });
  });

  it("reports shared and dormant local ranges for every participating panel", () => {
    const workspace = workspaceWith({
      spectrum: {
        linkFrequencyViewport: false,
        spectrumXMinFreq: 200,
        spectrumXMaxFreq: 5000,
      },
    });
    const inspected = buildAxisInspection(workspace);
    const spectrum = inspected.panels.find(({ id }) => id === "spectrum");

    expect(inspected.shared.frequency).toEqual({ minHz: 20, maxHz: 20000 });
    expect(spectrum.axes.frequency).toEqual({
      linked: false,
      source: "panel",
      range: { minHz: 200, maxHz: 5000 },
      dormantLocalRange: { minHz: 200, maxHz: 5000 },
    });
  });
});

describe("shared Axis Control planning", () => {
  it("updates a shared viewport without changing unlinked local ranges", () => {
    const workspace = workspaceWith({
      spectrum: {
        linkFrequencyViewport: false,
        spectrumXMinFreq: 200,
        spectrumXMaxFreq: 5000,
      },
    });
    const planned = planSharedAxisUpdate(workspace, "frequency", {
      minHz: 1000,
      maxHz: 8000,
    });

    expect(planned.issues).toEqual([]);
    expect(planned.changed).toEqual(["shared.frequency.minHz", "shared.frequency.maxHz"]);
    expect(planned.workspace.axisViewports.frequency).toEqual({ min: 1000, max: 8000 });
    expect(planned.workspace.panelControlsById.spectrum.spectrumXMinFreq).toBe(200);
  });

  it("rejects all independently discoverable range problems atomically", () => {
    const workspace = workspaceWith();
    const planned = planSharedAxisUpdate(workspace, "frequency", {
      minHz: 0,
      maxHz: 0,
      extra: true,
    });

    expect(planned.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unknownField", path: "$.range.extra" }),
        expect.objectContaining({ code: "outOfRange", path: "$.range" }),
      ])
    );
    expect(planned.workspace).toBe(workspace);
    expect(planned.changed).toEqual([]);
  });

  it("resets only the named shared viewport", () => {
    const workspace = workspaceWith(
      {},
      {
        frequency: { min: 200, max: 5000 },
        time: { windowSec: 30, offsetSec: 10 },
      }
    );
    const planned = planSharedAxisReset(workspace, "frequency");

    expect(planned.workspace.axisViewports.frequency).toEqual({ min: 20, max: 20000 });
    expect(planned.workspace.axisViewports.time).toEqual({ windowSec: 30, offsetSec: 10 });
  });
});

describe("panel Axis Control planning", () => {
  it("unlinks while preserving the effective shared range, then applies a local range", () => {
    const workspace = workspaceWith(
      {},
      {
        ...DEFAULT_WORKSPACE_STATE.axisViewports,
        frequency: { min: 1000, max: 8000 },
      }
    );
    const planned = planPanelAxisUpdate(workspace, "spectrum", "frequency", {
      linked: false,
      range: { minHz: 200, maxHz: 5000 },
    });

    expect(planned.issues).toEqual([]);
    expect(planned.changed).toEqual([
      "panels.spectrum.frequency.linked",
      "panels.spectrum.frequency.range.minHz",
      "panels.spectrum.frequency.range.maxHz",
    ]);
    expect(planned.workspace.panelControlsById.spectrum).toMatchObject({
      linkFrequencyViewport: false,
      spectrumXMinFreq: 200,
      spectrumXMaxFreq: 5000,
    });
  });

  it("refuses a local range when the panel remains linked", () => {
    const workspace = workspaceWith();
    const planned = planPanelAxisUpdate(workspace, "spectrum", "frequency", {
      range: { minHz: 200, maxHz: 5000 },
    });

    expect(planned.issues).toEqual([
      expect.objectContaining({ code: "rangeWhileLinked", path: "$.range" }),
    ]);
    expect(planned.workspace).toBe(workspace);
  });

  it("seeds the group from the first joining panel and otherwise adopts the group", () => {
    const emptyGroup = workspaceWith({
      spectrum: {
        linkFrequencyViewport: false,
        spectrumXMinFreq: 200,
        spectrumXMaxFreq: 5000,
      },
      spectrogram: { linkFrequencyViewport: false },
      "stereo-map": { linkFrequencyViewport: false },
    });
    const first = planPanelAxisUpdate(emptyGroup, "spectrum", "frequency", { linked: true });
    expect(first.workspace.axisViewports.frequency).toEqual({ min: 200, max: 5000 });

    const next = planPanelAxisUpdate(first.workspace, "spectrogram", "frequency", { linked: true });
    expect(next.workspace.axisViewports.frequency).toEqual({ min: 200, max: 5000 });
    expect(next.workspace.panelControlsById.spectrogram.spectrogramYMinFreq).toBe(20);
  });

  it("resets dormant local state and links without changing an existing group", () => {
    const workspace = workspaceWith(
      {
        spectrum: { linkFrequencyViewport: true },
        spectrogram: {
          linkFrequencyViewport: false,
          spectrogramYMinFreq: 200,
          spectrogramYMaxFreq: 5000,
        },
      },
      {
        ...DEFAULT_WORKSPACE_STATE.axisViewports,
        frequency: { min: 1000, max: 8000 },
      }
    );
    const planned = planPanelAxisReset(workspace, "spectrogram", "frequency");

    expect(planned.workspace.axisViewports.frequency).toEqual({ min: 1000, max: 8000 });
    expect(planned.workspace.panelControlsById.spectrogram).toMatchObject({
      linkFrequencyViewport: true,
      spectrogramYMinFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMinFreq,
      spectrogramYMaxFreq: DEFAULT_PANEL_CONTROLS.spectrogramYMaxFreq,
    });
  });
});
