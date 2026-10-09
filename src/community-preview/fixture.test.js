import { describe, expect, it } from "vitest";
import { selectPolarWindow, aggregatePolarLevel } from "../math/vectorscopePolarMath.js";
import { COMMUNITY_PREVIEW_FIXTURE_V2 } from "../transfer/fixtures/communityPreviewV2.js";
import { buildCommunityPreviewFixtureValues } from "./fixture.js";

describe("Community Vectorscope preview data", () => {
  it("supplies deterministic non-silent stereo history for Polar Sample and Polar Level", () => {
    const build = () => buildCommunityPreviewFixtureValues(COMMUNITY_PREVIEW_FIXTURE_V2);
    const history = build().historyData.getVectorscopeHistoryForKey();
    const rows = selectPolarWindow(history, 400);
    expect(rows).toHaveLength(5);
    expect(rows.at(-1).timestampMs).toBe(COMMUNITY_PREVIEW_FIXTURE_V2.clock.durationMs);
    expect(rows.every(({ pairs }) => pairs.length === 2048 && pairs.every(Number.isFinite))).toBe(
      true
    );
    expect(rows.some(({ pairs }) => pairs.some((value) => Math.abs(value) > 0.1))).toBe(true);
    expect(aggregatePolarLevel(rows).some((value) => value > 0)).toBe(true);
    expect(history.rowAt(0).pairs).toEqual(
      build().historyData.getVectorscopeHistoryForKey().rowAt(0).pairs
    );
    expect(history.rowAt(0).pairs[2]).not.toBe(history.rowAt(0).pairs[3]);
  });
});
