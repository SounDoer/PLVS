import { describe, expect, it } from "vitest";
import { selectPolarWindow, aggregatePolarLevel } from "../math/vectorscopePolarMath.js";
import { COMMUNITY_PREVIEW_FIXTURE_V3 } from "../transfer/fixtures/communityPreviewV3.js";
import { buildCommunityPreviewFixtureValues } from "./fixture.js";

describe("Community Vectorscope preview data", () => {
  it("supplies deterministic non-silent stereo history for Polar Sample and Polar Level", () => {
    const build = () => buildCommunityPreviewFixtureValues(COMMUNITY_PREVIEW_FIXTURE_V3);
    const history = build().historyData.getVectorscopeHistoryForKey();
    const rows = selectPolarWindow(history, 400);
    expect(rows).toHaveLength(5);
    expect(rows.at(-1).timestampMs).toBe(COMMUNITY_PREVIEW_FIXTURE_V3.clock.durationMs);
    expect(rows.every(({ pairs }) => pairs.length === 200 && pairs.every(Number.isFinite))).toBe(
      true
    );
    expect(rows.some(({ pairs }) => pairs.some((value) => Math.abs(value) > 0.1))).toBe(true);
    expect(aggregatePolarLevel(rows).some((value) => value > 0)).toBe(true);
    expect(history.rowAt(0).pairs).toEqual(
      build().historyData.getVectorscopeHistoryForKey().rowAt(0).pairs
    );
    expect(history.rowAt(0).pairs[2]).not.toBe(history.rowAt(0).pairs[3]);
  });

  it("uses measured Discovery data instead of interpolated display curves", () => {
    const values = buildCommunityPreviewFixtureValues(COMMUNITY_PREVIEW_FIXTURE_V3);
    expect(COMMUNITY_PREVIEW_FIXTURE_V3.source).toMatchObject({
      fileName: "discovery-hero.wav",
      windowStartMs: 63000,
      windowEndMs: 78000,
    });
    expect(values.historyData.histSourceList).toHaveLength(151);
    expect(values.historyData.visualWaveformHist).toHaveLength(151);
    expect(
      values.frameData.displayAudio.spectrumResultsByKey.any.bandCentersHz.length
    ).toBeGreaterThan(200);
    expect(values.historyData.getSpectrogramSnapsForKey().length).toBe(31);
  });
});
