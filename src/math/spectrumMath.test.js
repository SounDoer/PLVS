import { describe, it, expect } from "vitest";
import { buildSpectrumSvgFromBandsAndDb, findSpectrumPeaks } from "./spectrumMath.js";

/** A 96-points-per-octave log grid from 20 Hz, matching the bank's render grid. */
function grid(points = 960) {
  return Array.from({ length: points }, (_, i) => ({ fCenter: 20 * 2 ** (i / 96) }));
}

/**
 * Flat floor with gaussian bumps at the given { freq, db, widthOct } spots. Gains are summed,
 * not maxed: a bump has to sit *on* whatever is under it for a shoulder to be a shoulder.
 */
function curveWith(bands, bumps, floorDb = -80) {
  return bands.map(({ fCenter }) => {
    let gain = 0;
    for (const bump of bumps) {
      const oct = Math.log2(fCenter / bump.freq);
      gain += bump.db * Math.exp(-((oct / (bump.widthOct ?? 1 / 24)) ** 2));
    }
    return floorDb + gain;
  });
}

/**
 * Asserts the detected peaks sit at the given frequencies, in order. A detected peak lands on a
 * grid point, and grid points are 1/96 octave apart, so it can never be exactly on the bump.
 */
function expectPeakFreqs(peaks, targets) {
  expect(peaks.map((p) => Math.round(p.freq))).toHaveLength(targets.length);
  peaks.forEach((peak, i) => {
    const offsetOct = Math.abs(Math.log2(peak.freq / targets[i]));
    expect(
      offsetOct,
      `peak ${i} at ${peak.freq.toFixed(0)} Hz, expected ~${targets[i]} Hz`
    ).toBeLessThan(1 / 96);
  });
}

describe("buildSpectrumSvgFromBandsAndDb", () => {
  it("returns empty string for empty input", () => {
    expect(buildSpectrumSvgFromBandsAndDb([], [])).toBe("");
  });

  it("returns empty for mismatched lengths", () => {
    expect(buildSpectrumSvgFromBandsAndDb([100, 1000], [-20])).toBe("");
  });

  it("returns SVG path starting with M", () => {
    const centers = [100, 1000, 10000];
    const db = [-20, -30, -40];
    const svg = buildSpectrumSvgFromBandsAndDb(centers, db);
    expect(svg).toMatch(/^M /);
  });

  it("dB values above 0 clamp to top", () => {
    const svg = buildSpectrumSvgFromBandsAndDb([1000], [10]);
    expect(svg).toMatch(/^M /);
  });
});

describe("findSpectrumPeaks", () => {
  it("returns nothing for empty or mismatched input", () => {
    expect(findSpectrumPeaks([], [])).toEqual([]);
    expect(findSpectrumPeaks(grid(3), [-20])).toEqual([]);
  });

  it("finds isolated bumps and orders them by prominence", () => {
    const bands = grid();
    const db = curveWith(bands, [
      { freq: 100, db: 20 },
      { freq: 1000, db: 40 },
      { freq: 8000, db: 30 },
    ]);
    const peaks = findSpectrumPeaks(bands, db);
    expectPeakFreqs(peaks, [1000, 8000, 100]);
    expect(peaks[0].prominenceDb).toBeGreaterThan(peaks[1].prominenceDb);
    expect(peaks[1].prominenceDb).toBeGreaterThan(peaks[2].prominenceDb);
  });

  it("ranks a lone quiet peak over a loud bump on a big peak's flank", () => {
    const bands = grid();
    // A wide hill at 1 kHz, a ripple partway up its rising side, and an isolated bump up top.
    const db = curveWith(bands, [
      { freq: 1000, db: 40, widthOct: 1 / 2 },
      { freq: 800, db: 5, widthOct: 1 / 40 },
      { freq: 9000, db: 12 },
    ]);
    const idxNear = (hz) =>
      bands.reduce(
        (best, b, i) => (Math.abs(b.fCenter - hz) < Math.abs(bands[best].fCenter - hz) ? i : best),
        0
      );
    // The flank ripple stands ~31 dB over the floor; the lone 9 kHz bump only ~12 dB. Ranking
    // on level would pick the ripple and drop the bump. This is the case prominence exists for.
    expect(db[idxNear(800)]).toBeGreaterThan(db[idxNear(9000)]);

    const peaks = findSpectrumPeaks(bands, db, { minProminenceDb: 6 });
    expectPeakFreqs(peaks, [1000, 9000]);
  });

  it("drops bumps below the prominence floor", () => {
    const bands = grid();
    const db = curveWith(bands, [
      { freq: 1000, db: 40 },
      { freq: 5000, db: 3 },
    ]);
    expectPeakFreqs(findSpectrumPeaks(bands, db, { minProminenceDb: 6 }), [1000]);
  });

  it("keeps labels apart, preferring the more prominent of a close pair", () => {
    const bands = grid();
    // Two separate summits a semitone apart: both prominent, but their labels would collide.
    const db = curveWith(bands, [
      { freq: 1000, db: 30, widthOct: 1 / 96 },
      { freq: 1059, db: 40, widthOct: 1 / 96 },
    ]);
    expectPeakFreqs(findSpectrumPeaks(bands, db, { minSeparationOct: 1 / 6 }), [1059]);
  });

  it("caps the count and honours the visible range", () => {
    const bands = grid();
    const bumps = [100, 300, 900, 2700, 8100, 16200].map((freq) => ({ freq, db: 30 }));
    const db = curveWith(bands, bumps);
    expect(findSpectrumPeaks(bands, db, { count: 3 })).toHaveLength(3);
    // Peaks outside the zoomed-in view are not candidates: relevance follows what is on screen.
    expectPeakFreqs(findSpectrumPeaks(bands, db, { minHz: 200, maxHz: 1000 }), [300, 900]);
  });

  it("does not report the endpoints as peaks", () => {
    const bands = grid(200);
    // Monotonically falling: the first sample is the highest value but is not a summit.
    const db = bands.map((_, i) => -10 - i * 0.5);
    expect(findSpectrumPeaks(bands, db, { minProminenceDb: 0 })).toEqual([]);
  });
});
