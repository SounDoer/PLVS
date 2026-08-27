import { describe, expect, it } from "vitest";
import {
  CENTI_DB_NO_VALUE,
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
      4
    );
    expect(
      decodeStereoMapValue("correlation", encodeStereoMapValue("correlation", -0.75))
    ).toBeCloseTo(-0.75, 4);
    expect(decodeStereoMapValue("monoLossDb", encodeStereoMapValue("monoLossDb", -23.456))).toBe(
      -23.46
    );
    expect(decodeStereoMapValue("msRatioDb", encodeStereoMapValue("msRatioDb", Infinity))).toBe(
      Infinity
    );
    expect(decodeStereoMapValue("monoLossDb", encodeStereoMapValue("monoLossDb", -Infinity))).toBe(
      -Infinity
    );
    expect(decodeStereoMapValue("position", encodeStereoMapValue("position", null))).toBeNull();
  });
});
