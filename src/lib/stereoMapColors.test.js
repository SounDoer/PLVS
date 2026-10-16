import { describe, expect, it } from "vitest";
import { resolveColors, segmentColor } from "./stereoMapColors.js";
import { STEREO_MAP_MODES as MODE } from "../math/stereoMapMath.js";

const theme = {
  primary: "#ff0000",
  secondary: "#0000ff",
  primarySnapshot: "#800000",
  secondarySnapshot: "#000080",
  critical: "#ff0000",
  warning: "#ffff00",
  good: "#00ff00",
  criticalHistory: "#800000",
  warningHistory: "#808000",
  goodHistory: "#008000",
  grid: "#888888",
};

describe("shared Stereo Map curve and readout colors", () => {
  const live = resolveColors(theme, "live");
  const snap = resolveColors(theme, "snap");
  it("uses the channel blend setting for Position", () => {
    const range = { lowerBound: -1, upperBound: 1 };
    expect(segmentColor(MODE.POSITION, 0, range, live, 50)).toBe("rgb(128, 0, 128)");
    expect(segmentColor(MODE.POSITION, -0.1, range, live, 0)).toBe("rgb(0, 0, 255)");
    expect(segmentColor(MODE.POSITION, 0.1, range, live, 0)).toBe("rgb(255, 0, 0)");
  });
  it("distinguishes Mid and Side in both live and snapshot palettes", () => {
    const range = { lowerBound: -48, upperBound: 24 };
    expect(segmentColor(MODE.MS_RATIO_DB, -3, range, live)).toBe("rgb(255, 0, 0)");
    expect(segmentColor(MODE.MS_RATIO_DB, 3, range, live)).toBe("rgb(0, 0, 255)");
    expect(segmentColor(MODE.MS_RATIO_DB, -3, range, snap)).toBe("rgb(128, 0, 0)");
    expect(segmentColor(MODE.MS_RATIO_DB, 3, range, snap)).toBe("rgb(0, 0, 128)");
  });
  it("uses signal colors for correlation and mono loss instead of channel colors", () => {
    expect(segmentColor(MODE.CORRELATION, 1, {}, live)).toBe("rgb(0, 255, 0)");
    expect(segmentColor(MODE.CORRELATION, 0, {}, live)).toBe("rgb(255, 255, 0)");
    expect(segmentColor(MODE.CORRELATION, -1, {}, snap)).toBe("rgb(128, 0, 0)");
    const range = { lowerBound: -24, upperBound: 0 };
    expect(segmentColor(MODE.MONO_LOSS_DB, -12, range, live)).toBe("rgb(255, 255, 0)");
    expect(segmentColor(MODE.MONO_LOSS_DB, 0, range, snap)).toBe("rgb(0, 128, 0)");
  });
});
