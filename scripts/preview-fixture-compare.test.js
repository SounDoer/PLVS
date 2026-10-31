import { describe, expect, it } from "vitest";
import { comparePreviewFixtures, describeFixtureComparison } from "./preview-fixture-compare.mjs";

function fixture() {
  return {
    source: { sha256: "pinned", derivation: { recipeVersion: 1 } },
    analysisRequests: { spectrum: [{ key: "pair", speedPercent: 25 }] },
    clock: { durationMs: 60000 },
    measurementFrame: { loudness: { integratedLufs: -12.9 } },
    loudnessHistory: [{ atMs: 0, momentaryLufs: -11.3 }],
    visuals: {
      bandCentersHz: [100],
      spectrumResultsByKey: { pair: { smoothDb: [-40], peakDbB: [-30] } },
      spectrogramByKey: { pair: [{ atMs: 0, db: [-110], dbB: [-100] }] },
      stereoMapResultsByKey: {
        pair: { bandCentersHz: [100], pl: [0.001], pr: [0.002], c: [-0.001] },
      },
      waveform: [{ atMs: 0, min: [-0.5], spectralCentroidHz: [2000], tonality: [0.5] }],
      vectorscopeResultsByKey: { pair: { correlation: 0.5 } },
    },
  };
}

function change(expected, path, delta) {
  const actual = structuredClone(expected);
  const parent = path.slice(0, -1).reduce((value, key) => value[key], actual);
  parent[path.at(-1)] += delta;
  return actual;
}

const visualCases = [
  ["frequency grid", ["visuals", "bandCentersHz", 0], 5e-10, 2e-9],
  ["final spectrum", ["visuals", "spectrumResultsByKey", "pair", "smoothDb", 0], 0.000026, 0.0002],
  ["secondary peak", ["visuals", "spectrumResultsByKey", "pair", "peakDbB", 0], 0.000026, 0.0002],
  ["spectrogram", ["visuals", "spectrogramByKey", "pair", 0, "db", 0], 0.00133, 0.003],
  ["secondary spectrogram", ["visuals", "spectrogramByKey", "pair", 0, "dbB", 0], 0.00133, 0.003],
  ["centroid", ["visuals", "waveform", 0, "spectralCentroidHz", 0], 0.001, 0.003],
  ["tonality", ["visuals", "waveform", 0, "tonality", 0], 1e-7, 3e-7],
  [
    "Stereo Map grid",
    ["visuals", "stereoMapResultsByKey", "pair", "bandCentersHz", 0],
    5e-10,
    2e-9,
  ],
  ["Stereo Map power", ["visuals", "stereoMapResultsByKey", "pair", "pl", 0], 3e-10, 2e-9],
  ["Stereo Map cross-power", ["visuals", "stereoMapResultsByKey", "pair", "c", 0], 3e-10, 2e-9],
];

describe("preview fixture comparison", () => {
  it("uses inclusive absolute limits in both directions, never a relative allowance", () => {
    const expected = { visuals: { spectrogramByKey: { pair: [{ db: [0] }] } } };
    for (const value of [-0.002, 0.002]) {
      const actual = { visuals: { spectrogramByKey: { pair: [{ db: [value] }] } } };
      expect(comparePreviewFixtures(expected, actual).matches).toBe(true);
    }
    for (const value of [-0.00200001, 0.00200001]) {
      const actual = { visuals: { spectrogramByKey: { pair: [{ db: [value] }] } } };
      expect(comparePreviewFixtures(expected, actual).matches).toBe(false);
    }
    expect(
      comparePreviewFixtures(
        { visuals: { bandCentersHz: [1e6] } },
        { visuals: { bandCentersHz: [1e6 + 1e-6] } }
      ).matches
    ).toBe(false);
  });

  it("compares JSON values independently of object key order", () => {
    expect(comparePreviewFixtures({ a: 1, b: "source" }, { b: "source", a: 1 })).toMatchObject({
      matches: true,
      toleratedCount: 0,
    });
  });

  it.each(visualCases)(
    "accepts measured %s noise and refuses changes beyond its absolute limit",
    (_, path, noise, regression) => {
      const expected = fixture();
      expect(comparePreviewFixtures(expected, change(expected, path, noise))).toMatchObject({
        matches: true,
        toleratedCount: 1,
      });
      const failed = comparePreviewFixtures(expected, change(expected, path, regression));
      expect(failed).toMatchObject({
        matches: false,
        mismatchCount: 1,
        examples: [{ reason: "visual difference exceeds limit" }],
      });
      expect(describeFixtureComparison(failed)).toContain("limit");
    }
  );

  it.each([
    ["measurementFrame", "loudness", "integratedLufs"],
    ["loudnessHistory", 0, "momentaryLufs"],
    ["loudnessHistory", 0, "atMs"],
    ["analysisRequests", "spectrum", 0, "speedPercent"],
    ["source", "derivation", "recipeVersion"],
    ["clock", "durationMs"],
    ["visuals", "waveform", 0, "atMs"],
    ["visuals", "waveform", 0, "min", 0],
    ["visuals", "spectrogramByKey", "pair", 0, "atMs"],
    ["visuals", "vectorscopeResultsByKey", "pair", "correlation"],
  ])("keeps %j exact even for tiny changes", (...path) => {
    const expected = fixture();
    expect(comparePreviewFixtures(expected, change(expected, path, 1e-9))).toMatchObject({
      matches: false,
      toleratedCount: 0,
    });
  });

  it("refuses a changed source hash, missing field, array length or request key", () => {
    for (const mutate of [
      (f) => {
        f.source.sha256 = "other";
      },
      (f) => {
        delete f.visuals.spectrumResultsByKey.pair.peakDbB;
      },
      (f) => {
        f.visuals.spectrogramByKey.pair[0].db.push(-110);
      },
      (f) => {
        f.visuals.spectrumResultsByKey.other = f.visuals.spectrumResultsByKey.pair;
        delete f.visuals.spectrumResultsByKey.pair;
      },
    ]) {
      const expected = fixture();
      const actual = structuredClone(expected);
      mutate(actual);
      expect(comparePreviewFixtures(expected, actual).matches).toBe(false);
    }
  });

  it("does not allow tolerances on unknown visual fields or object-shaped numeric arrays", () => {
    expect(
      comparePreviewFixtures({ visuals: { future: [1] } }, { visuals: { future: [1.000000001] } })
        .matches
    ).toBe(false);
    expect(
      comparePreviewFixtures(
        { visuals: { bandCentersHz: { 0: 100 } } },
        { visuals: { bandCentersHz: { 0: 100.0000000005 } } }
      ).matches
    ).toBe(false);
    expect(comparePreviewFixtures({ visuals: [] }, { visuals: {} }).matches).toBe(false);
    expect(comparePreviewFixtures({ value: null }, { value: 0 }).matches).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity, undefined])(
    "rejects non-JSON or non-finite values (%s), including self-comparison",
    (value) => {
      expect(comparePreviewFixtures({ value }, { value }).matches).toBe(false);
    }
  );

  it("limits diagnostic output, escapes JSON pointers and preserves the largest tolerated difference", () => {
    const expected = fixture();
    const actual = structuredClone(expected);
    actual.visuals.spectrogramByKey.pair[0].db = [-109.9985, -110.0001];
    expected.visuals.spectrogramByKey.pair[0].db.push(-110);
    expected.extra = Array(20).fill(1);
    actual.extra = Array(20).fill(2);
    const result = comparePreviewFixtures(expected, actual);
    expect(result).toMatchObject({
      mismatchCount: 20,
      toleratedCount: 2,
      tolerated: { spectrogram: { count: 2, path: "/visuals/spectrogramByKey/pair/0/db/0" } },
    });
    expect(result.examples).toHaveLength(5);
    expect(comparePreviewFixtures({ "a/b~c": 1 }, { "a/b~c": 2 }).examples[0].path).toBe(
      "/a~1b~0c"
    );
    expect(actual.extra).toEqual(Array(20).fill(2));
  });
});
