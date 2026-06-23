import { describe, expect, it } from "vitest";
import { axisLabelClass } from "./axisLabelClasses.js";

describe("axisLabelClass", () => {
  it("keeps x-axis endpoint labels inside the chart bounds", () => {
    expect(axisLabelClass("x", "start")).toBe("absolute top-0 whitespace-nowrap left-0 text-left");
    expect(axisLabelClass("x", "middle")).toBe(
      "absolute top-0 whitespace-nowrap -translate-x-1/2 text-center"
    );
    expect(axisLabelClass("x", "end")).toBe("absolute top-0 whitespace-nowrap right-0 text-right");
  });

  it("keeps y-axis endpoint labels inside the chart bounds", () => {
    expect(axisLabelClass("y", "start")).toBe("absolute right-0 leading-none top-0");
    expect(axisLabelClass("y", "middle")).toBe("absolute right-0 leading-none -translate-y-1/2");
    expect(axisLabelClass("y", "end")).toBe("absolute right-0 leading-none bottom-0");
  });

  it("appends caller-specific classes", () => {
    expect(axisLabelClass("y", "start", "font-semibold")).toBe(
      "absolute right-0 leading-none top-0 font-semibold"
    );
  });
});
