/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { StereoMapPlot } from "./StereoMapPlot.jsx";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";

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
    lineWidth: 1,
    lineCap: "butt",
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    beginPath: vi.fn(() => {
      currentPath = [];
    }),
    closePath: vi.fn(() => {
      currentPath.push({ command: "closePath" });
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

const RANGE = { lowerBound: -1, upperBound: 1 };

function threeBandPoints({ invalidLast = false } = {}) {
  return [
    { value: -0.5, opacity: 1, state: "ok" },
    { value: 0, opacity: 1, state: "ok" },
    invalidLast
      ? { value: 0, opacity: 1, state: "invalid" }
      : { value: 0.5, opacity: 1, state: "ok" },
  ];
}

describe("StereoMapPlot", () => {
  beforeEach(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 260,
    });
  });

  it("draws the baseline grid line and one filled+stroked segment per adjacent valid pair", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000, 10000]}
        points={threeBandPoints()}
        range={RANGE}
      />
    );

    // Grid line (1 stroke) + 2 segments (2 fills, 2 strokes) for 3 consecutive valid bands.
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
    expect(ctx.fill).toHaveBeenCalledTimes(2);
  });

  it("breaks the curve at an invalid band instead of interpolating across it", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000, 10000]}
        points={threeBandPoints({ invalidLast: true })}
        range={RANGE}
      />
    );

    // Grid line + exactly one segment (band0-band1); band2 is invalid so no second segment.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
  });

  it("fades low-energy segments via globalAlpha using the lower of the two endpoint opacities", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000]}
        points={[
          { value: 0, opacity: 0.3, state: "ok" },
          { value: 0.5, opacity: 0.9, state: "ok" },
        ]}
        range={RANGE}
      />
    );

    expect(ctx.strokedAlphas.at(-1)).toBeCloseTo(0.3);
  });

  it("colors Position mode as a continuous blend between the primary and secondary tokens", () => {
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) =>
        ({
          "--ui-stereo-map-primary": "#ff0000",
          "--ui-stereo-map-secondary": "#0000ff",
          "--border": "#888888",
        })[name] ?? "",
    });
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.POSITION}
        bandCentersHz={[100, 1000]}
        points={[
          { value: -1, opacity: 1, state: "ok" },
          { value: 1, opacity: 1, state: "ok" },
        ]}
        range={RANGE}
      />
    );
    styleSpy.mockRestore();

    // Segment midpoint value is 0 (channelBlendT = 0.5): an even 50/50 mix of red and blue.
    expect(ctx.strokedColors.at(-1)).toBe("rgb(128, 0, 128)");
  });

  it("colors Correlation as Bad at -1 and Good at +1 via the three-stop signal tokens", () => {
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) =>
        ({
          "--ui-signal-bad": "#ff0000",
          "--ui-signal-warn": "#00ff00",
          "--ui-signal-good": "#0000ff",
          "--border": "#888888",
        })[name] ?? "",
    });
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);

    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000]}
        points={[
          { value: -1, opacity: 1, state: "ok" },
          { value: -1, opacity: 1, state: "ok" },
        ]}
        range={RANGE}
      />
    );
    expect(ctx.strokedColors.at(-1)).toBe("rgb(255, 0, 0)");

    const ctx2 = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx2);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000]}
        points={[
          { value: 1, opacity: 1, state: "ok" },
          { value: 1, opacity: 1, state: "ok" },
        ]}
        range={RANGE}
      />
    );
    styleSpy.mockRestore();
    expect(ctx2.strokedColors.at(-1)).toBe("rgb(0, 0, 255)");
  });

  it("colors M/S Ratio as a binary primary/secondary split by sign", () => {
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) =>
        ({
          "--ui-stereo-map-primary": "#ff0000",
          "--ui-stereo-map-secondary": "#0000ff",
          "--border": "#888888",
        })[name] ?? "",
    });
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.MS_RATIO_DB}
        bandCentersHz={[100, 1000]}
        points={[
          { value: -2, opacity: 1, state: "ok" },
          { value: 2, opacity: 1, state: "ok" },
        ]}
        range={{ lowerBound: -12, upperBound: 12 }}
      />
    );
    styleSpy.mockRestore();

    // Segment midpoint value is 0, which is >= 0 -> secondary (blue), never a blend.
    expect(ctx.strokedColors.at(-1)).toBe("rgb(0, 0, 255)");
  });

  it("draws two Hold outlines for Position (maximum + minimum) and one for other modes", () => {
    const ctxPosition = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctxPosition);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.POSITION}
        bandCentersHz={[100, 1000, 10000]}
        points={threeBandPoints()}
        holdValues={{ maximum: [0.5, 0.6, 0.7], minimum: [-0.5, -0.6, -0.7] }}
        holdVisible
        range={RANGE}
      />
    );
    // 1 grid + 2 segment strokes + 2 hold outline strokes.
    expect(ctxPosition.stroke).toHaveBeenCalledTimes(5);

    const ctxOther = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctxOther);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000, 10000]}
        points={threeBandPoints()}
        holdValues={[0.5, 0.6, 0.7]}
        holdVisible
        range={RANGE}
      />
    );
    // 1 grid + 2 segment strokes + 1 hold outline stroke.
    expect(ctxOther.stroke).toHaveBeenCalledTimes(4);
  });

  it("omits Hold outlines when holdVisible is false even with Hold data present", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000, 10000]}
        points={threeBandPoints()}
        holdValues={[0.5, 0.6, 0.7]}
        holdVisible={false}
        range={RANGE}
      />
    );
    // 1 grid + 2 segment strokes only.
    expect(ctx.stroke).toHaveBeenCalledTimes(3);
  });

  it("breaks Hold outline runs at invalid (null) values, same as the main curve", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={[100, 1000, 10000]}
        points={threeBandPoints()}
        holdValues={[0.5, null, 0.7]}
        holdVisible
        range={RANGE}
      />
    );
    // 1 grid + 2 segment strokes + 2 separate hold-run strokes (one band each side of the gap).
    expect(ctx.stroke).toHaveBeenCalledTimes(5);
  });

  it("skips redrawing when a rerender changes nothing that affects the picture", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const props = {
      mode: STEREO_MAP_MODES.CORRELATION,
      bandCentersHz: [100, 1000, 10000],
      points: threeBandPoints(),
      range: RANGE,
    };
    const { rerender } = render(<StereoMapPlot {...props} />);
    const strokeCallsAfterFirst = ctx.stroke.mock.calls.length;
    expect(strokeCallsAfterFirst).toBeGreaterThan(0);

    // Same values, but new array/object identities — mirrors the real parent, which rebuilds
    // `points`/`bandCentersHz` fresh on every render.
    rerender(
      <StereoMapPlot
        {...props}
        bandCentersHz={[...props.bandCentersHz]}
        points={props.points.map((p) => ({ ...p }))}
        range={{ ...RANGE }}
      />
    );

    expect(ctx.stroke.mock.calls.length).toBe(strokeCallsAfterFirst);
  });

  it("redraws when a point's value actually changes", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const props = {
      mode: STEREO_MAP_MODES.CORRELATION,
      bandCentersHz: [100, 1000, 10000],
      points: threeBandPoints(),
      range: RANGE,
    };
    const { rerender } = render(<StereoMapPlot {...props} />);
    const strokeCallsAfterFirst = ctx.stroke.mock.calls.length;

    rerender(<StereoMapPlot {...props} points={threeBandPoints({ invalidLast: true })} />);

    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(strokeCallsAfterFirst);
  });
});
