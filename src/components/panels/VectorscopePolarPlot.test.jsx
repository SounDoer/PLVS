/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { VectorscopePolarPlot } from "./VectorscopePolarPlot.jsx";

function contextStub() {
  let currentPath = [];
  const filledPaths = [];
  const strokedPaths = [];
  const filledColors = [];
  const strokedColors = [];
  const filledAlphas = [];
  const strokedAlphas = [];
  const ctx = {
    filledPaths,
    strokedPaths,
    filledColors,
    strokedColors,
    filledAlphas,
    strokedAlphas,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(() => {
      currentPath = [];
    }),
    closePath: vi.fn(() => {
      currentPath.push({ command: "closePath" });
    }),
    arc: vi.fn((x, y, radius, startAngle, endAngle) => {
      currentPath.push({ command: "arc", x, y, radius, startAngle, endAngle });
    }),
    moveTo: vi.fn((x, y) => {
      currentPath.push({ command: "moveTo", x, y });
    }),
    lineTo: vi.fn((x, y) => {
      currentPath.push({ command: "lineTo", x, y });
    }),
    fill: vi.fn(() => {
      filledPaths.push(currentPath.map((entry) => ({ ...entry })));
      filledColors.push(ctx.fillStyle);
      filledAlphas.push(ctx.globalAlpha);
    }),
    stroke: vi.fn(() => {
      strokedPaths.push(currentPath.map((entry) => ({ ...entry })));
      strokedColors.push(ctx.strokeStyle);
      strokedAlphas.push(ctx.globalAlpha);
    }),
  };
  return ctx;
}

function allPolarLevelBinPairs() {
  const pairs = new Float32Array(64 * 2);
  for (let index = 0; index < 64; index += 1) {
    const angle = -Math.PI / 2 + (index / 63) * Math.PI;
    const side = Math.sin(angle);
    const mid = Math.cos(angle);
    pairs[index * 2] = (mid - side) / Math.SQRT2;
    pairs[index * 2 + 1] = (mid + side) / Math.SQRT2;
  }
  return pairs;
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

  it("leaves Polar Sample empty at the silence floor", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarSample"
        rows={[{ pairs: new Float32Array([0, 0, 0.000001, 0]), ageMs: 0, timestampMs: 100 }]}
        firstLabel="L"
        secondLabel="R"
      />
    );

    expect(ctx.fill).not.toHaveBeenCalled();
  });

  it("positions Polar Sample points on the fixed decibel scale independent of window loudness", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarSample"
        rows={[{ pairs: new Float32Array([1, 1, 0.25, 0.25]), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
      />
    );

    // Full-scale mono reaches the arc; a quiet mono sample sits at its own fixed
    // dB radius rather than being magnified by the louder sample in the window.
    const fullScale = ctx.arc.mock.calls.find(([, y]) => y < 61);
    const quiet = ctx.arc.mock.calls.find(([, y]) => y > 82 && y < 83);
    expect(fullScale?.[0]).toBeCloseTo(100);
    expect(fullScale?.[1]).toBeCloseTo(60);
    expect(quiet?.[0]).toBeCloseTo(100);
  });

  it("draws Polar Level as a single continuous filled fan", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: allPolarLevelBinPairs(), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
      />
    );

    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledOnce();

    const fanPath = ctx.filledPaths[0];
    expect(fanPath[0]).toMatchObject({ command: "moveTo", x: 100, y: 150 });
    expect(fanPath.at(-1)).toMatchObject({ command: "closePath" });
    expect(fanPath.at(-2)).toMatchObject({ command: "lineTo", x: 100, y: 150 });
    // 64 bin tips bracketed by the origin move and the closing return to origin.
    expect(fanPath.filter(({ command }) => command === "lineTo")).toHaveLength(65);
  });

  it("scales the Polar Level fan with the signal's absolute level", () => {
    const topmostFor = (pairs) => {
      const ctx = contextStub();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
      const view = render(
        <VectorscopePolarPlot
          mode="polarLevel"
          rows={[{ pairs, ageMs: 0, timestampMs: 100 }]}
          firstLabel="L"
          secondLabel="R"
        />
      );
      const y = Math.min(...ctx.lineTo.mock.calls.map(([, yy]) => yy));
      view.unmount();
      return y;
    };

    // Baseline 150, plot radius 90 (arc extension 90). Level uses the same fixed dB transfer as
    // Polar Sample: louder reaches near the arc, quieter sits mid-plot, both absolute (not
    // peak-normalized). dB keeps quiet material well out instead of collapsing to the center.
    const loud = 150 - topmostFor(new Float32Array([1, 1]));
    const quiet = 150 - topmostFor(new Float32Array([0.1, 0.1]));
    expect(loud).toBeGreaterThan(quiet);
    expect(loud).toBeGreaterThan(70);
    expect(quiet).toBeGreaterThan(25);
    expect(quiet).toBeLessThan(55);
  });

  it("does not shrink the live Polar Level fill when Peak hold is enabled", () => {
    const fillTopFor = (peakHoldEnabled) => {
      const ctx = contextStub();
      vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
      const { rerender, unmount } = render(
        <VectorscopePolarPlot
          mode="polarLevel"
          rows={[{ pairs: new Float32Array([1, 1]), ageMs: 0, timestampMs: 100 }]}
          firstLabel="L"
          secondLabel="R"
          peakHoldEnabled={peakHoldEnabled}
        />
      );
      rerender(
        <VectorscopePolarPlot
          mode="polarLevel"
          rows={[{ pairs: new Float32Array([0.1, 0.1]), ageMs: 0, timestampMs: 2100 }]}
          firstLabel="L"
          secondLabel="R"
          peakHoldEnabled={peakHoldEnabled}
        />
      );
      const fill = ctx.filledPaths.at(-1);
      const top = Math.min(
        ...fill.filter((entry) => entry.command === "lineTo").map((entry) => entry.y)
      );
      unmount();
      return top;
    };

    // Regression: on the absolute scale, Peak hold only adds an outer outline. It must never feed
    // into the live fan's scaling, so the current fill sits at the same quiet radius either way.
    expect(fillTopFor(true)).toBeCloseTo(fillTopFor(false), 0);
  });

  it("keeps Peak hold inside the fixed Polar Level arc after the signal falls", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const { rerender } = render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([1, 1]), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );
    ctx.lineTo.mockClear();

    rerender(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([0.25, 0.25]), ageMs: 0, timestampMs: 2100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );

    const topmostY = Math.min(...ctx.lineTo.mock.calls.map(([, y]) => y));
    expect(topmostY).toBeGreaterThanOrEqual(60);
  });

  it("connects only the Polar Level Peak hold values", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: allPolarLevelBinPairs(), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );

    expect(ctx.fill).toHaveBeenCalledOnce();
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    for (const path of ctx.filledPaths) {
      expect(ctx.strokedPaths).not.toContainEqual(path);
    }

    const heldPath = ctx.strokedPaths[1];
    expect(heldPath[0].command).toBe("moveTo");
    expect(heldPath[0]).not.toMatchObject({ x: 100, y: 150 });
    expect(heldPath[0].x).toBeLessThan(100);
    expect(heldPath[0].y).toBeCloseTo(150);
    expect(heldPath.filter(({ command }) => command === "lineTo")).toHaveLength(63);
    expect(heldPath.at(-1).x).toBeGreaterThan(100);
    expect(heldPath.at(-1).y).toBeCloseTo(150);
    expect(heldPath.some(({ command }) => command === "closePath")).toBe(false);
  });

  it("uses distinct grid and trace layers for Polar Level", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) =>
        ({
          "--ui-vectorscope-trace": "#123456",
          "--ui-vectorscope-trace-snap": "#abcdef",
          "--ui-vectorscope-grid-stroke": "#654321",
          "--ui-vectorscope-stroke-width": "1",
        })[name] ?? "",
    });
    render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: allPolarLevelBinPairs(), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
        peakHoldEnabled
      />
    );
    styleSpy.mockRestore();

    expect(ctx.filledColors).toEqual(["#123456"]);
    expect(ctx.filledAlphas).toEqual([1]);
    expect([ctx.strokedColors, ctx.strokedAlphas]).toEqual([
      ["#654321", "#123456"],
      [1, 0.35],
    ]);
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

    // Snapshot mode draws only the grid; current wedges have no outline.
    expect(ctx.stroke).toHaveBeenCalledOnce();
  });
});
