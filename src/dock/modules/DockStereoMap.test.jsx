/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { StereoMapHistorySlab } from "../../lib/StereoMapHistorySlab.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { DEFAULT_DOCK_MODULES, DOCK_PANEL_MODULE_IDS } from "../dockLayout.js";
import { dockStereoMapKey } from "../dockAnalysisRequest.js";
import { DockStereoMap } from "./DockStereoMap.jsx";

const controls = { pair: { x: 0, y: 1 }, mode: STEREO_MAP_MODES.POSITION, hold: false };
const key = dockStereoMapKey(controls);

// StereoMapPlot renders on <canvas> (see StereoMapPlot.jsx); jsdom has no real canvas
// implementation, so getContext() returns null and it silently skips drawing unless mocked.
function contextStub() {
  let currentPath = [];
  const filledPaths = [];
  const strokedPaths = [];
  const strokedColors = [];
  const ctx = {
    filledPaths,
    strokedPaths,
    strokedColors,
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
    }),
    stroke: vi.fn(() => {
      strokedPaths.push(currentPath.map((entry) => ({ ...entry })));
      strokedColors.push(ctx.strokeStyle);
    }),
  };
  return ctx;
}

function mockCanvas() {
  const ctx = contextStub();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(ctx);
  return ctx;
}

function mockCanvasPerElement() {
  const ctxByCanvas = new WeakMap();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function () {
    if (!ctxByCanvas.has(this)) ctxByCanvas.set(this, contextStub());
    return ctxByCanvas.get(this);
  });
  return ctxByCanvas;
}

function mockStereoMapColors() {
  return vi.spyOn(window, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name) =>
      ({
        "--ui-stereo-map-primary": "#111111",
        "--ui-stereo-map-primary-snap": "#111111",
        "--ui-stereo-map-secondary": "#222222",
        "--ui-stereo-map-secondary-snap": "#222222",
        "--ui-signal-bad": "#444444",
        "--ui-signal-warn": "#333333",
        "--ui-signal-good": "#555555",
        "--border": "#666666",
      })[name] ?? "",
  });
}
const STEREO_MAP_PRIMARY_CSS = "rgb(17, 17, 17)";

function primitiveRow() {
  return {
    bandCentersHz: [100, 1000, 10000],
    pl: [1, 1, 1e-12],
    pr: [1, 0, 1e-12],
    c: [1, 0, 0],
  };
}

function renderWith({
  result,
  channelCount = 2,
  selectedControls = controls,
  historyData = {},
} = {}) {
  return render(
    <FrameDataProvider
      value={{
        channelCount,
        displayAudio: { stereoMapResultsByKey: result ? { [key]: result } : {} },
      }}
    >
      <HistoryDataProvider value={historyData}>
        <DockStereoMap controls={selectedControls} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("dock module registration", () => {
  it("appears after Waveform in the Dock module catalog and is disabled by default", () => {
    expect(DOCK_PANEL_MODULE_IDS.indexOf("stereo-map")).toBe(
      DOCK_PANEL_MODULE_IDS.indexOf("waveform") + 1
    );
    expect(DEFAULT_DOCK_MODULES).not.toContain("stereoMap");
  });

  it("uses the Spectrum-like flexible size policy", () => {
    expect(DOCK_MODULE_REGISTRY.stereoMap).toMatchObject({
      minWidth: 180,
      defaultWidth: 360,
      growthPolicy: "flexible",
    });
  });
});

describe("DockStereoMap", () => {
  beforeEach(() => {
    // Canvas sizing reads clientWidth/clientHeight, which jsdom does not implement.
    Object.defineProperty(HTMLCanvasElement.prototype, "clientWidth", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(HTMLCanvasElement.prototype, "clientHeight", {
      configurable: true,
      get: () => 260,
    });
  });

  it("renders the current curve, baseline, and fill for the keyed live result", () => {
    const ctx = mockCanvas();
    const { container } = renderWith({ result: primitiveRow() });
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    // Grid line (1 stroke) plus at least one curve segment (fill + stroke).
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(1);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("shows top/bottom pair labels only in Position mode", () => {
    renderWith({ result: primitiveRow() });
    expect(screen.getByTestId("dock-stereo-map-pair-labels")).toBeTruthy();

    const { container } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, mode: STEREO_MAP_MODES.CORRELATION },
    });
    expect(container.querySelector('[data-testid="dock-stereo-map-pair-labels"]')).toBeNull();
  });

  it("draws a Hold outline only when the shared per-key live Hold is enabled", () => {
    const colorSpy = mockStereoMapColors();
    const slab = new StereoMapHistorySlab(10);
    slab.append({
      timestampMs: 0,
      sampleRateHz: 48000,
      bandCentersHz: [100, 1000, 10000],
      pl: [1, 1, 1],
      pr: [1, 1, 1],
      c: [1, 1, 1],
    });
    const getStereoMapHistoryForKey = (candidateKey) => (candidateKey === key ? slab : null);

    const ctxWithoutHold = mockCanvas();
    renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, mode: STEREO_MAP_MODES.CORRELATION, hold: false },
      historyData: { getStereoMapHistoryForKey },
    });
    // Hold is always stroked in the primary token, distinct from Correlation's Bad/Warn/Good
    // curve colors, so its absence from the stroked colors means no outline was drawn.
    expect(ctxWithoutHold.strokedColors).not.toContain(STEREO_MAP_PRIMARY_CSS);

    const ctxWithHold = mockCanvas();
    renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, mode: STEREO_MAP_MODES.CORRELATION, hold: true },
      historyData: { getStereoMapHistoryForKey },
    });
    expect(ctxWithHold.strokedColors).toContain(STEREO_MAP_PRIMARY_CSS);
    colorSpy.mockRestore();
  });

  it("shares live Hold with the Workspace panel on the same Analysis Key", () => {
    const ctxByCanvas = mockCanvasPerElement();
    const slab = new StereoMapHistorySlab(10);
    slab.append({
      timestampMs: 0,
      sampleRateHz: 48000,
      bandCentersHz: [100, 1000, 10000],
      pl: [1, 0, 1],
      pr: [0, 1, 1],
      c: [0, 0, 1],
    });
    const getStereoMapHistoryForKey = (candidateKey) => (candidateKey === key ? slab : null);

    const { container: dockContainer } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, hold: true },
      historyData: { getStereoMapHistoryForKey },
    });

    // Same shared slab.liveHoldValues() the Workspace panel reads (StereoMapHistorySlab), not a
    // private per-instance accumulator: both consumers of this key must see the identical points.
    const expectedHold = slab.liveHoldValues()[STEREO_MAP_MODES.POSITION];
    const dockCtx = ctxByCanvas.get(dockContainer.querySelector("canvas"));
    // Position mode draws the maximum outline (second-to-last stroke) then the minimum (last).
    expect(dockCtx.strokedPaths.at(-2)).toBeTruthy();
    expect(expectedHold.maximum.some((v) => v !== null)).toBe(true);
  });

  it("renders no hover, wheel, pan, axis, or snapshot chrome", () => {
    const { container } = renderWith({ result: primitiveRow() });
    expect(container.querySelector('[data-testid="stereo-map-chart"]')).toBeNull();
    expect(container.querySelector("[data-stereo-map-hover]")).toBeNull();
    expect(container.textContent).not.toMatch(/Hz/);
  });

  it("renders compact placeholders (no curve) for mono input", () => {
    const { container } = renderWith({ result: primitiveRow(), channelCount: 1 });
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    expect(plot.querySelectorAll("[data-stereo-map-segment]").length).toBe(0);
  });

  it("renders compact placeholders (no curve) while the keyed request is pending", () => {
    const { container } = renderWith({ result: null });
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    expect(plot.querySelectorAll("[data-stereo-map-segment]").length).toBe(0);
  });
});
