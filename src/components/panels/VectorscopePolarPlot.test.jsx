/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { VectorscopePolarPlot } from "./VectorscopePolarPlot.jsx";

function contextStub() {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  };
}

describe("VectorscopePolarPlot", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 200,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 160,
    });
  });

  it("draws Polar Sample as points and shows endpoint labels", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const { container } = render(
      <VectorscopePolarPlot
        mode="polarSample"
        rows={[{ pairs: new Float32Array([1, 1, 0, 1]), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
      />
    );

    expect(container.querySelector('[data-vectorscope-polar="polarSample"]')).toBeTruthy();
    expect(screen.getByText("L")).toBeTruthy();
    expect(screen.getByText("R")).toBeTruthy();
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it("draws a filled Polar Level envelope", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const { container } = render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([1, 1, 0, 1]), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
      />
    );

    expect(container.querySelector('[data-vectorscope-polar="polarLevel"]')).toBeTruthy();
    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.closePath).toHaveBeenCalled();
  });

  it("hides endpoint labels in compact plots", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarSample"
        snapshotPairs={new Float32Array([1, 1])}
        hasSignal
        firstLabel="L"
        secondLabel="R"
        showLabels={false}
      />
    );

    expect(screen.queryByText("L")).toBeNull();
    expect(screen.queryByText("R")).toBeNull();
  });

  it("does not draw a Peak hold outline in snapshot mode", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarLevel"
        snapshotPairs={new Float32Array([1, 1])}
        hasSignal
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );

    // Grid + current envelope; a live Peak hold would add a third stroke.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
  });
});
