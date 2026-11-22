import { describe, expect, it } from "vitest";

import {
  buildSpectrumReadout,
  SPECTRUM_READOUT_FLOOR_DB,
  spectrumReadoutBands,
} from "./spectrumReadout.js";

/// The engine grid: 96 points per octave from 20 Hz to 20 kHz.
const GRID = (() => {
  const centers = [];
  for (let hz = 20; hz <= 20000; hz *= 2 ** (1 / 96)) centers.push(hz);
  return centers;
})();

const DISPLAY = Object.freeze({
  channel: { type: "pair", x: 0, y: 1 },
  view: "combined",
  curves: [{ id: "primary", label: "Combined" }],
  tiltDbPerOctave: 0,
  speedPercent: 25,
  octaveSmoothing: "off",
  maxMode: "off",
  slowTrace: false,
  frequencyRangeHz: [20, 20000],
  levelRangeDb: [-96, 0],
});

function readout(overrides = {}) {
  return {
    displaySource: "live",
    frame: { sequence: 42, elapsedMs: 5000, receivedAtMs: 1_000_000 },
    centers: GRID,
    curveDb: GRID.map(() => -40),
    curveDbB: null,
    maxDb: null,
    maxDbB: null,
    display: DISPLAY,
    ...overrides,
  };
}

function build(overrides = {}, input = {}) {
  return buildSpectrumReadout({
    revision: 7,
    observedAtMs: 1_000_100,
    panelId: "spectrum-1",
    liveState: "running",
    sessionGeneration: 3,
    hasLiveSample: true,
    readout: readout(overrides),
    ...input,
  });
}

describe("spectrum readout bands", () => {
  it("covers the engine grid with the nominal fractional-octave bands", () => {
    const third = spectrumReadoutBands(GRID, "third");
    expect(third).toHaveLength(31);
    expect(third[0].centerHz).toBeCloseTo(19.69, 2);
    expect(third.find((band) => Math.abs(band.centerHz - 1000) < 1e-9)).toBeTruthy();
    expect(third.at(-1).centerHz).toBeCloseTo(20158.7, 1);
    expect(spectrumReadoutBands(GRID, "octave")).toHaveLength(11);
    expect(spectrumReadoutBands(GRID, "full")).toHaveLength(GRID.length);
  });

  it("assigns every grid point to exactly one band", () => {
    for (const resolution of /** @type {const} */ (["octave", "third", "sixth", "twelfth"])) {
      const bands = spectrumReadoutBands(GRID, resolution);
      const covered = bands.reduce((sum, band) => sum + band.end - band.start, 0);
      expect(covered).toBe(GRID.length);
    }
  });
});

describe("spectrum readout", () => {
  it("reports a flat curve flat at every resolution, with the frame identity", () => {
    const result = build();
    expect(result).toMatchObject({
      revision: 7,
      panelId: "spectrum-1",
      source: { kind: "live", state: "running", sessionGeneration: 3 },
      sample: { sequence: 42, elapsedMs: 5000, ageMs: 100, freshness: "fresh" },
      unavailable: null,
      resolution: "third",
      unit: "dB",
      peaks: [],
    });
    expect(result.bands).toHaveLength(31);
    expect(result.bands.every((band) => band.db === -40)).toBe(true);
    expect(result.bands[0]).not.toHaveProperty("dbB");
    expect(result.bands[0]).not.toHaveProperty("maxDb");
  });

  it("averages power within a band and finds a tone the average dilutes", () => {
    const toneIndex = GRID.findIndex((hz) => hz >= 1000);
    const curveDb = GRID.map((_, index) => (index === toneIndex ? -6 : -80));
    const result = build({ curveDb });
    const band = result.bands.find((row) => row.lowHz <= 1000 && row.highHz > 1000);
    // One point at -6 dB among the band's 32 is about 15 dB lower once averaged.
    expect(band.db).toBeCloseTo(-6 + 10 * Math.log10(1 / 32), 0);
    expect(result.peaks).toEqual([
      expect.objectContaining({ curve: "primary", db: -6, prominenceDb: 74 }),
    ]);
    expect(result.peaks[0].frequencyHz).toBeCloseTo(GRID[toneIndex], 0);
  });

  it("reports both curves and their Max curve when the panel shows them", () => {
    const result = build({
      curveDbB: GRID.map(() => -50),
      maxDb: GRID.map(() => -30),
      maxDbB: GRID.map(() => -35),
      display: { ...DISPLAY, view: "lr", maxMode: "hold" },
    });
    expect(result.bands[10]).toMatchObject({ db: -40, dbB: -50, maxDb: -30, maxDbB: -35 });
  });

  it("reports levels below the lowest axis level as null", () => {
    const result = build({
      curveDb: GRID.map((hz) => (hz < 1000 ? SPECTRUM_READOUT_FLOOR_DB - 60 : -40)),
    });
    expect(result.bands[0].db).toBeNull();
    expect(result.bands.at(-1).db).toBe(-40);
    expect(result.unavailable).toBeNull();

    const silent = build({ curveDb: GRID.map(() => -187) });
    expect(silent.unavailable).toBe("belowSignalFloor");
    expect(silent.bands.every((band) => band.db === null)).toBe(true);
  });

  it("marks a retained curve stale once LIVE stops or the frame is old", () => {
    expect(build({}, { liveState: "stopped" }).sample.freshness).toBe("stale");
    expect(build({}, { observedAtMs: 1_000_000 + 2001 }).sample.freshness).toBe("stale");
  });

  it.each(["file", "snapshot"])("reads the drawn %s curve without a live sample", (kind) => {
    const result = build(
      { displaySource: kind, offsetSec: 2 },
      { hasLiveSample: false, fileSessionId: "selected-file" }
    );
    expect(result).toMatchObject({
      displaySource: {
        kind,
        offsetSec: 2,
        ...(kind === "file" && { sessionId: "selected-file" }),
      },
      sample: {
        sequence: null,
        elapsedMs: null,
        receivedAt: null,
        ageMs: null,
        freshness: "historical",
      },
      unavailable: null,
    });
    expect(result.bands).toHaveLength(31);
    expect(result.bands.every((band) => band.db === -40)).toBe(true);
  });

  it("reports missing history or unavailable Live frames", () => {
    const cases = [
      { result: build({ displaySource: "snapshot", centers: null }), reason: "historyUnavailable" },
      { result: build({ displaySource: "file", centers: null }), reason: "historyUnavailable" },
      { result: build({}, { hasLiveSample: false }), reason: "noSample" },
      { result: build({ centers: null, curveDb: null }), reason: "notReady" },
    ];
    for (const { result, reason } of cases) {
      expect(result.unavailable).toBe(reason);
      expect(result.sample.freshness).toBe("unavailable");
      expect(result.sample.receivedAt).toBeNull();
      expect(result.bands).toEqual([]);
      expect(result.peaks).toEqual([]);
    }
    expect(cases[0].result.sample.sequence).toBeNull();
  });
});
