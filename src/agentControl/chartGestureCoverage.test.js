import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHART_GESTURE_REPRODUCTION } from "./chartGestureCoverage.js";
import { runningAppCommandEntries } from "./commandManifest.js";

const reference = readFileSync(
  new URL("../components/panels/chartHelp.js", import.meta.url),
  "utf8"
);
const gestureIds = [
  ...new Set([...reference.matchAll(/\bitem\(\s*"([a-z-]+)"/g)].map((m) => m[1])),
];

describe("chart gesture coverage", () => {
  it("reproduces every gesture in the panel gesture reference through Agent Control", () => {
    expect(gestureIds.length).toBeGreaterThan(20);
    const missing = gestureIds.filter((id) => !CHART_GESTURE_REPRODUCTION[id]);
    expect(missing).toEqual([]);
  });

  it("maps only to real commands, the pointer, or gestures that still exist", () => {
    const methods = new Set(runningAppCommandEntries.map(({ wireMethod }) => wireMethod));
    for (const [id, reproduction] of Object.entries(CHART_GESTURE_REPRODUCTION)) {
      expect(gestureIds, id).toContain(id);
      if (reproduction !== "pointer") expect(methods.has(reproduction), id).toBe(true);
    }
  });
});
