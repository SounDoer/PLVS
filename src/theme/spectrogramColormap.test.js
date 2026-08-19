import { describe, expect, it } from "vitest";

import { getBuiltinTheme } from "./builtinThemes.js";
import {
  buildSpectrogramLut,
  INFERNO_COLORMAP_STOPS,
  spectrogramColorFracFromHeight,
  spectrogramColorFromLut,
  spectrogramColorFrac,
} from "./spectrogramColormap.js";
import { SPECTROGRAM_DB_MIN, SPECTROGRAM_DB_MAX } from "../config/scales.js";

describe("spectrogram colormap", () => {
  it("preserves the legacy dark Inferno endpoints", () => {
    const lut = buildSpectrogramLut(INFERNO_COLORMAP_STOPS);

    expect(spectrogramColorFromLut(-100, lut)).toEqual([0, 0, 4]);
    expect(spectrogramColorFromLut(0, lut)).toEqual([252, 255, 164]);
  });

  it("clamps invalid and out-of-range dB values", () => {
    const lut = buildSpectrogramLut(INFERNO_COLORMAP_STOPS);

    expect(spectrogramColorFromLut(Number.NaN, lut)).toEqual(spectrogramColorFromLut(-100, lut));
    expect(spectrogramColorFromLut(-200, lut)).toEqual(spectrogramColorFromLut(-100, lut));
    expect(spectrogramColorFromLut(10, lut)).toEqual(spectrogramColorFromLut(0, lut));
  });

  it("uses the unified Inferno ramp for both light and dark themes", () => {
    const dark = buildSpectrogramLut(getBuiltinTheme("plvs-dark").colormap);
    const light = buildSpectrogramLut(getBuiltinTheme("plvs-light").colormap);

    expect(Array.from(light)).toEqual(Array.from(dark));
  });

  it("accepts normalized Theme V2 intensity stops", () => {
    const lut = buildSpectrogramLut([
      { position: 0, color: "#000004" },
      { position: 1, color: "#fcffa4" },
    ]);
    expect(Array.from(lut.slice(0, 3))).toEqual([0, 0, 4]);
    expect(Array.from(lut.slice(-3))).toEqual([252, 255, 164]);
  });
});

describe("spectrogramColorFrac", () => {
  it("matches the old floor-relative formula at the default floor", () => {
    for (const db of [-84, -60, -40, -20, -1, 0]) {
      const old = Math.max(
        0,
        Math.min(1, (db - SPECTROGRAM_DB_MIN) / (SPECTROGRAM_DB_MAX - SPECTROGRAM_DB_MIN))
      );
      expect(spectrogramColorFrac(db, SPECTROGRAM_DB_MIN)).toBeCloseTo(old, 10);
    }
  });

  it("does not change for a dB above the floor when the floor is raised", () => {
    const db = -20;
    expect(spectrogramColorFrac(db, SPECTROGRAM_DB_MIN)).toBe(spectrogramColorFrac(db, -60));
    expect(spectrogramColorFrac(db, -60)).toBe(spectrogramColorFrac(db, -30));
  });

  it("pins a dB at or below the floor to 0", () => {
    expect(spectrogramColorFrac(-60, -60)).toBe(0);
    expect(spectrogramColorFrac(-70, -60)).toBe(0);
  });

  it("returns 0 for non-finite input", () => {
    expect(spectrogramColorFrac(Number.NaN, -60)).toBe(0);
    expect(spectrogramColorFrac(Number.POSITIVE_INFINITY, -60)).toBe(0);
    expect(spectrogramColorFrac(Number.NEGATIVE_INFINITY, -60)).toBe(0);
  });
});

describe("spectrogramColorFracFromHeight", () => {
  it("converts a floor-relative height fraction to an absolute colour position", () => {
    // At the default floor, height fraction and colour fraction coincide -- the identity case.
    expect(spectrogramColorFracFromHeight(0, SPECTROGRAM_DB_MIN)).toBe(0);
    expect(spectrogramColorFracFromHeight(0.5, SPECTROGRAM_DB_MIN)).toBeCloseTo(0.5, 10);
    expect(spectrogramColorFracFromHeight(1, SPECTROGRAM_DB_MIN)).toBe(1);

    // A raised floor: height 0 always sits exactly on the floor, which pins to 0 regardless of
    // where the floor is; height 1 always reaches SPECTROGRAM_DB_MAX, which pins to 1 regardless
    // of the floor. The two ends stay fixed while the middle moves -- that asymmetry is the whole
    // point of recovering dB before colouring.
    expect(spectrogramColorFracFromHeight(0, -40)).toBe(0);
    expect(spectrogramColorFracFromHeight(1, -40)).toBe(1);
    // height 0.5 at dbFloor -40 recovers db = -20, i.e. (-20 - (-84)) / 84 of the way up the ramp.
    expect(spectrogramColorFracFromHeight(0.5, -40)).toBeCloseTo(64 / 84, 10);
  });
});
