import { expect, it } from "vitest";
import { fitFileMetrics, normalizeFileSummaryMetrics } from "./fileSummaryPreferences.js";
import { buildProfileSnapshot } from "../persistence/profileShape.js";

it("defaults older configurations, keeps an explicit empty selection and drops unknown choices", () => {
  expect(normalizeFileSummaryMetrics(undefined).visible).toEqual(["integrated", "lra", "truePeak"]);
  expect(normalizeFileSummaryMetrics({ visible: [] }).visible).toEqual([]);
  expect(
    normalizeFileSummaryMetrics({
      order: ["truePeak", "truePeak", "foreign"],
      visible: ["lra", "foreign", "truePeak"],
    }).visible
  ).toEqual(["truePeak", "lra"]);
});

it("carries the preference through configuration transfer independently of presets", () => {
  const snapshot = buildProfileSnapshot({ settings: { fileSummaryMetrics: { visible: [] } } });
  expect(snapshot.settings.fileSummaryMetrics.visible).toEqual([]);
  expect(snapshot.presets.list).toEqual([]);
});

it("keeps complete prefix columns and reserves overflow width only when necessary", () => {
  expect(fitFileMetrics(300, [80, 80, 80], 10, 24)).toBe(3);
  expect(fitFileMetrics(180, [80, 80, 80], 10, 24)).toBe(1);
  expect(fitFileMetrics(90, [80, 20], 10, 24)).toBe(0);
  expect(fitFileMetrics(0, [], 10, 24)).toBe(0);
});
