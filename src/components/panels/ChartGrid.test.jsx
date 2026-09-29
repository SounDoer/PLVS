/** @vitest-environment jsdom */

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChartGrid, interiorGridTicks } from "./ChartGrid.jsx";

describe("ChartGrid", () => {
  it("omits boundary and invalid ticks", () => {
    expect(
      interiorGridTicks([
        { key: "start", frac: 0 },
        { key: "quarter", frac: 0.25 },
        { key: "end", frac: 1 },
        { key: "invalid", frac: Number.NaN },
      ])
    ).toEqual([{ key: "quarter", frac: 0.25 }]);
  });

  it("renders nothing while Grid is off", () => {
    const { container } = render(
      <svg>
        <ChartGrid visible={false} width={100} height={50} stroke="red" />
      </svg>
    );
    expect(container.querySelector("[data-test-grid]")).toBeNull();
  });

  it("renders interior axis ticks as one-CSS-pixel non-scaling lines", () => {
    const { container } = render(
      <svg>
        <ChartGrid
          visible
          name="test"
          width={100}
          height={50}
          stroke="red"
          xTicks={[{ key: "x", frac: 0.25 }]}
          yTicks={[{ key: "y", frac: 0.5 }]}
        />
      </svg>
    );
    const lines = [...container.querySelectorAll("[data-test-grid] line")];
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line.getAttribute("stroke-width"))).toEqual(["1", "1"]);
    expect(lines.every((line) => line.getAttribute("vector-effect") === "non-scaling-stroke")).toBe(
      true
    );
    expect(lines[0].getAttribute("x1")).toBe("25");
    expect(lines[1].getAttribute("y1")).toBe("25");
  });
});
