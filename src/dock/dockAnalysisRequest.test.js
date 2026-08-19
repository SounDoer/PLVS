import { describe, expect, it } from "vitest";
import {
  MAX_SPECTRUM_REQUESTS,
  MAX_STEREO_MAP_REQUESTS,
  MAX_VECTORSCOPE_REQUESTS,
  deriveAnalysisRequests,
} from "../analysis/analysisRequests.js";
import {
  DOCK_SPECTRUM_KEY,
  DOCK_STEREO_MAP_KEY,
  DOCK_VECTORSCOPE_KEY,
  dockSpectrumKey,
  dockStereoMapKey,
  dockVectorscopeKey,
  mergeDockAnalysisRequests,
  mergeDockSpectrumRequest,
} from "./dockAnalysisRequest.js";

const EMPTY_DERIVED = deriveAnalysisRequests({ tree: null, panelsById: {}, panelOrder: [] });

describe("mergeDockSpectrumRequest", () => {
  it("is a no-op when dock spectrum is inactive", () => {
    expect(mergeDockSpectrumRequest(EMPTY_DERIVED, false)).toBe(EMPTY_DERIVED);
  });

  it("adds the default spectrum request when active", () => {
    const merged = mergeDockSpectrumRequest(EMPTY_DERIVED, true);
    expect(merged.spectrumRequests).toHaveLength(1);
    const req = merged.spectrumRequests[0];
    expect(req.key).toBe(DOCK_SPECTRUM_KEY);
    expect(req.panelIds).toEqual(["dock:spectrum"]);
    expect(req.channel).toBeTruthy();
    expect(typeof req.speedPercent).toBe("number");
    expect(req.octaveSmoothing).toBe("off");
    expect(typeof req.tiltDbPerOctave).toBe("number");
  });

  it("does not duplicate an existing request with the same key", () => {
    const derived = {
      ...EMPTY_DERIVED,
      spectrumRequests: [{ key: DOCK_SPECTRUM_KEY, panelIds: ["panel-1"] }],
    };
    const merged = mergeDockSpectrumRequest(derived, true);
    expect(merged.spectrumRequests).toHaveLength(1);
    expect(merged.spectrumRequests[0].panelIds).toEqual(["panel-1"]);
  });

  it("derives distinct requests from Dock spectrum and spectrogram channels", () => {
    const spectrum = { channel: { type: "pair", x: 0, y: 1 }, view: "lr" };
    const spectrogram = { channel: { type: "single", ch: 3 } };
    const merged = mergeDockSpectrumRequest(EMPTY_DERIVED, { spectrum, spectrogram });
    expect(merged.spectrumRequests.map((request) => request.key)).toEqual([
      dockSpectrumKey(spectrum),
      dockSpectrumKey(spectrogram),
    ]);
    expect(merged.spectrumRequests[1].panelIds).toEqual(["dock:spectrogram"]);
  });

  it("evicts the tail request when already at the spectrum cap", () => {
    // A full workspace: MAX_SPECTRUM_REQUESTS distinct spectrum requests, none
    // the dock key. Appending would exceed the cap and Rust would reject the set.
    const full = Array.from({ length: MAX_SPECTRUM_REQUESTS }, (_, i) => ({
      key: `panel-key-${i}`,
      panelIds: [`panel-${i}`],
    }));
    const derived = { ...EMPTY_DERIVED, spectrumRequests: full };
    const merged = mergeDockSpectrumRequest(derived, true);

    expect(merged.spectrumRequests).toHaveLength(MAX_SPECTRUM_REQUESTS);
    // Dock request present.
    expect(merged.spectrumRequests.some((r) => r.key === DOCK_SPECTRUM_KEY)).toBe(true);
    // Former tail evicted; earlier requests preserved.
    const keys = merged.spectrumRequests.map((r) => r.key);
    expect(keys).not.toContain(`panel-key-${MAX_SPECTRUM_REQUESTS - 1}`);
    expect(keys).toContain("panel-key-0");
  });
});

describe("mergeDockAnalysisRequests", () => {
  it("ORs Dock Waveform spectral needs into the shared request", () => {
    const off = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      { panelId: "waveform", moduleId: "waveform", controls: {} },
    ]);
    expect(off.spectralWaveform).toBe(false);

    const on = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      { panelId: "waveform", moduleId: "waveform", controls: { centroid: true } },
    ]);
    expect(on.spectralWaveform).toBe(true);
  });

  it("adds a configured Dock vectorscope request", () => {
    const controls = { pair: { x: 2, y: 3 } };
    const merged = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      { panelId: "vectorscope", moduleId: "vectorscope", controls },
    ]);
    expect(merged.vectorscopeRequests).toEqual([
      {
        key: dockVectorscopeKey(controls),
        panelIds: ["dock:vectorscope"],
        pair: { x: 2, y: 3 },
      },
    ]);
  });

  it("deduplicates matching Dock vectorscope pairs", () => {
    const merged = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      { panelId: "vectorscope", moduleId: "vectorscope", controls: { pair: { x: 0, y: 1 } } },
      {
        panelId: "vectorscope-2",
        moduleId: "vectorscope",
        controls: { pair: { x: 0, y: 1 } },
      },
    ]);
    expect(merged.vectorscopeRequests).toEqual([
      {
        key: DOCK_VECTORSCOPE_KEY,
        panelIds: ["dock:vectorscope", "dock:vectorscope-2"],
        pair: { x: 0, y: 1 },
      },
    ]);
  });

  it("keeps the Dock vectorscope request within the backend cap", () => {
    const derived = {
      ...EMPTY_DERIVED,
      vectorscopeRequests: Array.from({ length: MAX_VECTORSCOPE_REQUESTS }, (_, index) => ({
        key: `vectorscope:pair:${index}:${index + 1}`,
        panelIds: [`panel-${index}`],
      })),
    };
    const merged = mergeDockAnalysisRequests(derived, [
      {
        panelId: "vectorscope",
        moduleId: "vectorscope",
        controls: { pair: { x: 8, y: 9 } },
      },
    ]);
    expect(merged.vectorscopeRequests).toHaveLength(MAX_VECTORSCOPE_REQUESTS);
    expect(merged.vectorscopeRequests.at(-1)?.key).toBe("vectorscope:pair:8:9");
  });

  it("adds a configured Dock Stereo Map request", () => {
    const controls = { pair: { x: 2, y: 3 } };
    const merged = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      { panelId: "stereo-map", moduleId: "stereo-map", controls },
    ]);
    expect(merged.stereoMapRequests).toEqual([
      {
        key: dockStereoMapKey(controls),
        panelIds: ["dock:stereo-map"],
        pair: { first: 2, second: 3 },
        speedPercent: 50,
        octaveSmoothing: "1/12",
      },
    ]);
  });

  it("deduplicates matching Dock Stereo Map Pair + Speed + Smoothing onto one request", () => {
    const merged = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      {
        panelId: "stereo-map",
        moduleId: "stereo-map",
        controls: { pair: { x: 0, y: 1 }, speedPercent: 40, octaveSmoothing: "1/6" },
      },
      {
        panelId: "stereo-map-2",
        moduleId: "stereo-map",
        controls: { pair: { x: 0, y: 1 }, speedPercent: 40, octaveSmoothing: "1/6" },
      },
    ]);
    expect(merged.stereoMapRequests).toHaveLength(1);
    expect(merged.stereoMapRequests[0].panelIds).toEqual(["dock:stereo-map", "dock:stereo-map-2"]);
  });

  it("does not fold Dock Stereo Map requests that differ only by Mode, Hold, or range into one key", () => {
    // The Analysis Key is Pair + Speed + Smoothing only (Mode/Hold/ranges are frontend-only), so
    // two panels differing solely by Mode/Hold/X-Y range must still land on the same request.
    const merged = mergeDockAnalysisRequests(EMPTY_DERIVED, [
      {
        panelId: "stereo-map",
        moduleId: "stereo-map",
        controls: {
          pair: { x: 0, y: 1 },
          mode: "correlation",
          hold: false,
          minFreq: 20,
          maxFreq: 20000,
        },
      },
      {
        panelId: "stereo-map-2",
        moduleId: "stereo-map",
        controls: {
          pair: { x: 0, y: 1 },
          mode: "msRatioDb",
          hold: true,
          minFreq: 200,
          maxFreq: 2000,
        },
      },
    ]);
    expect(merged.stereoMapRequests).toHaveLength(1);
    expect(merged.stereoMapRequests[0].key).toBe(DOCK_STEREO_MAP_KEY);
    expect(merged.stereoMapRequests[0].panelIds).toEqual(["dock:stereo-map", "dock:stereo-map-2"]);
  });

  it("keeps the Dock Stereo Map request within its own independent backend cap", () => {
    const derived = {
      ...EMPTY_DERIVED,
      stereoMapRequests: Array.from({ length: MAX_STEREO_MAP_REQUESTS }, (_, index) => ({
        key: `stereoMap:pair:${index}:${index + 1}:sp50:sm12`,
        panelIds: [`panel-${index}`],
      })),
    };
    const merged = mergeDockAnalysisRequests(derived, [
      {
        panelId: "stereo-map",
        moduleId: "stereo-map",
        controls: { pair: { x: 8, y: 9 } },
      },
    ]);
    expect(merged.stereoMapRequests).toHaveLength(MAX_STEREO_MAP_REQUESTS);
    expect(merged.stereoMapRequests.at(-1)?.key).toBe("stereoMap:pair:8:9:sp50:sm12");
  });
});
