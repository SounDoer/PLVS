import { describe, expect, it } from "vitest";
import packageInfo from "../package.json";
import {
  decodeRelativeEnergy,
  encodeRelativeEnergy,
  RELATIVE_ENERGY_MAX_DB,
  RELATIVE_ENERGY_NO_VALUE,
} from "./stereo-map-energy-codec-experiment.mjs";

describe("Stereo Map relative-energy codec experiment", () => {
  it("has a dedicated reproducible command", () => {
    expect(packageInfo.scripts["experiment:stereo-map-energy-codec"]).toBe(
      "node scripts/stereo-map-energy-codec-experiment.mjs"
    );
  });

  it("reserves 255 as the sentinel and uses all finite codes", () => {
    expect(encodeRelativeEnergy(-12, -12)).toBe(0);
    expect(encodeRelativeEnergy(-12, -12 - RELATIVE_ENERGY_MAX_DB)).toBe(254);
    expect(encodeRelativeEnergy(-12, -12 - RELATIVE_ENERGY_MAX_DB - 0.01)).toBe(
      RELATIVE_ENERGY_NO_VALUE
    );
    expect(encodeRelativeEnergy(-12, -Infinity)).toBe(RELATIVE_ENERGY_NO_VALUE);
  });

  it("rounds nearest within 0.125 dB and offers conservative ceiling rounding", () => {
    expect(decodeRelativeEnergy(-12, encodeRelativeEnergy(-12, -12.12))).toBe(-12);
    expect(decodeRelativeEnergy(-12, encodeRelativeEnergy(-12, -12.13))).toBe(-12.25);
    expect(decodeRelativeEnergy(-12, encodeRelativeEnergy(-12, -12.01, "ceiling"))).toBe(-12.25);
  });

  it("corrects the nearest code when rounding would cross the gate", () => {
    const visiblePeakDb = -40.06;
    const gateDb = -96;
    const justVisibleDb = gateDb + 0.01;
    expect(
      decodeRelativeEnergy(visiblePeakDb, encodeRelativeEnergy(visiblePeakDb, justVisibleDb))
    ).toBeLessThan(gateDb);
    expect(
      decodeRelativeEnergy(
        visiblePeakDb,
        encodeRelativeEnergy(visiblePeakDb, justVisibleDb, "gateSafe")
      )
    ).toBeGreaterThanOrEqual(gateDb);

    const hiddenPeakDb = -40.19;
    const justHiddenDb = gateDb - 0.01;
    expect(
      decodeRelativeEnergy(hiddenPeakDb, encodeRelativeEnergy(hiddenPeakDb, justHiddenDb))
    ).toBeGreaterThanOrEqual(gateDb);
    expect(
      decodeRelativeEnergy(
        hiddenPeakDb,
        encodeRelativeEnergy(hiddenPeakDb, justHiddenDb, "gateSafe")
      )
    ).toBeLessThan(gateDb);
  });

  it("preserves gate classification for every centi-dB peak near the boundary", () => {
    for (let peakCentiDb = -12_000; peakCentiDb <= 2400; peakCentiDb += 1) {
      const peakDb = peakCentiDb / 100;
      const gateDb = Math.max(-96, peakDb - 60);
      for (const offsetDb of [-0.02, -0.01, 0, 0.01, 0.02]) {
        const energyDb = gateDb + offsetDb;
        if (energyDb > peakDb) continue;
        const decoded = decodeRelativeEnergy(
          peakDb,
          encodeRelativeEnergy(peakDb, energyDb, "gateSafe")
        );
        expect(decoded >= gateDb).toBe(energyDb >= gateDb);
      }
    }
  });
});
