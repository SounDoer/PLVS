import { describe, expect, it } from "vitest";
import {
  STEREO_MAP_OPACITY_HIDDEN,
  STEREO_MAP_OPACITY_INVALID,
  STEREO_MAP_OPACITY_OPAQUE,
  STEREO_MAP_OPACITY_RAMP_LEVELS,
  STEREO_MAP_OPACITY_WORST_ERROR,
  createStereoMapOpacityPlane,
  decodeStereoMapOpacity,
  encodeStereoMapOpacity,
  readStereoMapOpacityCode,
  sliceStereoMapOpacityPlane,
  stereoMapGateDb,
  stereoMapOpacityFor,
  writeStereoMapOpacityCode,
} from "./stereoMapOpacityCodec.js";

const PEAK_DB = -12;
const GATE_DB = stereoMapGateDb(PEAK_DB);

describe("visibility classification is exact", () => {
  // This is the property the codec exists for: quantization is confined to the ramp, so a band is
  // never drawn when it should be gated, or gated when it should be drawn.
  it("puts everything at or below the gate in the hidden code", () => {
    for (const energyDb of [GATE_DB - 40, GATE_DB - 1, GATE_DB - 0.01, GATE_DB]) {
      expect(encodeStereoMapOpacity(PEAK_DB, energyDb)).toBe(STEREO_MAP_OPACITY_HIDDEN);
      expect(decodeStereoMapOpacity(encodeStereoMapOpacity(PEAK_DB, energyDb))).toBe(0);
    }
  });

  it("puts everything at or above the top of the fade in the opaque code", () => {
    const top = GATE_DB + 12;
    for (const energyDb of [top, top + 0.01, top + 30]) {
      expect(encodeStereoMapOpacity(PEAK_DB, energyDb)).toBe(STEREO_MAP_OPACITY_OPAQUE);
      expect(decodeStereoMapOpacity(encodeStereoMapOpacity(PEAK_DB, energyDb))).toBe(1);
    }
  });

  it("keeps a band just inside the ramp visible but not solid", () => {
    for (const energyDb of [GATE_DB + 0.01, GATE_DB + 11.99]) {
      const opacity = decodeStereoMapOpacity(encodeStereoMapOpacity(PEAK_DB, energyDb));
      expect(opacity).toBeGreaterThan(0);
      expect(opacity).toBeLessThan(1);
    }
  });

  it("reports no value for a non-finite input rather than guessing hidden", () => {
    expect(encodeStereoMapOpacity(PEAK_DB, Number.NaN)).toBe(STEREO_MAP_OPACITY_INVALID);
    expect(encodeStereoMapOpacity(Number.NaN, -30)).toBe(STEREO_MAP_OPACITY_INVALID);
    expect(decodeStereoMapOpacity(STEREO_MAP_OPACITY_INVALID)).toBeNull();
  });
});

describe("ramp resolution", () => {
  it("stays within half a bin across the whole fade", () => {
    for (let step = 0; step <= 1200; step += 1) {
      const energyDb = GATE_DB + (step / 1200) * 12;
      const wanted = stereoMapOpacityFor(PEAK_DB, energyDb);
      const got = decodeStereoMapOpacity(encodeStereoMapOpacity(PEAK_DB, energyDb));
      expect(Math.abs(wanted - got)).toBeLessThanOrEqual(STEREO_MAP_OPACITY_WORST_ERROR + 1e-9);
    }
  });

  it("spends every ramp code", () => {
    const seen = new Set();
    for (let step = 0; step <= 1200; step += 1) {
      seen.add(encodeStereoMapOpacity(PEAK_DB, GATE_DB + (step / 1200) * 12));
    }
    for (let code = 1; code <= STEREO_MAP_OPACITY_RAMP_LEVELS; code += 1) {
      expect(seen.has(code)).toBe(true);
    }
  });
});

describe("nibble plane", () => {
  it("reads as no value before anything is written", () => {
    // A chunk is allocated before its rows exist, and an unwritten band must not render as hidden:
    // hidden is a real state a band can be in.
    const plane = createStereoMapOpacityPlane(4);
    for (let index = 0; index < 4; index += 1) {
      expect(readStereoMapOpacityCode(plane, index)).toBe(STEREO_MAP_OPACITY_INVALID);
    }
  });

  it("keeps neighbouring entries independent inside a shared byte", () => {
    const plane = createStereoMapOpacityPlane(2);
    writeStereoMapOpacityCode(plane, 0, 3);
    writeStereoMapOpacityCode(plane, 1, 12);
    expect(readStereoMapOpacityCode(plane, 0)).toBe(3);
    expect(readStereoMapOpacityCode(plane, 1)).toBe(12);
    writeStereoMapOpacityCode(plane, 0, 9);
    expect(readStereoMapOpacityCode(plane, 1)).toBe(12);
  });

  it("packs two entries per byte", () => {
    expect(createStereoMapOpacityPlane(958).byteLength).toBe(479);
    expect(createStereoMapOpacityPlane(957).byteLength).toBe(479);
    expect(sliceStereoMapOpacityPlane(createStereoMapOpacityPlane(958), 4).byteLength).toBe(2);
  });
});
