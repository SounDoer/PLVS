/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ChartCrosshair } from "./ChartCrosshair";

describe("ChartCrosshair", () => {
  it("uses one dashed half-strength guide style for both axes", () => {
    render(<ChartCrosshair leftPct={25} topPct={75} />);

    for (const axis of ["vertical", "horizontal"]) {
      const guide = document.querySelector(`[data-chart-crosshair="${axis}"]`);
      expect(guide).not.toBeNull();
      expect(guide.className).toContain("border-dashed");
      expect(guide.className).toContain("border-muted-foreground/50");
    }
  });

  it("supports a vertical-only guide", () => {
    render(<ChartCrosshair leftPct={40} />);

    expect(document.querySelector('[data-chart-crosshair="vertical"]')).not.toBeNull();
    expect(document.querySelector('[data-chart-crosshair="horizontal"]')).toBeNull();
  });
});
