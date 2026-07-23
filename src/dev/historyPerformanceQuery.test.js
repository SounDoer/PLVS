import { describe, expect, it } from "vitest";
import { historyPerformanceQuery } from "./historyPerformanceQuery.js";

describe("historyPerformanceQuery", () => {
  it("enables only the explicit 240m development query", () => {
    expect(historyPerformanceQuery({ dev: true, search: "?historyPerf=240m" })).toEqual({
      enabled: true,
      fullVisual: false,
    });
    expect(historyPerformanceQuery({ dev: false, search: "?historyPerf=240m" }).enabled).toBe(
      false
    );
    expect(historyPerformanceQuery({ dev: true, search: "?historyPerf=60m" }).enabled).toBe(false);
  });

  it("requires an explicit full visual flag", () => {
    expect(
      historyPerformanceQuery({
        dev: true,
        search: "?historyPerf=240m&historyPerfFullVisual=1",
      })
    ).toEqual({ enabled: true, fullVisual: true });
  });
});
