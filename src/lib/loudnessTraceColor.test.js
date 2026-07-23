import { describe, it, expect } from "vitest";
import { loudnessTraceGradientStops } from "./loudnessTraceColor.js";

const yRange = { min: -40, max: 0 };
const NORMAL = "var(--ui-loudness-momentary)";

function stopsColors(rules) {
  const stops = loudnessTraceGradientStops(rules, yRange, NORMAL);
  return stops && stops.map((s) => s.color);
}

describe("loudnessTraceGradientStops", () => {
  it("returns null when there are no filled rules", () => {
    expect(loudnessTraceGradientStops([], yRange, NORMAL)).toBeNull();
    expect(
      loudnessTraceGradientStops([{ metricId: "m", op: ">", severity: "fail" }], yRange, NORMAL)
    ).toBeNull();
  });

  it("returns null when nothing breaches inside the visible range", () => {
    // A ceiling above the top of the range: the whole visible trace is below it, so nothing tints.
    expect(
      loudnessTraceGradientStops([{ op: ">", value: 5, severity: "fail" }], yRange, NORMAL)
    ).toBeNull();
  });

  it("tints above a ceiling and leaves the rest normal", () => {
    const stops = loudnessTraceGradientStops(
      [{ op: ">", value: -10, severity: "fail" }],
      yRange,
      NORMAL
    );
    // Top band (0..-10) is the breach; bottom band (-10..-40) is normal.
    expect(stops[0]).toEqual({ offset: 0, color: "var(--ui-signal-bad)" });
    expect(stops[1].color).toBe("var(--ui-signal-bad)");
    expect(stops[2].color).toBe(NORMAL);
    expect(stops.at(-1)).toEqual({ offset: 1, color: NORMAL });
    // The colour changes at the threshold's offset.
    expect(stops[1].offset).toBeCloseTo((0 - -10) / (0 - -40));
  });

  it("tints below a floor", () => {
    const colors = stopsColors([{ op: "<", value: -30, severity: "warn" }]);
    // Top band normal, bottom band (below -30) warns.
    expect(colors[0]).toBe(NORMAL);
    expect(colors.at(-1)).toBe("var(--ui-signal-warn)");
  });

  it("tints both ends of a band, leaving the middle normal", () => {
    const colors = stopsColors([
      { op: ">", value: -10, severity: "fail" },
      { op: "<", value: -30, severity: "fail" },
    ]);
    expect(colors[0]).toBe("var(--ui-signal-bad)"); // top: too loud
    expect(colors).toContain(NORMAL); // middle: in spec
    expect(colors.at(-1)).toBe("var(--ui-signal-bad)"); // bottom: too quiet
  });

  it("takes the most severe rule where warn and fail overlap", () => {
    const colors = stopsColors([
      { op: ">", value: -20, severity: "warn" },
      { op: ">", value: -10, severity: "fail" },
    ]);
    // Above -10: fail. Between -20 and -10: warn. Below -20: normal.
    expect(colors[0]).toBe("var(--ui-signal-bad)");
    expect(colors).toContain("var(--ui-signal-warn)");
    expect(colors.at(-1)).toBe(NORMAL);
  });
});
