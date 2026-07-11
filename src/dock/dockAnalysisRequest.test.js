import { describe, expect, it } from "vitest";
import { deriveAnalysisRequests } from "../analysis/analysisRequests.js";
import { DOCK_SPECTRUM_KEY, mergeDockSpectrumRequest } from "./dockAnalysisRequest.js";

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
    expect(typeof req.smoothingPercent).toBe("number");
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
});
