import { describe, expect, it } from "vitest";
import { decodeCentiDb, encodeCentiDb } from "./packedHistoryCodecs.js";
import {
  decodeStereoMapRelativeEnergy,
  encodeStereoMapRelativeEnergy,
  quantizeStereoMapEnergyForDisplay,
  STEREO_MAP_ENERGY_BELOW_GATE,
  STEREO_MAP_ENERGY_INVALID,
} from "./stereoMapEnergyCodec.js";

describe("Stereo Map relative-energy codec", () => {
  it("distinguishes invalid input from finite energy below the retained range", () => {
    expect(encodeStereoMapRelativeEnergy(-12, null)).toBe(STEREO_MAP_ENERGY_INVALID);
    expect(encodeStereoMapRelativeEnergy(-12, -80)).toBe(STEREO_MAP_ENERGY_BELOW_GATE);
    expect(decodeStereoMapRelativeEnergy(-12, STEREO_MAP_ENERGY_INVALID)).toBeNull();
    expect(decodeStereoMapRelativeEnergy(-12, STEREO_MAP_ENERGY_BELOW_GATE)).toBe(-Infinity);
  });

  it("preserves gate and fully-opaque classifications for every centi-dB row peak", () => {
    for (let peakCentiDb = -12_000; peakCentiDb <= 2400; peakCentiDb += 1) {
      const peakDb = peakCentiDb / 100;
      const gateDb = Math.max(-96, peakDb - 60);
      for (const boundaryDb of [gateDb, gateDb + 12]) {
        for (const offsetDb of [-0.02, -0.01, 0, 0.01, 0.02]) {
          const energyDb = boundaryDb + offsetDb;
          if (energyDb > peakDb) continue;
          const packedEnergyDb = decodeCentiDb(encodeCentiDb(energyDb));
          const decoded = decodeStereoMapRelativeEnergy(
            peakDb,
            encodeStereoMapRelativeEnergy(peakDb, energyDb)
          );
          expect(decoded >= boundaryDb).toBe(packedEnergyDb >= boundaryDb);
        }
      }
    }
  });

  it("uses the same centi-dB anchored approximation for live display", () => {
    expect(quantizeStereoMapEnergyForDisplay(-10.004, -42.124)).toBe(-42);
    expect(quantizeStereoMapEnergyForDisplay(-10.004, -42.134)).toBe(-42.25);
  });
});
