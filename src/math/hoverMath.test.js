import { describe, expect, it } from "vitest";
import {
  formatHoverOffset,
  formatSpectrumFreq,
  computeHistoryHoverPoint,
  computeSpectrumHoverIndex,
  computeWaveformHoverPoint,
  computeSpectrogramHoverPoint,
  findMarkerNoteAtX,
  freqToNote,
} from "./hoverMath";

function viewOf(rows) {
  return {
    get length() {
      return rows.length;
    },
    version: 0,
    timestampAt: (i) => (i >= 0 && i < rows.length ? rows[i].timestampMs : NaN),
    rowAt: (i) => (i >= 0 && i < rows.length ? rows[i] : undefined),
  };
}

describe("formatHoverOffset", () => {
  it("formats sub-10s with one decimal", () => {
    expect(formatHoverOffset(3.4)).toBe("3.4s ago");
  });

  it("formats >= 10s with no decimal", () => {
    expect(formatHoverOffset(15.7)).toBe("16s ago");
  });

  it("formats >= 60s as m+s, remainder >= 10s has no decimal", () => {
    expect(formatHoverOffset(90)).toBe("1m 30s ago");
  });

  it("formats >= 60s, remainder < 10s keeps one decimal", () => {
    expect(formatHoverOffset(63)).toBe("1m 3.0s ago");
  });

  it("clamps negative input to 0", () => {
    expect(formatHoverOffset(-5)).toBe("0.0s ago");
  });
});

describe("formatSpectrumFreq", () => {
  it("formats Hz below 1kHz as integer Hz", () => {
    expect(formatSpectrumFreq(440)).toBe("440 Hz");
  });

  it("formats >= 1kHz as kHz with two decimals when < 10kHz", () => {
    expect(formatSpectrumFreq(2500)).toBe("2.50 kHz");
  });

  it("formats >= 10kHz with one decimal", () => {
    expect(formatSpectrumFreq(12000)).toBe("12.0 kHz");
  });

  it("returns '-' for non-finite input", () => {
    expect(formatSpectrumFreq(NaN)).toBe("-");
    expect(formatSpectrumFreq(Infinity)).toBe("-");
  });
});

describe("computeHistoryHoverPoint", () => {
  const samples = [
    { m: -23, st: -24 },
    { m: -22, st: -23 },
    { m: -21, st: -22 },
  ];

  it("returns null for empty list", () => {
    expect(computeHistoryHoverPoint(0, [], 0, 10, 0.1)).toBeNull();
  });

  it("returns a hover object at a valid position", () => {
    const result = computeHistoryHoverPoint(0.5, samples, 0, 3, 0.1);
    expect(result).not.toBeNull();
    expect(result).toHaveProperty("leftPct");
    expect(result).toHaveProperty("offsetLabel");
  });

  it("leftPct is between 0 and 100", () => {
    const r = computeHistoryHoverPoint(0.5, samples, 0, 3, 0.1);
    expect(r.leftPct).toBeGreaterThanOrEqual(0);
    expect(r.leftPct).toBeLessThanOrEqual(100);
  });

  it("exposes momentary and shortTerm values", () => {
    const r = computeHistoryHoverPoint(0, samples, 0, 3, 0.1);
    expect(typeof r.momentary).toBe("number");
    expect(typeof r.shortTerm).toBe("number");
  });
});

describe("computeSpectrumHoverIndex", () => {
  const bands = [{ fCenter: 100 }, { fCenter: 1000 }, { fCenter: 10000 }];

  it("returns the nearest band index for a pointer near the left", () => {
    const idx = computeSpectrumHoverIndex(0, bands);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(idx).toBeLessThan(bands.length);
  });

  it("returns an index within bounds for any xFrac", () => {
    for (const xFrac of [0, 0.5, 1]) {
      const idx = computeSpectrumHoverIndex(xFrac, bands);
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(idx).toBeLessThan(bands.length);
    }
  });
});

describe("computeWaveformHoverPoint", () => {
  it("reads dBFS from the column under xFrac and time from the window", () => {
    const columns = 1000;
    const maxes = [new Array(columns).fill(0)];
    const mins = [new Array(columns).fill(0)];
    maxes[0][columns - 1] = 1.0; // right edge = 0 dBFS

    const r = computeWaveformHoverPoint(1, mins, maxes, columns, 0, 50, 0.1, ["L"]);
    expect(r.channels[0].dbFs).toBeCloseTo(0, 3);
    // xFrac=1 → newest → 0s ago (offset 0, right edge).
    expect(r.timeLabel).toBe("0.0s ago");
    expect(r.leftPct).toBe(100);
  });

  it("returns null for empty columns", () => {
    expect(computeWaveformHoverPoint(0.5, [[]], [[]], 0, 0, 50, 0.1, ["L"])).toBeNull();
  });
});

describe("computeSpectrogramHoverPoint", () => {
  const testBands = [{ fCenter: 100 }, { fCenter: 1000 }, { fCenter: 10000 }];
  const testDbList = [-50, -30, -20];
  const OLD = 0;
  const NEW = 1000;
  const SMS = 40;
  const makeSnaps = (extra = {}) => {
    const out = [];
    for (let ts = OLD; ts <= NEW; ts += SMS) {
      out.push({ timestampMs: ts, bands: testBands, dbList: testDbList, ...extra });
    }
    return out;
  };
  const snaps = viewOf(makeSnaps());

  it("returns null for empty snaps array", () => {
    expect(computeSpectrogramHoverPoint(0.5, 0.5, viewOf([]), OLD, NEW, SMS)).toBeNull();
  });

  it("leftPct equals xFrac * 100", () => {
    const r = computeSpectrogramHoverPoint(0.4, 0.5, snaps, OLD, NEW, SMS);
    expect(r).not.toBeNull();
    expect(r.leftPct).toBeCloseTo(40);
  });

  it("topPct equals yFrac * 100", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.3, snaps, OLD, NEW, SMS);
    expect(r).not.toBeNull();
    expect(r.topPct).toBeCloseTo(30);
  });

  it("timeLabel is a string", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, OLD, NEW, SMS);
    expect(r).not.toBeNull();
    expect(typeof r.timeLabel).toBe("string");
    expect(r.timeLabel).toMatch(/ago/);
  });

  it("freqLabel is a string containing Hz or kHz", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, OLD, NEW, SMS);
    expect(r).not.toBeNull();
    expect(typeof r.freqLabel).toBe("string");
    expect(r.freqLabel).toMatch(/Hz/);
  });

  it("dbLabel is in -XX.X dB format", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, OLD, NEW, SMS);
    expect(r).not.toBeNull();
    expect(r.dbLabel).toMatch(/^-?\d+\.\d dB$/);
  });

  it("returns null when the nearest frame has no bands", () => {
    expect(
      computeSpectrogramHoverPoint(0.5, 0.5, viewOf(makeSnaps({ bands: [] })), OLD, NEW, SMS)
    ).toBeNull();
  });

  it("returns null when the nearest frame has no dbList", () => {
    expect(
      computeSpectrogramHoverPoint(0.5, 0.5, viewOf(makeSnaps({ dbList: [] })), OLD, NEW, SMS)
    ).toBeNull();
  });

  it("returns null when hovering a time gap with no nearby frame", () => {
    const sparse = viewOf([{ timestampMs: 950, bands: testBands, dbList: testDbList }]);
    // cursor at xFrac 0.1 → ts ~100, far from the only frame at 950 → gap.
    expect(computeSpectrogramHoverPoint(0.1, 0.5, sparse, OLD, NEW, SMS)).toBeNull();
  });

  it("includes a note label in spectrogram hover", () => {
    const single = viewOf([{ timestampMs: 500, bands: [{ fCenter: 440 }], dbList: [-20] }]);
    const out = computeSpectrogramHoverPoint(0.5, 0.5, single, OLD, NEW, SMS);
    expect(out).not.toBeNull();
    expect(typeof out.noteLabel).toBe("string");
    expect(out.noteLabel).not.toBe("");
  });

  it("includes a marker note when hovering near a spectrogram marker", () => {
    const r = computeSpectrogramHoverPoint(0.5, 0.5, snaps, OLD, NEW, SMS, [
      { xFrac: 0.5, label: "L+R -> C" },
    ]);
    expect(r.markerNoteLabel).toBe("L+R -> C");
  });
});

describe("findMarkerNoteAtX", () => {
  it("returns the nearest marker label within the hit radius", () => {
    expect(
      findMarkerNoteAtX(0.502, [
        { xFrac: 0.2, label: "Data starts here" },
        { xFrac: 0.5, label: "L+R -> C" },
      ])
    ).toBe("L+R -> C");
  });

  it("returns null outside the hit radius", () => {
    expect(findMarkerNoteAtX(0.6, [{ xFrac: 0.5, label: "L+R -> C" }])).toBeNull();
  });
});

describe("freqToNote", () => {
  it("maps standard pitches at A4=440", () => {
    expect(freqToNote(440)).toBe("A4");
    expect(freqToNote(880)).toBe("A5");
    expect(freqToNote(261.6256)).toBe("C4"); // middle C
  });
  it("shows cents offset when off-pitch", () => {
    expect(freqToNote(445)).toMatch(/^A4 \+\d+¢$/);
    expect(freqToNote(437)).toMatch(/^A4 -\d+¢$/);
  });
  it("handles invalid input", () => {
    expect(freqToNote(0)).toBe("-");
    expect(freqToNote(NaN)).toBe("-");
  });
});
