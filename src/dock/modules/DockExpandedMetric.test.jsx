import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { DockExpandedMetric } from "./DockExpandedMetric.jsx";

describe("DockExpandedMetric", () => {
  it("keeps the value intact and hides the unit when its cell becomes narrow", () => {
    render(<DockExpandedMetric label="M" value="-13.7" unit="LUFS" />);

    const metric = screen.getByTestId("dock-expanded-metric");
    const value = screen.getByText("-13.7");
    const unit = screen.getByTestId("dock-expanded-metric-unit");

    expect(metric.className).toContain("@container");
    expect(metric.className).toContain("overflow-hidden");
    expect(value.className).toContain("shrink-0");
    expect(unit.className).toContain("@max-[84px]:hidden");
  });

  it("supports a tighter unit threshold for dense Stats columns", () => {
    render(<DockExpandedMetric label="M" value="-13.7" unit="LUFS" unitVisibility="tight" />);

    expect(screen.getByTestId("dock-expanded-metric-unit").className).toContain(
      "@max-[68px]:hidden"
    );
  });
});
