import { describe, expect, it } from "vitest";
import { getPeakMeterChannelLabels } from "../math/peakMeterChannelLabels.js";
import {
  buildSpectrumChannelOptions,
  clampSpectrumChannelToAvailable,
} from "../math/spectrumChannelOptions.js";
import { clampVectorscopePairToAvailable } from "../math/vectorscopePairMath.js";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import {
  channelTopologyKnown,
  effectiveWorkspaceState,
  resolveEffectiveChannelControls,
} from "./effectiveChannels.js";
import {
  deriveRetainedAnalysisKeys,
  spectrumRequestKeyFromControls,
  unionRetainedAnalysisKeys,
} from "./analysisRequests.js";

function topology(channelCount) {
  const n = channelCount >= 2 ? channelCount : 2;
  return {
    channelCount,
    spectrumChannelOptions: buildSpectrumChannelOptions(n, getPeakMeterChannelLabels(n, {})),
    peakLabelContext: {},
  };
}

/** @type {{ spectrumChannel: { type: "pair", x: number, y: number } }} */
const SPECTRUM_5_6 = { spectrumChannel: { type: "pair", x: 4, y: 5 } };

describe("resolveEffectiveChannelControls", () => {
  it("keeps an available request as the very same object", () => {
    const controls = { ...SPECTRUM_5_6 };
    const resolved = resolveEffectiveChannelControls("spectrum", controls, topology(8));
    expect(resolved).toEqual({ controls, unavailable: false });
    expect(resolved.controls).toBe(controls);
  });

  it.each(["spectrum", "spectrogram"])(
    "falls back for %s exactly as the clamp did, without touching the request",
    (moduleId) => {
      const controls = { ...SPECTRUM_5_6, spectrumView: "ms" };
      const current = topology(2);
      const resolved = resolveEffectiveChannelControls(moduleId, controls, current);
      expect(resolved.unavailable).toBe(true);
      expect(resolved.controls).toEqual({
        ...controls,
        spectrumChannel: clampSpectrumChannelToAvailable(
          controls.spectrumChannel,
          current.spectrumChannelOptions
        ),
      });
      expect(controls.spectrumChannel).toEqual({ type: "pair", x: 4, y: 5 });
    }
  );

  it("falls back for an unavailable single channel", () => {
    const resolved = resolveEffectiveChannelControls(
      "spectrum",
      { spectrumChannel: { type: "single", ch: 3 } },
      topology(2)
    );
    expect(resolved.unavailable).toBe(true);
    expect(resolved.controls.spectrumChannel).toEqual({ type: "pair", x: 0, y: 1 });
  });

  it.each([
    ["vectorscope", "vectorscopePair"],
    ["correlation", "vectorscopePair"],
    ["stereo-map", "stereoMapPair"],
    ["stereoMap", "stereoMapPair"],
  ])("falls back for a %s pair as the clamp did", (moduleId, field) => {
    const controls = { [field]: { x: 4, y: 5 } };
    const resolved = resolveEffectiveChannelControls(moduleId, controls, topology(2));
    expect(resolved.unavailable).toBe(true);
    expect(resolved.controls[field]).toEqual(clampVectorscopePairToAvailable({ x: 4, y: 5 }, 2));
  });

  it("follows the channel labels for a Vectorscope pair, not only the count", () => {
    const sixChannels = topology(6);
    const options = [{ x: 0, y: 1 }, clampVectorscopePairToAvailable({ x: 4, y: 5 }, 6, {})];
    for (const pair of options) {
      expect(
        resolveEffectiveChannelControls("vectorscope", { vectorscopePair: pair }, sixChannels)
          .unavailable
      ).toBe(false);
    }
    expect(
      resolveEffectiveChannelControls(
        "vectorscope",
        { vectorscopePair: { x: 4, y: 4 } },
        sixChannels
      ).unavailable
    ).toBe(true);
  });

  it.each([0, undefined, Number.NaN])(
    "keeps the request while the channel count is unknown (%s)",
    (channelCount) => {
      const controls = { ...SPECTRUM_5_6 };
      const current = { ...topology(2), channelCount };
      expect(channelTopologyKnown(current)).toBe(false);
      expect(resolveEffectiveChannelControls("spectrum", controls, current).controls).toBe(
        controls
      );
    }
  );

  it("ignores modules without a channel selection", () => {
    const controls = { levelMeterMode: "rms" };
    expect(resolveEffectiveChannelControls("levelMeter", controls, topology(2)).controls).toBe(
      controls
    );
  });
});

describe("effectiveWorkspaceState", () => {
  /** @type {any} */
  const state = {
    ...DEFAULT_WORKSPACE_STATE,
    panelControlsById: {
      ...DEFAULT_WORKSPACE_STATE.panelControlsById,
      spectrum: { ...DEFAULT_WORKSPACE_STATE.panelControlsById.spectrum, ...SPECTRUM_5_6 },
    },
  };

  it("resolves only the panels that fall back and leaves the stored state alone", () => {
    const resolved = effectiveWorkspaceState(state, topology(2));
    expect(resolved).not.toBe(state);
    expect(resolved.panelControlsById.spectrum.spectrumChannel).toEqual({
      type: "pair",
      x: 0,
      y: 1,
    });
    expect(resolved.panelControlsById.levelMeter).toBe(state.panelControlsById.levelMeter);
    expect(state.panelControlsById.spectrum.spectrumChannel).toEqual({ type: "pair", x: 4, y: 5 });
  });

  it("returns the same state when nothing falls back or the topology is unknown", () => {
    expect(effectiveWorkspaceState(state, topology(8))).toBe(state);
    expect(effectiveWorkspaceState(state, { ...topology(2), channelCount: 0 })).toBe(state);
  });
});

describe("retained keys for a panel falling back", () => {
  it("keep the request's history and the fallback's", () => {
    /** @type {any} */
    const state = {
      ...DEFAULT_WORKSPACE_STATE,
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        spectrum: { ...DEFAULT_WORKSPACE_STATE.panelControlsById.spectrum, ...SPECTRUM_5_6 },
      },
    };
    const effective = effectiveWorkspaceState(state, topology(2));
    const retained = unionRetainedAnalysisKeys(
      deriveRetainedAnalysisKeys(state),
      deriveRetainedAnalysisKeys(effective)
    );

    expect(retained.spectrum).toContain(
      spectrumRequestKeyFromControls(state.panelControlsById.spectrum)
    );
    expect(retained.spectrum).toContain(
      spectrumRequestKeyFromControls(effective.panelControlsById.spectrum)
    );
  });
});
