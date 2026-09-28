import { describe, expect, it } from "vitest";
import {
  LEVEL_METER_COLORS,
  levelMeterBackground,
  levelMeterMarkerStatus,
  profileZones,
  thresholdZones,
  zonesToGradient,
} from "./levelMeterColors.js";

const { safe, warning, critical } = LEVEL_METER_COLORS;
const GRADIENT_UP = `linear-gradient(to top, ${safe} 0%, ${warning} 60%, ${critical} 100%)`;

function profile(rules) {
  return { id: "p", name: "P", referenceLufs: null, rules };
}

describe("thresholdZones", () => {
  it("starts safe, then warning, then critical", () => {
    expect(thresholdZones(-6, -1)).toEqual([
      { db: -Infinity, color: safe },
      { db: -6, color: warning },
      { db: -1, color: critical },
    ]);
  });

  it("has no warning zone when both thresholds are equal", () => {
    expect(thresholdZones(-3, -3)).toEqual([
      { db: -Infinity, color: safe },
      { db: -3, color: critical },
    ]);
  });
});

describe("profileZones", () => {
  it("returns null when no rule applies, so the caller shows the neutral colour", () => {
    expect(profileZones(null, "momentary")).toBeNull();
    expect(
      profileZones(
        profile([{ metricId: "integrated", op: ">", value: -22.5, severity: "fail" }]),
        "momentary"
      )
    ).toBeNull();
  });

  it("reads ceilings on the metric and on its Max", () => {
    const doc = profile([
      { metricId: "momentary", op: ">", value: -20, severity: "warn" },
      { metricId: "momentaryMax", op: ">", value: -16, severity: "fail" },
      { metricId: "shortTermMax", op: ">", value: -30, severity: "fail" },
    ]);
    expect(profileZones(doc, "momentary")).toEqual([
      { db: -Infinity, color: safe },
      { db: -20, color: warning },
      { db: -16, color: critical },
    ]);
  });

  it("ignores floors and blank rules", () => {
    const doc = profile([
      { metricId: "momentary", op: "<", value: -40, severity: "fail" },
      { metricId: "momentary", op: ">", value: undefined, severity: "fail" },
    ]);
    expect(profileZones(doc, "momentary")).toBeNull();
  });

  it("keeps a zone only when it is more severe than every lower one", () => {
    const doc = profile([
      { metricId: "shortTerm", op: ">", value: -20, severity: "fail" },
      { metricId: "shortTerm", op: ">", value: -18, severity: "warn" },
      { metricId: "shortTermMax", op: ">", value: -20, severity: "warn" },
    ]);
    expect(profileZones(doc, "shortTerm")).toEqual([
      { db: -Infinity, color: safe },
      { db: -20, color: critical },
    ]);
  });

  it("does not synthesise a warning zone for a single fail rule", () => {
    const doc = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);
    expect(profileZones(doc, "momentary")).toEqual([
      { db: -Infinity, color: safe },
      { db: -18, color: critical },
    ]);
  });
});

describe("zonesToGradient", () => {
  it("cuts hard at each threshold within the visible range", () => {
    expect(zonesToGradient(thresholdZones(-6, -1), -60, 3, "to top")).toBe(
      `linear-gradient(to top, ${safe} 0%, ${safe} 85.714%, ${warning} 85.714%, ` +
        `${warning} 93.651%, ${critical} 93.651%, ${critical} 100%)`
    );
  });

  it("keeps each cut on its level when the range is zoomed", () => {
    expect(zonesToGradient(thresholdZones(-12, -3), -30, 0, "to top")).toBe(
      `linear-gradient(to top, ${safe} 0%, ${safe} 60%, ${warning} 60%, ` +
        `${warning} 90%, ${critical} 90%, ${critical} 100%)`
    );
  });

  it("clamps cuts outside the visible range to its edges", () => {
    const zones = [
      { db: -Infinity, color: safe },
      { db: -70, color: critical },
    ];
    expect(zonesToGradient(zones, -64, 0, "to right")).toBe(
      `linear-gradient(to right, ${safe} 0%, ${safe} 0%, ${critical} 0%, ${critical} 100%)`
    );
  });

  it("renders a single zone as a solid image", () => {
    expect(zonesToGradient([{ db: -Infinity, color: critical }], -64, 0, "to right")).toBe(
      `linear-gradient(to right, ${critical}, ${critical})`
    );
  });
});

describe("levelMeterBackground", () => {
  const judging = profile([{ metricId: "momentaryMax", op: ">", value: -18, severity: "fail" }]);

  it("draws the same Gradient in every mode by default, whatever the thresholds or Profile", () => {
    for (const mode of ["peak", "rms", "momentary", "shortTerm"]) {
      expect(
        levelMeterBackground({
          mode,
          controls: { levelMeterPeakWarningDb: -30 },
          profileDocument: judging,
          viewMin: -30,
          viewMax: 0,
        })
      ).toBe(GRADIENT_UP);
    }
  });

  it("puts the Gradient along the direction it is given", () => {
    expect(
      levelMeterBackground({
        mode: "peak",
        controls: {},
        viewMin: -60,
        viewMax: 3,
        direction: "to right",
      })
    ).toBe(`linear-gradient(to right, ${safe} 0%, ${warning} 60%, ${critical} 100%)`);
  });

  it("uses each mode's thresholds under Level Zones", () => {
    const controls = {
      levelMeterBarColors: "levelZones",
      levelMeterPeakWarningDb: -12,
      levelMeterPeakCriticalDb: -3,
      levelMeterRmsWarningDb: -20,
      levelMeterRmsCriticalDb: -10,
    };
    const view = { viewMin: -60, viewMax: 3 };
    expect(levelMeterBackground({ mode: "peak", controls, ...view })).toBe(
      zonesToGradient(thresholdZones(-12, -3), -60, 3, "to top")
    );
    expect(levelMeterBackground({ mode: "rms", controls, ...view })).toBe(
      zonesToGradient(thresholdZones(-20, -10), -60, 3, "to top")
    );
  });

  it("falls back to the default thresholds for missing controls", () => {
    expect(
      levelMeterBackground({
        mode: "peak",
        controls: { levelMeterBarColors: "levelZones" },
        viewMin: -60,
        viewMax: 3,
      })
    ).toBe(zonesToGradient(thresholdZones(-6, -1), -60, 3, "to top"));
  });

  it("shows the trace colour for unwatched loudness modes under Level Zones", () => {
    const view = {
      controls: { levelMeterBarColors: "levelZones" },
      profileDocument: null,
      viewMin: -64,
      viewMax: 0,
    };
    expect(levelMeterBackground({ mode: "momentary", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-momentary), var(--ui-loudness-momentary))"
    );
    expect(levelMeterBackground({ mode: "shortTerm", ...view })).toBe(
      "linear-gradient(to top, var(--ui-loudness-shortterm), var(--ui-loudness-shortterm))"
    );
  });

  it("follows Profile ceilings for loudness modes under Level Zones", () => {
    expect(
      levelMeterBackground({
        mode: "momentary",
        controls: { levelMeterBarColors: "levelZones" },
        profileDocument: judging,
        viewMin: -64,
        viewMax: 0,
      })
    ).toBe(zonesToGradient(profileZones(judging, "momentary"), -64, 0, "to top"));
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
