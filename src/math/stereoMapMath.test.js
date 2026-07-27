import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CAL_OFFSET_DB,
  STEREO_MAP_MODES,
  createStereoMapDerivationScratch,
  deriveStereoMapPoint,
  deriveStereoMapRow,
  visitStereoMapDerivedPoints,
} from "./stereoMapMath.js";

const NORMALIZED_RANGE = { lowerBound: -1, upperBound: 1 };
const DB_RANGE = { lowerBound: -24, upperBound: 24 };

function primitiveRow(pl, pr, c) {
  return {
    bandCentersHz: pl.map((_, index) => 100 * 2 ** index),
    pl,
    pr,
    c,
  };
}

function expectPointValue(point, expected) {
  if (expected === null) {
    expect(point).toEqual({ state: "invalid" });
  } else if (expected === Infinity) {
    expect(point).toEqual({ state: "aboveRange", value: DB_RANGE.upperBound, opacity: 1 });
  } else if (expected === -Infinity) {
    expect(point).toEqual({ state: "belowRange", value: DB_RANGE.lowerBound, opacity: 1 });
  } else {
    expect(point.state).toBe("finite");
    expect(point.value).toBeCloseTo(expected, 10);
    expect(point.opacity).toBe(1);
  }
}

it("visits all modes with one normalization pass and no derived row arrays", () => {
  const source = primitiveRow([1, 1, 1], [1, 1, 1], [0, -1, 1]);
  const reads = { pl: 0, pr: 0, c: 0 };
  for (const field of Object.keys(reads)) {
    source[field] = new Proxy(source[field], {
      get(target, property, receiver) {
        if (/^\d+$/.test(String(property))) reads[field] += 1;
        return Reflect.get(target, property, receiver);
      },
    });
  }
  const scratch = createStereoMapDerivationScratch(3);
  const instrumentation = {
    rows: 0,
    normalizedBands: 0,
    visitedPoints: 0,
    derivedRowArrayAllocations: 0,
  };
  const values = new Map();

  const metadata = visitStereoMapDerivedPoints(
    source,
    (mode, index, value, state, opacity) => {
      values.set(`${mode}:${index}`, { value, state, opacity });
    },
    scratch,
    instrumentation
  );

  expect(reads).toEqual({ pl: 3, pr: 3, c: 3 });
  expect(instrumentation).toEqual({
    rows: 1,
    normalizedBands: 3,
    visitedPoints: 12,
    derivedRowArrayAllocations: 0,
  });
  expect(metadata.fullGridPeakDb).toBeCloseTo(CAL_OFFSET_DB + 10 * Math.log10(2));
  expect(values.get(`${STEREO_MAP_MODES.MONO_LOSS_DB}:1`).value).toBe(-Infinity);
  expect(values.get(`${STEREO_MAP_MODES.MS_RATIO_DB}:1`).value).toBe(Infinity);
});

describe("deriveStereoMapPoint", () => {
  const fixtures = [
    {
      name: "equal-energy in-phase",
      primitive: { pl: 1, pr: 1, c: 1 },
      expected: {
        position: 0,
        correlation: 1,
        monoLossDb: 0,
        msRatioDb: -Infinity,
      },
    },
    {
      name: "equal-energy uncorrelated",
      primitive: { pl: 1, pr: 1, c: 0 },
      expected: {
        position: 0,
        correlation: 0,
        monoLossDb: 10 * Math.log10(0.5),
        msRatioDb: 0,
      },
    },
    {
      name: "equal-energy correlation -0.5",
      primitive: { pl: 1, pr: 1, c: -0.5 },
      expected: {
        position: 0,
        correlation: -0.5,
        monoLossDb: 10 * Math.log10(0.25),
        msRatioDb: 10 * Math.log10(3),
      },
    },
    {
      name: "equal-energy anti-phase",
      primitive: { pl: 1, pr: 1, c: -1 },
      expected: {
        position: 0,
        correlation: -1,
        monoLossDb: -Infinity,
        msRatioDb: Infinity,
      },
    },
    {
      name: "unequal in-phase amplitudes",
      primitive: { pl: 4, pr: 1, c: 2 },
      expected: {
        position: 0.6,
        correlation: 1,
        monoLossDb: 0,
        msRatioDb: 10 * Math.log10(1 / 9),
      },
    },
    {
      name: "single-sided hard pan",
      primitive: { pl: 1, pr: 0, c: 0 },
      expected: {
        position: 1,
        correlation: null,
        monoLossDb: 0,
        msRatioDb: 0,
      },
    },
  ];

  for (const fixture of fixtures) {
    for (const mode of Object.values(STEREO_MAP_MODES)) {
      it(`${fixture.name}: ${mode}`, () => {
        const range =
          mode === STEREO_MAP_MODES.POSITION || mode === STEREO_MAP_MODES.CORRELATION
            ? NORMALIZED_RANGE
            : DB_RANGE;
        const point = deriveStereoMapPoint(mode, fixture.primitive, range);
        expectPointValue(point, fixture.expected[mode]);
      });
    }
  }

  it("clamps finite negative powers to zero before every formula", () => {
    expect(
      deriveStereoMapPoint(STEREO_MAP_MODES.MONO_LOSS_DB, { pl: 1, pr: -4, c: -99 }, DB_RANGE)
    ).toEqual({ state: "finite", value: 0, opacity: 1 });
  });

  it("clamps C to the Cauchy bound before every formula", () => {
    const high = { pl: 4, pr: 1, c: 99 };
    const low = { pl: 4, pr: 1, c: -99 };

    expect(deriveStereoMapPoint(STEREO_MAP_MODES.CORRELATION, high, NORMALIZED_RANGE).value).toBe(
      1
    );
    expect(deriveStereoMapPoint(STEREO_MAP_MODES.CORRELATION, low, NORMALIZED_RANGE).value).toBe(
      -1
    );
    expect(deriveStereoMapPoint(STEREO_MAP_MODES.MONO_LOSS_DB, high, DB_RANGE).value).toBe(0);
    expect(deriveStereoMapPoint(STEREO_MAP_MODES.MS_RATIO_DB, low, DB_RANGE).value).toBeCloseTo(
      10 * Math.log10(9),
      10
    );
  });

  it("keeps full correlation valid across the largest finite power ratio and its channel swap", () => {
    const cauchyProduct = Math.sqrt(Number.MAX_VALUE) * Math.sqrt(Number.MIN_VALUE);
    const pairs = [
      { pl: Number.MAX_VALUE, pr: Number.MIN_VALUE, position: 1 },
      { pl: Number.MIN_VALUE, pr: Number.MAX_VALUE, position: -1 },
    ];

    for (const { pl, pr, position } of pairs) {
      expect(
        deriveStereoMapPoint(
          STEREO_MAP_MODES.POSITION,
          { pl, pr, c: cauchyProduct },
          NORMALIZED_RANGE
        )
      ).toEqual({ state: "finite", value: position, opacity: 1 });

      for (const sign of [1, -1]) {
        const primitive = { pl, pr, c: sign * cauchyProduct };
        expect(
          deriveStereoMapPoint(STEREO_MAP_MODES.CORRELATION, primitive, NORMALIZED_RANGE)
        ).toEqual({ state: "finite", value: sign, opacity: 1 });
        expect(deriveStereoMapPoint(STEREO_MAP_MODES.MONO_LOSS_DB, primitive, DB_RANGE)).toEqual({
          state: "finite",
          value: 0,
          opacity: 1,
        });
        expect(deriveStereoMapPoint(STEREO_MAP_MODES.MS_RATIO_DB, primitive, DB_RANGE)).toEqual({
          state: "finite",
          value: 0,
          opacity: 1,
        });
      }
    }
  });

  it.each([
    { pl: NaN, pr: 1, c: 0 },
    { pl: 1, pr: Infinity, c: 0 },
    { pl: 1, pr: 1, c: -Infinity },
  ])("returns invalid for non-finite primitive %#", (primitive) => {
    expect(deriveStereoMapPoint(STEREO_MAP_MODES.POSITION, primitive, NORMALIZED_RANGE)).toEqual({
      state: "invalid",
    });
  });

  it("breaks zero-over-zero denominators instead of fabricating zero", () => {
    const silence = { pl: 0, pr: 0, c: 0 };
    for (const mode of Object.values(STEREO_MAP_MODES)) {
      expect(deriveStereoMapPoint(mode, silence, DB_RANGE)).toEqual({ state: "invalid" });
    }
  });

  it("preserves valid formula infinities as clipped range states", () => {
    expect(
      deriveStereoMapPoint(
        STEREO_MAP_MODES.MONO_LOSS_DB,
        { pl: 1, pr: 1, c: -1 },
        { lowerBound: -12, upperBound: 0 }
      )
    ).toEqual({ state: "belowRange", value: -12, opacity: 1 });
    expect(
      deriveStereoMapPoint(
        STEREO_MAP_MODES.MS_RATIO_DB,
        { pl: 1, pr: 1, c: -1 },
        { lowerBound: -48, upperBound: 24 }
      )
    ).toEqual({ state: "aboveRange", value: 24, opacity: 1 });
  });

  it("returns only the clipped bound for finite out-of-range values", () => {
    expect(
      deriveStereoMapPoint(
        STEREO_MAP_MODES.MS_RATIO_DB,
        { pl: 1, pr: 1, c: -0.5 },
        { lowerBound: -3, upperBound: 3 },
        0.25
      )
    ).toEqual({ state: "aboveRange", value: 3, opacity: 0.25 });
  });

  it.each([
    [{ lowerBound: 1, upperBound: -1 }, RangeError],
    [{ lowerBound: 0, upperBound: 0 }, RangeError],
    [{ lowerBound: -Infinity, upperBound: 1 }, TypeError],
  ])("rejects invalid range contract %#", (range, ErrorType) => {
    expect(() =>
      deriveStereoMapPoint(STEREO_MAP_MODES.POSITION, { pl: 1, pr: 1, c: 0 }, range)
    ).toThrow(ErrorType);
  });
});

describe("deriveStereoMapRow", () => {
  it("keeps equal maximum finite powers exact without overflowing formula sums", () => {
    const primitive = primitiveRow([Number.MAX_VALUE], [Number.MAX_VALUE], [Number.MAX_VALUE]);
    const expected = new Map([
      [STEREO_MAP_MODES.POSITION, 0],
      [STEREO_MAP_MODES.CORRELATION, 1],
      [STEREO_MAP_MODES.MONO_LOSS_DB, 0],
      [STEREO_MAP_MODES.MS_RATIO_DB, -Infinity],
    ]);

    for (const [mode, value] of expected) {
      const range =
        mode === STEREO_MAP_MODES.POSITION || mode === STEREO_MAP_MODES.CORRELATION
          ? NORMALIZED_RANGE
          : DB_RANGE;
      expect(deriveStereoMapRow(mode, primitive, range).values).toEqual([value]);
    }
  });

  it("computes energy, gate, and opacity once from the complete row", () => {
    const gateEnergy = 1e-6;
    const row = deriveStereoMapRow(
      STEREO_MAP_MODES.POSITION,
      primitiveRow(
        [0.5, gateEnergy / 20, gateEnergy * 10 ** (6 / 10) * 0.5, 0],
        [0.5, gateEnergy / 20, gateEnergy * 10 ** (6 / 10) * 0.5, 0],
        [0, 0, 0, 0]
      ),
      NORMALIZED_RANGE
    );

    expect(row.fullGridPeakDb).toBeCloseTo(CAL_OFFSET_DB, 10);
    expect(row.gateDb).toBeCloseTo(CAL_OFFSET_DB - 60, 10);
    expect(row.energyDb[1]).toBeCloseTo(CAL_OFFSET_DB - 70, 10);
    expect(row.points[1]).toEqual({ state: "invalid" });
    expect(row.points[2].state).toBe("finite");
    expect(row.points[2].opacity).toBeCloseTo(0.5, 10);
    expect(row.points[0].opacity).toBe(1);
    expect(row.points[3]).toEqual({ state: "invalid" });
  });

  it("floors gateDb at -96 analysis dB", () => {
    const energy = 10 ** ((-80 - CAL_OFFSET_DB) / 10);
    const row = deriveStereoMapRow(
      STEREO_MAP_MODES.POSITION,
      primitiveRow([energy], [0], [0]),
      NORMALIZED_RANGE
    );

    expect(row.fullGridPeakDb).toBeCloseTo(-80, 10);
    expect(row.gateDb).toBe(-96);
    expect(row.points[0].opacity).toBe(1);
  });

  it("retains raw unclipped values separately for Hold reuse", () => {
    const row = deriveStereoMapRow(STEREO_MAP_MODES.MS_RATIO_DB, primitiveRow([1], [1], [-1]), {
      lowerBound: -48,
      upperBound: 24,
    });

    expect(row.values).toEqual([Infinity]);
    expect(row.points).toEqual([{ state: "aboveRange", value: 24, opacity: 1 }]);
  });

  it("uses the complete row peak even when a caller later displays a subset", () => {
    const quiet = 10 ** ((-80 - CAL_OFFSET_DB) / 10);
    const loud = 1;
    const row = deriveStereoMapRow(
      STEREO_MAP_MODES.POSITION,
      primitiveRow([quiet, loud], [0, 0], [0, 0]),
      NORMALIZED_RANGE
    );

    expect(row.gateDb).toBeCloseTo(CAL_OFFSET_DB - 60, 10);
    expect(row.points[0]).toEqual({ state: "invalid" });
  });

  it("marks non-finite primitives invalid without poisoning the row peak", () => {
    const row = deriveStereoMapRow(
      STEREO_MAP_MODES.POSITION,
      primitiveRow([NaN, 1], [1, 0], [0, 0]),
      NORMALIZED_RANGE
    );

    expect(row.energyDb[0]).toBeNull();
    expect(row.values[0]).toBeNull();
    expect(row.points[0]).toEqual({ state: "invalid" });
    expect(row.fullGridPeakDb).toBeCloseTo(CAL_OFFSET_DB, 10);
  });

  it("requires aligned primitive arrays", () => {
    expect(() =>
      deriveStereoMapRow(
        STEREO_MAP_MODES.POSITION,
        { bandCentersHz: [100], pl: [1], pr: [], c: [0] },
        NORMALIZED_RANGE
      )
    ).toThrow(TypeError);
  });

  it("requires bandCentersHz to align with every primitive plane", () => {
    expect(() =>
      deriveStereoMapRow(
        STEREO_MAP_MODES.POSITION,
        { bandCentersHz: [100], pl: [1, 2], pr: [1, 2], c: [0, 0] },
        NORMALIZED_RANGE
      )
    ).toThrow(TypeError);
  });

  it("rejects any non-finite band center", () => {
    expect(() =>
      deriveStereoMapRow(
        STEREO_MAP_MODES.POSITION,
        { bandCentersHz: [100, Infinity], pl: [1, 2], pr: [1, 2], c: [0, 0] },
        NORMALIZED_RANGE
      )
    ).toThrow(TypeError);
  });

  it("preserves the validated IPC frequency-grid reference in the derived row", () => {
    const bandCentersHz = new Float32Array([100, 200]);
    const row = deriveStereoMapRow(
      STEREO_MAP_MODES.POSITION,
      {
        bandCentersHz,
        pl: new Float32Array([1, 1]),
        pr: new Float32Array([1, 1]),
        c: new Float32Array([0, 0]),
      },
      NORMALIZED_RANGE
    );

    expect(row.bandCentersHz).toBe(bandCentersHz);
    expect([...row.bandCentersHz]).toEqual([100, 200]);
  });
});

describe("CAL_OFFSET_DB contract", () => {
  it("matches the explicitly named Rust spectrum calibration constant", () => {
    const rustSource = readFileSync(
      new URL("../../src-tauri/src/dsp/spectrum_bank.rs", import.meta.url),
      "utf8"
    );
    const declaration = rustSource.match(
      /\bpub\s+const\s+CAL_OFFSET_DB\s*:\s*f64\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)\s*;/
    );

    expect(declaration, "Rust CAL_OFFSET_DB declaration").not.toBeNull();
    expect(CAL_OFFSET_DB).toBe(Number(declaration[1]));
  });
});
