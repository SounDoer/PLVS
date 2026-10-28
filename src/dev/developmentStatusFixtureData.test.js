import { describe, expect, it } from "vitest";
import { developmentStatusItems, STATUS_FIXTURE_NAMES } from "./developmentStatusFixtureData.js";

describe("read-only status review inputs", () => {
  it("provides all seven bounded walkthrough scenes without changing measurement state", () => {
    for (const phase of Object.keys(STATUS_FIXTURE_NAMES)) {
      const items = developmentStatusItems(phase);
      expect(items.length).toBeGreaterThan(0);
      expect(items.some((item) => item.requiresAttention)).toBe(phase === "capture-failed");
    }
    expect(developmentStatusItems("summary")).toEqual(developmentStatusItems("details"));
    expect(developmentStatusItems("layout")).toHaveLength(1);
    expect(developmentStatusItems("details")).toHaveLength(3);
  });
});
