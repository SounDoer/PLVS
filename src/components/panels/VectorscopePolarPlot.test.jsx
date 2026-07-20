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

  it("draws Polar Level as separated radial wedges without a current outline", () => {
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

    const originMoves = ctx.moveTo.mock.calls.filter(([x, y]) => x === 100 && y === 150);
    expect(ctx.fill).toHaveBeenCalledTimes(64);
    expect(originMoves).toHaveLength(64);
    expect(ctx.stroke).toHaveBeenCalledOnce();

    const interiorWedgeIndex = 31;
    const endpoints = ctx.filledPaths[interiorWedgeIndex].filter(
      ({ command }) => command === "lineTo"
    );
    const endpointAngles = endpoints.map(({ x, y }) => Math.atan2(x - 100, 150 - y));
    expect(endpointAngles[1] - endpointAngles[0]).toBeCloseTo((Math.PI / 63) * 0.5, 10);
  });

  it("uses a fixed decibel scale for Polar Level", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <VectorscopePolarPlot
        mode="polarLevel"
        rows={[{ pairs: new Float32Array([0.25, 0.25]), ageMs: 0, timestampMs: 100 }]}
        hasSignal
        firstLabel="L"
        secondLabel="R"
      />
    );

    const topmostY = Math.min(...ctx.lineTo.mock.calls.map(([, y]) => y));
    expect(topmostY).toBeGreaterThan(90);
    expect(topmostY).toBeLessThan(100);
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

    expect(ctx.fill.mock.calls.length).toBeGreaterThan(1);
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

    expect(ctx.filledColors).toHaveLength(64);
    expect(ctx.filledColors.every((color) => color === "#123456")).toBe(true);
    expect(ctx.filledAlphas).toEqual(Array(64).fill(1));
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
