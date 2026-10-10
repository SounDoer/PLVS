import { describe, expect, it } from "vitest";
import { selectPolarWindow, aggregatePolarLevel } from "../math/vectorscopePolarMath.js";
import { COMMUNITY_PREVIEW_FIXTURE_V4 } from "../transfer/fixtures/communityPreviewV4.js";
import { buildDefaultCommunityPreviewAnalysisRequests } from "./defaultAnalysisRequests.js";
import { buildCommunityPreviewFixtureValues } from "./fixture.js";

const defaultRequests = buildDefaultCommunityPreviewAnalysisRequests();
const vectorscopeKey = defaultRequests.vectorscope[0].key;
const combinedKey = defaultRequests.spectrum.find(({ view }) => view === "combined").key;
const msKey = defaultRequests.spectrum.find(({ view }) => view === "ms").key;

describe("Community Vectorscope preview data", () => {
  it("supplies deterministic non-silent stereo history for Polar Sample and Polar Level", () => {
    const build = () => buildCommunityPreviewFixtureValues(COMMUNITY_PREVIEW_FIXTURE_V4);
    const history = build().historyData.getVectorscopeHistoryForKey(vectorscopeKey);
    const rows = selectPolarWindow(history, 400);
    expect(rows).toHaveLength(5);
    expect(rows.at(-1).timestampMs).toBe(COMMUNITY_PREVIEW_FIXTURE_V4.clock.durationMs);
    expect(rows.every(({ pairs }) => pairs.length === 200 && pairs.every(Number.isFinite))).toBe(
      true
    );
    expect(rows.some(({ pairs }) => pairs.some((value) => Math.abs(value) > 0.1))).toBe(true);
    expect(aggregatePolarLevel(rows).some((value) => value > 0)).toBe(true);
    expect(history.rowAt(0).pairs).toEqual(
      build().historyData.getVectorscopeHistoryForKey(vectorscopeKey).rowAt(0).pairs
    );
    expect(history.rowAt(0).pairs[2]).not.toBe(history.rowAt(0).pairs[3]);
  });

  it("uses measured Discovery data instead of interpolated display curves", () => {
    const values = buildCommunityPreviewFixtureValues(COMMUNITY_PREVIEW_FIXTURE_V4);
    expect(COMMUNITY_PREVIEW_FIXTURE_V4.source).toMatchObject({
      fileName: "discovery-hero.wav",
      windowStartMs: 63000,
      windowEndMs: 78000,
    });
    expect(values.historyData.histSourceList).toHaveLength(151);
    expect(values.historyData.visualWaveformHist).toHaveLength(151);
    expect(
      values.frameData.displayAudio.spectrumResultsByKey[combinedKey].bandCentersHz.length
    ).toBeGreaterThan(200);
    expect(values.historyData.getSpectrogramSnapsForKey(combinedKey).length).toBe(31);
  });

  it("derives and stores only the analysis requests used by the real Default Preset", () => {
    expect(COMMUNITY_PREVIEW_FIXTURE_V4.analysisRequests).toEqual(defaultRequests);
    const values = buildCommunityPreviewFixtureValues(COMMUNITY_PREVIEW_FIXTURE_V4);
    const results = values.frameData.displayAudio.spectrumResultsByKey;
    const combined = results[combinedKey];
    const ms = results[msKey];

    expect(combined.smoothDb).toHaveLength(combined.bandCentersHz.length);
    expect(combined.smoothDbB).toHaveLength(0);
    expect(ms.smoothDbB).toHaveLength(ms.bandCentersHz.length);
    expect(ms.smoothDbB).not.toEqual(ms.smoothDb);
    expect(results["spectrum:pair:0:1:lr:sp25:smoff"]).toBeUndefined();
    expect(
      values.historyData.getSpectrogramSnapsForKey("spectrum:pair:0:1:lr:sp25:smoff")
    ).toHaveLength(0);
  });
});
