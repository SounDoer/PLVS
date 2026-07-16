import { describe, it, expect } from "vitest";
import {
  buildSpectrumSvgFromBandsAndDb,
  findSpectrumPeakCandidates,
  trackSpectrumPeaks,
} from "./spectrumMath.js";

/** What the panel does each frame: find candidates, then carry the labels forward. */
function step(previous, bands, db, options = {}) {
  return trackSpectrumPeaks(previous, findSpectrumPeakCandidates(bands, db), options);
}

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

describe("findSpectrumPeakCandidates", () => {
  it("returns nothing for empty or mismatched input", () => {
    expect(findSpectrumPeakCandidates([], [])).toEqual([]);
    expect(findSpectrumPeakCandidates(grid(3), [-20])).toEqual([]);
  });

  it("finds isolated bumps and orders them by prominence", () => {
    const bands = grid();
    const db = curveWith(bands, [
      { freq: 100, db: 20 },
      { freq: 1000, db: 40 },
      { freq: 8000, db: 30 },
    ]);
    const peaks = findSpectrumPeakCandidates(bands, db);
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

    expectPeakFreqs(findSpectrumPeakCandidates(bands, db, { minProminenceDb: 6 }), [1000, 9000]);
  });

  it("drops bumps below the prominence floor", () => {
    const bands = grid();
    const db = curveWith(bands, [
      { freq: 1000, db: 40 },
      { freq: 5000, db: 3 },
    ]);
    expectPeakFreqs(findSpectrumPeakCandidates(bands, db, { minProminenceDb: 6 }), [1000]);
  });

  it("honours the visible range", () => {
    const bands = grid();
    const db = curveWith(
      bands,
      [100, 300, 900, 2700, 8100].map((freq) => ({ freq, db: 30 }))
    );
    // Peaks outside the zoomed-in view are not candidates: relevance follows what is on screen.
    expectPeakFreqs(findSpectrumPeakCandidates(bands, db, { minHz: 200, maxHz: 1000 }), [300, 900]);
  });

  it("does not report the endpoints as peaks", () => {
    const bands = grid(200);
    // Monotonically falling: the first sample is the highest value but is not a summit.
    const db = bands.map((_, i) => -10 - i * 0.5);
    expect(findSpectrumPeakCandidates(bands, db)).toEqual([]);
  });

  it("resolves a peak between two grid points instead of snapping to one", () => {
    const bands = grid();
    // Park a tone exactly halfway between two grid points. Reporting a grid frequency would be
    // off by half a step every time, and would flip neighbours the moment noise moved it.
    const between = bands[500].fCenter * 2 ** (1 / 192);
    const db = curveWith(bands, [{ freq: between, db: 40, widthOct: 1 / 24 }]);
    const [peak] = findSpectrumPeakCandidates(bands, db);
    expect(peak.freq).not.toBe(bands[500].fCenter);
    expect(peak.freq).not.toBe(bands[501].fCenter);
    // Well inside a tenth of a grid step of the truth, from grid data alone.
    expect(Math.abs(Math.log2(peak.freq / between))).toBeLessThan(1 / 960);
  });
});

describe("trackSpectrumPeaks", () => {
  const bands = grid();

  it("caps the count, taking the most prominent", () => {
    const db = curveWith(
      bands,
      [100, 300, 900, 2700, 8100, 16200].map((freq) => ({ freq, db: 30 }))
    );
    expect(step([], bands, db, { count: 3 })).toHaveLength(3);
  });

  it("keeps labels apart, preferring the more prominent of a close pair", () => {
    // Two separate summits a semitone apart: both prominent, but their labels would collide.
    const db = curveWith(bands, [
      { freq: 1000, db: 30, widthOct: 1 / 96 },
      { freq: 1059, db: 40, widthOct: 1 / 96 },
    ]);
    expectPeakFreqs(step([], bands, db, { minSeparationOct: 1 / 6 }), [1059]);
  });

  it("does not hand a slot to a challenger that is only marginally better", () => {
    // The exact churn seen on real material: two peaks a hair apart in prominence, swapping
    // rank frame to frame. Only one slot, so independent ranking would flip the label.
    const opts = { count: 1, enterProminenceDb: 9, exitProminenceDb: 5 };
    const frameA = curveWith(bands, [
      { freq: 500, db: 30 },
      { freq: 5000, db: 29.5 },
    ]);
    const frameB = curveWith(bands, [
      { freq: 500, db: 29.5 },
      { freq: 5000, db: 30 },
    ]);
    const first = step([], bands, frameA, opts);
    expectPeakFreqs(first, [500]);
    // 5 kHz now outranks it, but not by enough to be worth moving the label.
    expectPeakFreqs(step(first, bands, frameB, opts), [500]);
  });

  it("gives the slot up once the peak it sits on is really gone", () => {
    const opts = { count: 1, enterProminenceDb: 9, exitProminenceDb: 5 };
    const held = step([], bands, curveWith(bands, [{ freq: 500, db: 30 }]), opts);
    expectPeakFreqs(held, [500]);
    // Faded to nothing while a clear peak stands elsewhere: holding on would be a lie.
    const after = step(held, bands, curveWith(bands, [{ freq: 5000, db: 30 }]), opts);
    expectPeakFreqs(after, [5000]);
  });

  it("holds a label whose peak has dipped below the entry bar but not the exit bar", () => {
    const opts = { count: 5, enterProminenceDb: 9, exitProminenceDb: 5 };
    const held = step([], bands, curveWith(bands, [{ freq: 500, db: 30 }]), opts);
    expectPeakFreqs(held, [500]);
    // Between the two bars: too weak to have earned a slot, strong enough to keep one. Without
    // this gap a peak hovering at the threshold blinks on and off.
    const dipped = step(held, bands, curveWith(bands, [{ freq: 500, db: 7 }]), opts);
    expectPeakFreqs(dipped, [500]);
    expect(dipped[0].prominenceDb).toBeLessThan(opts.enterProminenceDb);
    // A fresh start would not have picked it up at all.
    expect(step([], bands, curveWith(bands, [{ freq: 500, db: 7 }]), opts)).toEqual([]);
  });

  it("eases a tracked label toward a peak that moves rather than jumping", () => {
    const opts = { count: 1, freqSmoothing: 0.35 };
    const held = step([], bands, curveWith(bands, [{ freq: 1000, db: 30 }]), opts);
    const moved = step(held, bands, curveWith(bands, [{ freq: 1030, db: 30 }]), opts);
    // Between where it was and where the peak went — a glide, not a teleport.
    expect(moved[0].freq).toBeGreaterThan(held[0].freq);
    expect(moved[0].freq).toBeLessThan(1030);
  });

  it("drops a label rather than dragging it to an unrelated peak", () => {
    const opts = { count: 1, matchOct: 1 / 12 };
    const held = step([], bands, curveWith(bands, [{ freq: 1000, db: 30 }]), opts);
    // Nothing within matchOct of 1 kHz any more: 8 kHz is a different peak, not this one moved.
    const after = step(held, bands, curveWith(bands, [{ freq: 8000, db: 30 }]), opts);
    expectPeakFreqs(after, [8000]);
  });

  it("returns nothing when there are no candidates", () => {
    expect(trackSpectrumPeaks([{ freq: 1000 }], [])).toEqual([]);
  });
});
