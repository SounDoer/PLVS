import { describe, expect, it } from "vitest";

import { getBuiltinTheme } from "./builtinThemes.js";
import {
  buildSpectrogramLut,
  INFERNO_COLORMAP_STOPS,
  spectrogramColorFromLut,
} from "./spectrogramColormap.js";

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
});
