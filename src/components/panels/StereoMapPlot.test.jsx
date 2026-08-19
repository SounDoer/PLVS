/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { StereoMapPlot } from "./StereoMapPlot.jsx";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { applyThemeToDocument } from "../../uiPreferences.js";

function gradientStub() {
  const stops = [];
  return {
    stops,
    addColorStop: vi.fn((offset, color) => {
      stops.push({ offset, color });
    }),
  };
}

function contextStub() {
  let currentPath = [];
  const filledPaths = [];
  const strokedPaths = [];
  const filledColors = [];
  const strokedColors = [];
  const filledAlphas = [];
  const strokedAlphas = [];
  const gradients = [];
  const ctx = {
    filledPaths,
    strokedPaths,
    filledColors,
    strokedColors,
    filledAlphas,
    strokedAlphas,
    gradients,
    fillStyle: "",
    strokeStyle: "",
    globalAlpha: 1,
    lineWidth: 1,
    lineCap: "butt",
    save: vi.fn(),
    restore: vi.fn(),
    clearRect: vi.fn(),
    createLinearGradient: vi.fn(() => {
      const gradient = gradientStub();
      gradients.push(gradient);
      return gradient;
    }),
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

  it("draws the baseline grid line and one gradient-filled+stroked path per continuous run", () => {
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

    // One continuous run of 3 valid bands draws as a single path regardless of band count: 1 grid
    // stroke + 1 curve stroke, 1 fill. This is the point of the gradient rewrite — a run's draw cost
    // no longer scales with how many bands (or how much the value swings between them) it contains.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    // Fill gradient built first, then stroke gradient, both carrying one stop per band.
    expect(ctx.gradients).toHaveLength(2);
    expect(ctx.gradients[0].stops).toHaveLength(3);
    expect(ctx.gradients[1].stops).toHaveLength(3);
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

    // Grid line + one run (band0-band1); band2 is invalid so it never contributes a stop.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
    expect(ctx.fill).toHaveBeenCalledTimes(1);
    expect(ctx.gradients[0].stops).toHaveLength(2);
  });

  it("bakes low-energy opacity fade into each gradient stop's alpha instead of a per-draw globalAlpha", () => {
    // Continuous modes now draw one path per run with globalAlpha fixed at 1 — varying opacity
    // along the run has to be expressed as per-stop alpha, or a low-energy fade at one edge of a
    // run would silently apply to the whole run instead.
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

    expect(ctx.strokedAlphas.at(-1)).toBe(1);
    const strokeGradient = ctx.gradients[1];
    expect(strokeGradient.stops[0].color).toMatch(/, 0\.3\)$/);
    expect(strokeGradient.stops[1].color).toMatch(/, 0\.9\)$/);
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

    // band0 (value -1, channelBlendT=0) is fully secondary (blue); band1 (value 1, t=1) fully
    // primary (red) — a continuous blend expressed as gradient stops, not a per-segment average.
    const strokeGradient = ctx.gradients[1];
    expect(strokeGradient.stops[0].color).toBe("rgba(0, 0, 255, 1)");
    expect(strokeGradient.stops[1].color).toBe("rgba(255, 0, 0, 1)");
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
    styleSpy.mockRestore();
    expect(ctx.gradients[1].stops[0].color).toBe("rgba(255, 0, 0, 1)");

    const ctx2 = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx2);
    const styleSpy2 = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: (name) =>
        ({
          "--ui-signal-bad": "#ff0000",
          "--ui-signal-warn": "#00ff00",
          "--ui-signal-good": "#0000ff",
          "--border": "#888888",
        })[name] ?? "",
    });
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
    styleSpy2.mockRestore();
    expect(ctx2.gradients[1].stops[0].color).toBe("rgba(0, 0, 255, 1)");
  });

  it("colors M/S Ratio as a binary primary/secondary split by sign, merging same-color segments", () => {
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
        bandCentersHz={[100, 500, 1000, 5000]}
        points={[
          { value: -2, opacity: 1, state: "ok" },
          { value: -2, opacity: 1, state: "ok" },
          { value: 2, opacity: 1, state: "ok" },
          { value: 2, opacity: 1, state: "ok" },
        ]}
        range={{ lowerBound: -12, upperBound: 12 }}
      />
    );
    styleSpy.mockRestore();

    // Binary mode never builds a gradient. Three segments (band0-1 negative, band1-2 crossing to
    // positive, band2-3 positive) collapse into 2 merged draws: [band0,band1,band2] all resolve to
    // the same "primary" (mid-dominant) color since the crossing segment's midpoint (-2+2)/2=0 is
    // still >= 0... — instead assert on the concrete color sequence and total draw count directly.
    expect(ctx.gradients).toHaveLength(0);
    expect(ctx.fill.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.strokedColors.filter((c) => c === "rgb(255, 0, 0)").length).toBeGreaterThan(0);
    expect(ctx.strokedColors.filter((c) => c === "rgb(0, 0, 255)").length).toBeGreaterThan(0);
    // Fewer draws than the old one-per-segment approach would have needed for 3 segments only if
    // any adjacent segments actually share a color; here segments are: mid(-2,-2)->primary,
    // mid(-2,2)=0->secondary, mid(2,2)->secondary — bands 1-3 merge into one secondary draw.
    expect(ctx.stroke).toHaveBeenCalledTimes(3); // grid + primary run + merged secondary run
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
    // 1 grid + 1 curve stroke + 2 hold outline strokes.
    expect(ctxPosition.stroke).toHaveBeenCalledTimes(4);

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
    // 1 grid + 1 curve stroke + 1 hold outline stroke.
    expect(ctxOther.stroke).toHaveBeenCalledTimes(3);
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
    // 1 grid + 1 curve stroke only.
    expect(ctx.stroke).toHaveBeenCalledTimes(2);
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
    // 1 grid + 1 curve stroke + 2 separate hold-run strokes (one band each side of the gap).
    expect(ctx.stroke).toHaveBeenCalledTimes(4);
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

  it("does not re-read layout or resolve colors from the DOM on an unchanged rerender", () => {
    // getComputedStyle/clientWidth force a synchronous layout flush; paying that cost on every
    // render (even ones the redraw-skip signature ends up discarding) reintroduces the same class
    // of jank the canvas rewrite was meant to remove. Colors/size must come from cached refs unless
    // paletteKey/themeId or the element's actual size changed.
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    });
    const props = {
      mode: STEREO_MAP_MODES.CORRELATION,
      bandCentersHz: [100, 1000, 10000],
      points: threeBandPoints(),
      range: RANGE,
      paletteKey: "live",
    };
    const { rerender } = render(<StereoMapPlot {...props} />);
    const callsAfterFirst = styleSpy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    rerender(
      <StereoMapPlot
        {...props}
        bandCentersHz={[...props.bandCentersHz]}
        points={props.points.map((p) => ({ ...p }))}
        range={{ ...RANGE }}
      />
    );
    expect(styleSpy.mock.calls.length).toBe(callsAfterFirst);

    // A palette change is exactly the kind of change that must re-resolve colors.
    rerender(<StereoMapPlot {...props} paletteKey="snap" />);
    expect(styleSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });

  it("re-resolves cached colors after the active theme tokens are applied again", () => {
    const ctx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
    const styleSpy = vi.spyOn(window, "getComputedStyle").mockReturnValue({
      getPropertyValue: () => "",
    });
    const props = {
      mode: STEREO_MAP_MODES.CORRELATION,
      bandCentersHz: [100, 1000, 10000],
      points: threeBandPoints(),
      range: RANGE,
      paletteKey: "live",
      themeId: "plvs-dark",
    };

    applyThemeToDocument("plvs-dark");
    const { rerender } = render(<StereoMapPlot {...props} />);
    const callsAfterFirst = styleSpy.mock.calls.length;

    // Theme-editor previews re-apply tokens under the same custom theme id.
    applyThemeToDocument("plvs-dark");
    rerender(<StereoMapPlot {...props} />);

    expect(styleSpy.mock.calls.length).toBeGreaterThan(callsAfterFirst);
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

    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.gradients.at(-1).stops).toHaveLength(2);
  });

  it("costs the same number of draw calls per run regardless of how much the value swings between bands", () => {
    // This is the actual regression this rewrite fixes: per-segment fillStyle/strokeStyle
    // reassignment made a "busy" run (value alternates a lot band-to-band) strictly more expensive
    // than a "calm" run (value barely changes), even though both have the same band count. A
    // gradient-per-run draw must cost the same either way.
    const calmPoints = Array.from({ length: 20 }, (_, i) => ({
      value: 0.1 + i * 0.001,
      opacity: 1,
      state: "ok",
    }));
    const busyPoints = Array.from({ length: 20 }, (_, i) => ({
      value: i % 2 === 0 ? -0.9 : 0.9,
      opacity: 1,
      state: "ok",
    }));
    const bandCentersHz = Array.from({ length: 20 }, (_, i) => 100 * 1.3 ** i);

    const calmCtx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(calmCtx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={bandCentersHz}
        points={calmPoints}
        range={RANGE}
      />
    );

    const busyCtx = contextStub();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(busyCtx);
    render(
      <StereoMapPlot
        mode={STEREO_MAP_MODES.CORRELATION}
        bandCentersHz={bandCentersHz}
        points={busyPoints}
        range={RANGE}
      />
    );

    expect(busyCtx.fill.mock.calls.length).toBe(calmCtx.fill.mock.calls.length);
    expect(busyCtx.stroke.mock.calls.length).toBe(calmCtx.stroke.mock.calls.length);
  });
});
