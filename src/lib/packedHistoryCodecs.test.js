import { describe, expect, it } from "vitest";
import {
  CENTI_DB_NO_VALUE,
  STEREO_MAP_VALUE_INVALID,
  createStereoMapValuePlane,
  readStereoMapValueCode,
  sliceStereoMapValuePlane,
  stereoMapValuePlaneBytes,
  writeStereoMapValueCode,
  NORMALIZED_INVALID,
  decodeCentiDb,
  decodeNormalized,
  decodeStereoMapValue,
  encodeCentiDb,
  encodeNormalized,
  encodeStereoMapValue,
} from "./packedHistoryCodecs.js";

describe("packed history codecs", () => {
  it("round-trips centi-dB values within half a centibel", () => {
    expect(encodeCentiDb(-84.125)).toBe(-8412);
    expect(encodeCentiDb(-84.126)).toBe(-8413);
    expect(decodeCentiDb(-8412)).toBe(-84.12);
    expect(encodeCentiDb(0)).toBe(0);
    expect(Math.abs(decodeCentiDb(encodeCentiDb(12.345)) - 12.345)).toBeLessThanOrEqual(0.005);
  });

  it("keeps missing dB distinct from every finite endpoint", () => {
    expect(encodeCentiDb(-Infinity)).toBe(CENTI_DB_NO_VALUE);
    expect(encodeCentiDb(Number.NaN)).toBe(CENTI_DB_NO_VALUE);
    expect(decodeCentiDb(CENTI_DB_NO_VALUE)).toBe(-Infinity);
    expect(encodeCentiDb(-1000)).toBe(-32767);
    expect(encodeCentiDb(1000)).toBe(32767);
  });

  it("round-trips normalized signed values without aliasing invalid", () => {
    const examples = [
      [-2, -1],
      [-1, -1],
      [-0.5, -0.5],
      [0, 0],
      [0.5, 0.5],
      [1, 1],
      [2, 1],
    ];
    for (const [input, expected] of examples) {
      const packed = encodeNormalized(input);
      expect(packed).not.toBe(NORMALIZED_INVALID);
      expect(Math.abs(decodeNormalized(packed) - expected)).toBeLessThanOrEqual(1 / (2 * 32767));
    }
    expect(encodeNormalized(Number.NaN)).toBe(NORMALIZED_INVALID);
    expect(decodeNormalized(NORMALIZED_INVALID)).toBeNull();
  });

  it("keeps Stereo Map invalid and infinite states distinct from finite mode values", () => {
    expect(decodeStereoMapValue("position", encodeStereoMapValue("position", 0.25))).toBeCloseTo(
      0.25,
      3
    );
    expect(
      decodeStereoMapValue("correlation", encodeStereoMapValue("correlation", -0.75))
    ).toBeCloseTo(-0.75, 3);
    expect(
      decodeStereoMapValue("monoLossDb", encodeStereoMapValue("monoLossDb", -23.456))
    ).toBeCloseTo(-23.456, 1);
    expect(decodeStereoMapValue("msRatioDb", encodeStereoMapValue("msRatioDb", Infinity))).toBe(
      Infinity
    );
    expect(decodeStereoMapValue("monoLossDb", encodeStereoMapValue("monoLossDb", -Infinity))).toBe(
      -Infinity
    );
    expect(decodeStereoMapValue("position", encodeStereoMapValue("position", null))).toBeNull();
  });
});

describe("12-bit Stereo Map value codes", () => {
  const roundTrip = (mode, value) => decodeStereoMapValue(mode, encodeStereoMapValue(mode, value));

  it("stays an order of magnitude under what the panel can show", () => {
    // These are the numbers that make twelve bits enough: the readout shows two decimals for a
    // normalized mode and 0.1 dB for a dB one, and a 600 px plot resolves about 0.0033 and 0.24 dB.
    let worstNormalized = 0;
    for (let step = 0; step <= 20_000; step += 1) {
      const value = -1 + (step / 20_000) * 2;
      worstNormalized = Math.max(worstNormalized, Math.abs(roundTrip("position", value) - value));
    }
    expect(worstNormalized).toBeLessThan(0.0005);

    let worstDb = 0;
    for (let step = 0; step <= 20_000; step += 1) {
      const value = -96 + (step / 20_000) * 144;
      worstDb = Math.max(worstDb, Math.abs(roundTrip("msRatioDb", value) - value));
    }
    expect(worstDb).toBeLessThan(0.05);
  });

  it("orders codes by value, which is what lets Hold summaries compare them raw", () => {
    // Hold takes min/max over encoded codes rather than decoding first, so the ordering has to
    // survive the sentinels: -Infinity below every finite code, +Infinity above.
    const ascending = [-Infinity, -96, -24.5, 0, 12, 48, Infinity];
    const codes = ascending.map((value) => encodeStereoMapValue("msRatioDb", value));
    for (let i = 1; i < codes.length; i += 1) expect(codes[i]).toBeGreaterThan(codes[i - 1]);

    const normalized = [-1, -0.5, 0, 0.5, 1].map((v) => encodeStereoMapValue("position", v));
    for (let i = 1; i < normalized.length; i += 1) {
      expect(normalized[i]).toBeGreaterThan(normalized[i - 1]);
    }
    // Invalid sorts below everything and is the one code the summary skips explicitly.
    expect(STEREO_MAP_VALUE_INVALID).toBeLessThan(Math.min(...codes, ...normalized));
  });

  it("clamps a normalized mode's infinities to its bounds, as the Int16 space did", () => {
    expect(roundTrip("position", Infinity)).toBeCloseTo(1, 6);
    expect(roundTrip("correlation", -Infinity)).toBeCloseTo(-1, 6);
  });

  it("keeps every code inside twelve bits", () => {
    for (const mode of ["position", "correlation", "monoLossDb", "msRatioDb"]) {
      for (const value of [-Infinity, -1000, -1, 0, 1, 1000, Infinity, null, Number.NaN]) {
        const code = encodeStereoMapValue(mode, value);
        expect(code).toBeGreaterThanOrEqual(0);
        expect(code).toBeLessThanOrEqual(4095);
      }
    }
  });
});

describe("Stereo Map value plane", () => {
  it("round-trips every code through the split high byte and low nibble", () => {
    const plane = createStereoMapValuePlane(5);
    const codes = [0, 1, 15, 16, 2730, 4094, 4095];
    for (const code of codes) {
      for (let index = 0; index < 5; index += 1) {
        writeStereoMapValueCode(plane, index, code);
        expect(readStereoMapValueCode(plane, index)).toBe(code);
      }
    }
  });

  it("keeps neighbours intact when two entries share a low byte", () => {
    const plane = createStereoMapValuePlane(4);
    writeStereoMapValueCode(plane, 0, 4095);
    writeStereoMapValueCode(plane, 1, 0);
    expect(readStereoMapValueCode(plane, 0)).toBe(4095);
    writeStereoMapValueCode(plane, 1, 4095);
    expect(readStereoMapValueCode(plane, 0)).toBe(4095);
    expect(readStereoMapValueCode(plane, 1)).toBe(4095);
    writeStereoMapValueCode(plane, 0, 273);
    expect(readStereoMapValueCode(plane, 1)).toBe(4095);
  });

  it("reads as invalid before anything is written", () => {
    const plane = createStereoMapValuePlane(3);
    expect(readStereoMapValueCode(plane, 0)).toBe(STEREO_MAP_VALUE_INVALID);
    expect(decodeStereoMapValue("position", readStereoMapValueCode(plane, 2))).toBeNull();
  });

  it("costs twelve bits an entry, and slices without losing nibble alignment", () => {
    const plane = createStereoMapValuePlane(8);
    expect(stereoMapValuePlaneBytes(plane)).toBe(12);
    for (let index = 0; index < 8; index += 1) writeStereoMapValueCode(plane, index, 4000 + index);
    const sliced = sliceStereoMapValuePlane(plane, 4);
    expect(stereoMapValuePlaneBytes(sliced)).toBe(6);
    for (let index = 0; index < 4; index += 1) {
      expect(readStereoMapValueCode(sliced, index)).toBe(4000 + index);
    }
  });
});
