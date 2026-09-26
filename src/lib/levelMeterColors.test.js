import { describe, expect, it } from "vitest";
import {
  LEVEL_METER_COLORS,
  levelMeterBackground,
  levelMeterMarkerStatus,
  profileStops,
  stopsToGradient,
  thresholdStops,
} from "./levelMeterColors.js";

const { safe, warning, critical } = LEVEL_METER_COLORS;

function profile(rules) {
  return { id: "p", name: "P", referenceLufs: null, rules };
}

describe("thresholdStops", () => {
  it("places safe at the scale minimum and each threshold at its level", () => {
    expect(thresholdStops(-60, -6, -1)).toEqual([
      { db: -60, color: safe },
      { db: -6, color: warning },
      { db: -1, color: critical },
    ]);
  });

  it("drops the warning stop when both thresholds are equal", () => {
    expect(thresholdStops(-60, -3, -3)).toEqual([
      { db: -60, color: safe },
      { db: -3, color: critical },
    ]);
  });
});

describe("profileStops", () => {
  it("returns null when no rule applies, so the caller shows the neutral colour", () => {
    expect(profileStops(null, "momentary", -64)).toBeNull();
    expect(
      profileStops(
        profile([{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }]),
        "momentary",
        -64
      )
    ).toBeNull();
  });

  it("reads ceilings on the metric and on its Max", () => {
    const doc = profile([
      { metricId: "momentary", op: ">", value: -20, severity: "warn" },
      { metricId: "momentaryMax", op: ">", value: -16, severity: "fail" },
      { metricId: "shortTermMax", op: ">", value: -30, severity: "fail" },
    ]);
    expect(profileStops(doc, "momentary", -64)).toEqual([
      { db: -64, color: safe },
      { db: -20, color: warning },
      { db: -16, color: critical },
    ]);
  });

  it("ignores floors and blank rules", () => {
    const doc = profile([
      { metricId: "momentary", op: "<", value: -40, severity: "fail" },
      { metricId: "momentary", op: ">", value: undefined, severity: "fail" },
    ]);
    expect(profileStops(doc, "momentary", -64)).toBeNull();
  });

  it("keeps a stop only when it is more severe than every lower one", () => {
    const doc = profile([
      { metricId: "shortTerm", op: ">", value: -20, severity: "fail" },
      { metricId: "shortTerm", op: ">", value: -18, severity: "warn" },
      { metricId: "shortTermMax", op: ">", value: -20, severity: "warn" },
    ]);
    expect(profileStops(doc, "shortTerm", -64)).toEqual([
      { db: -64, color: safe },
      { db: -20, color: critical },
    ]);
  });

  it("does not synthesise a warning stop for a single fail rule", () => {
    const doc = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);
    expect(profileStops(doc, "momentary", -64)).toEqual([
      { db: -64, color: safe },
      { db: -18, color: critical },
    ]);
  });

  it("drops the safe stop when the lowest threshold is at or below the scale minimum", () => {
    const doc = profile([{ metricId: "momentary", op: ">", value: -70, severity: "fail" }]);
    expect(profileStops(doc, "momentary", -64)).toEqual([{ db: -70, color: critical }]);
  });
});

describe("stopsToGradient", () => {
  it("converts levels to percentages of the visible range", () => {
    expect(stopsToGradient(thresholdStops(-60, -6, -1), -60, 3, "to top")).toBe(
      `linear-gradient(to top, ${safe} 0%, ${warning} 85.714%, ${critical} 93.651%)`
    );
  });

  it("keeps each stop on its level when the range is zoomed", () => {
    expect(stopsToGradient(thresholdStops(-60, -6, -1), -30, 0, "to top")).toBe(
      `linear-gradient(to top, ${safe} -100%, ${warning} 80%, ${critical} 96.667%)`
    );
  });

  it("renders a single stop as a solid image", () => {
    expect(stopsToGradient([{ db: -70, color: critical }], -64, 0, "to right")).toBe(
      `linear-gradient(to right, ${critical}, ${critical})`
    );
  });
});

describe("levelMeterBackground", () => {
  it("uses the mode's own thresholds for Peak and RMS", () => {
    const controls = {
      levelMeterPeakWarningDb: -12,
      levelMeterPeakCriticalDb: -3,
      levelMeterRmsWarningDb: -20,
      levelMeterRmsCriticalDb: -10,
    };
    const view = { viewMin: -60, viewMax: 3 };
    expect(levelMeterBackground({ mode: "peak", controls, ...view })).toBe(
      stopsToGradient(thresholdStops(-60, -12, -3), -60, 3, "to top")
    );
    expect(levelMeterBackground({ mode: "rms", controls, ...view })).toBe(
      stopsToGradient(thresholdStops(-60, -20, -10), -60, 3, "to top")
    );
  });

  it("falls back to the default thresholds for missing controls", () => {
    expect(levelMeterBackground({ mode: "peak", controls: {}, viewMin: -60, viewMax: 3 })).toBe(
      stopsToGradient(thresholdStops(-60, -6, -1), -60, 3, "to top")
    );
  });

  it("shows the trace colour for unwatched loudness modes", () => {
    const view = { controls: {}, profileDocument: null, viewMin: -64, viewMax: 0 };
    expect(levelMeterBackground({ mode: "momentary", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))"
    );
    expect(levelMeterBackground({ mode: "shortTerm", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-shortterm), var(--ui-loudness-shortterm))"
    );
  });

  it("follows Profile ceilings for loudness modes", () => {
    const profileDocument = profile([
      { metricId: "momentaryMax", op: ">", value: -18, severity: "fail" },
    ]);
    expect(
      levelMeterBackground({
        mode: "momentary",
        controls: {},
        profileDocument,
        viewMin: -64,
        viewMax: 0,
      })
    ).toBe(stopsToGradient(profileStops(profileDocument, "momentary", -64), -64, 0, "to top"));
  });
});

describe("levelMeterMarkerStatus", () => {
  it("is undefined when nothing judges the metric", () => {
    expect(levelMeterMarkerStatus(null, "momentary", -10)).toBeUndefined();
    expect(levelMeterMarkerStatus(profile([]), "momentary", -10)).toBeUndefined();
  });

  it("keeps the metric's own rules, floors included", () => {
    const doc = profile([{ metricId: "momentary", op: "<", value: -40, severity: "warn" }]);
    expect(levelMeterMarkerStatus(doc, "momentary", -50)).toBe("warn");
    expect(levelMeterMarkerStatus(doc, "momentary", -30)).toBe("ok");
  });

  it("adds the Max metric's ceilings and reports the worse status", () => {
    const doc = profile([
      { metricId: "shortTerm", op: ">", value: -20, severity: "warn" },
      { metricId: "shortTermMax", op: ">", value: -16, severity: "fail" },
      { metricId: "shortTermMax", op: "<", value: -40, severity: "fail" },
    ]);
    expect(levelMeterMarkerStatus(doc, "shortTerm", -18)).toBe("warn");
    expect(levelMeterMarkerStatus(doc, "shortTerm", -15)).toBe("fail");
    expect(levelMeterMarkerStatus(doc, "shortTerm", -50)).toBe("ok");
  });

  it("judges a metric watched only through its Max", () => {
    const doc = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);
    expect(levelMeterMarkerStatus(doc, "momentary", -20)).toBe("ok");
    expect(levelMeterMarkerStatus(doc, "momentary", -17)).toBe("fail");
  });
});
