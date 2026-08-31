import { describe, expect, it } from "vitest";
import packageInfo from "../package.json";
import {
  CANDIDATE_BITS,
  codecLayout,
  decodeOpacity,
  encodeOpacity,
  gateDbFor,
  projectedBytes,
  RETENTION,
  trueOpacity,
} from "./stereo-map-opacity-codec-experiment.mjs";

describe("opacity codec experiment command", () => {
  it("is reachable by a dedicated package script", () => {
    expect(packageInfo.scripts["experiment:stereo-map-opacity-codec"]).toBe(
      "node scripts/stereo-map-opacity-codec-experiment.mjs"
    );
  });
});

describe("codec layout", () => {
  it("reserves a code for hidden, for opaque, and for no value", () => {
    const layout = codecLayout(4);
    expect(layout.codes).toBe(16);
    expect(layout.invalid).toBe(15);
    expect(layout.opaque).toBe(14);
    // 0 is hidden, 14 is opaque, 15 is invalid, so 1..13 carry the ramp.
    expect(layout.rampLevels).toBe(13);
  });
});

describe("visibility is exact, not approximate", () => {
  // The whole point of the encoding: quantization happens inside the ramp and nowhere else, so a
  // band can never be drawn when it should be gated, or gated when it should be drawn.
  it.each(CANDIDATE_BITS)("keeps the gate boundary exact at %i bits", (bits) => {
    const layout = codecLayout(bits);
    const peakDb = -12;
    const gateDb = gateDbFor(peakDb);
    for (const energyDb of [gateDb - 1, gateDb - 0.01, gateDb, gateDb + 0.01, gateDb + 1]) {
      const wanted = trueOpacity(peakDb, energyDb);
      const got = decodeOpacity(encodeOpacity(peakDb, energyDb, layout), layout);
      expect(wanted === 0).toBe(got === 0);
    }
  });

  it.each(CANDIDATE_BITS)("keeps the fully-opaque boundary exact at %i bits", (bits) => {
    const layout = codecLayout(bits);
    const peakDb = -12;
    const top = gateDbFor(peakDb) + 12;
    for (const energyDb of [top - 1, top - 0.01, top, top + 0.01, top + 1]) {
      const wanted = trueOpacity(peakDb, energyDb);
      const got = decodeOpacity(encodeOpacity(peakDb, energyDb, layout), layout);
      expect(wanted === 1).toBe(got === 1);
    }
  });

  it("round-trips a non-finite energy as no value", () => {
    const layout = codecLayout(5);
    expect(decodeOpacity(encodeOpacity(-12, Number.NaN, layout), layout)).toBeNull();
  });
});

describe("ramp resolution", () => {
  it.each([
    [4, 13],
    [5, 29],
    [6, 61],
  ])("bounds the opacity step at %i bits", (bits, rampLevels) => {
    const layout = codecLayout(bits);
    expect(layout.rampLevels).toBe(rampLevels);
    // Each ramp code is the centre of an equal bin, so the worst error is half a bin -- uniformly,
    // including at the two ends where an endpoint mapping would have cost a whole step.
    const worst = 0.5 / rampLevels;
    const peakDb = -12;
    const gateDb = gateDbFor(peakDb);
    for (let step = 0; step <= 1200; step += 1) {
      const energyDb = gateDb + (step / 1200) * 12;
      const wanted = trueOpacity(peakDb, energyDb);
      const got = decodeOpacity(encodeOpacity(peakDb, energyDb, layout), layout);
      expect(Math.abs(wanted - got)).toBeLessThanOrEqual(worst + 1e-9);
    }
  });
});

describe("retention projection", () => {
  it("prices the plane against the shipped byte-per-band one", () => {
    const four = projectedBytes(4);
    expect(four.planeBytes).toBe((RETENTION.rows * RETENTION.bands * 4) / 8);
    expect(four.savedBytes).toBe(344_880_000 - four.planeBytes);
    // Half the plane, which is about a fifth of the whole per-key slab.
    expect(four.keyTotalDelta).toBeLessThan(-0.19);
    expect(four.keyTotalDelta).toBeGreaterThan(-0.21);
  });
});
