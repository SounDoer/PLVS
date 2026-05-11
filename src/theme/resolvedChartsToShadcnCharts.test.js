import { describe, expect, it } from "vitest";
import { resolvedChartsToShadcnChartCssVars } from "./resolvedChartsToShadcnCharts.js";

describe("resolvedChartsToShadcnChartCssVars", () => {
  it("maps resolved strokes to --chart-1…--chart-5 in a stable order", () => {
    const charts = {
      loudnessHistory: {
        momentaryStroke: "#a",
        shortTermStroke: "#b",
        selectionStroke: "#c",
      },
      vectorscope: { strokeLive: "#d" },
      spectrum: { strokeLive: "#e" },
    };
    expect(resolvedChartsToShadcnChartCssVars(charts)).toEqual({
      "--chart-1": "#a",
      "--chart-2": "#b",
      "--chart-3": "#d",
      "--chart-4": "#e",
      "--chart-5": "#c",
    });
  });
});
