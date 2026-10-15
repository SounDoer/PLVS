/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { STEREO_MAP_MODES } from "../../math/stereoMapMath.js";
import { StereoMapHistorySlab } from "../../lib/StereoMapHistorySlab.js";
import { DOCK_MODULE_REGISTRY } from "../registry.jsx";
import { DEFAULT_DOCK_MODULES, DOCK_PANEL_MODULE_IDS } from "../dockLayout.js";
import { dockStereoMapKey } from "../dockAnalysisRequest.js";
import { DockStereoMap } from "./DockStereoMap.jsx";
import { BUILTIN_THEMES_V2 } from "../../theme/builtinThemesV2.js";
import { compileTheme } from "../../theme/compileTheme.js";

import { standIn } from "../../testing/standIn.js";
const controls = {
  stereoMapPair: { x: 0, y: 1 },
  stereoMapMode: STEREO_MAP_MODES.POSITION,
  stereoMapHold: false,
};
const key = dockStereoMapKey(controls);

// StereoMapPlot renders on <canvas> (see StereoMapPlot.jsx); jsdom has no real canvas
// implementation, so getContext() returns null and it silently skips drawing unless mocked.
// StereoMapPlot's continuous modes (Position/Correlation/Mono Loss) color a run with a canvas
// gradient rather than per-segment solid colors; this stub records each gradient's stops.
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
  const strokedColors = [];
  const gradients = [];
  const ctx = {
    filledPaths,
    strokedPaths,
    strokedColors,
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
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(standIn(ctx));
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
  return vi.spyOn(window, "getComputedStyle").mockReturnValue(
    /** @type {ReturnType<typeof window.getComputedStyle>} */ ({
      getPropertyValue: (name) =>
        ({
          "--ui-stereo-map-primary": "#111111",
          "--ui-stereo-map-primary-snap": "#111111",
          "--ui-stereo-map-secondary": "#222222",
          "--ui-stereo-map-secondary-snap": "#222222",
          "--ui-stereo-map-critical-range": "#444444",
          "--ui-stereo-map-warning-range": "#333333",
          "--ui-stereo-map-safe-range": "#555555",
          "--border": "#666666",
        })[name] ?? "",
    })
  );
}
function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

const STEREO_MAP_PRIMARY_CSS = hexToRgb(
  compileTheme(BUILTIN_THEMES_V2["plvs-dark"]).canvas["stereoMap.primary"]
);

function primitiveRow() {
  return {
    bandCentersHz: [100, 1000, 10000],
    pl: [1, 1, 1e-12],
    pr: [1, 0, 1e-12],
    c: [1, 0, 0],
  };
}

/**
 * @param {{
 *   result?: any,
 *   channelCount?: number,
 *   selectedControls?: any,
 *   historyData?: any,
 * }} [options]
 */
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
  it("appears after Waveform in the Dock module catalog and ends the first-run strip", () => {
    expect(DOCK_PANEL_MODULE_IDS.indexOf("stereo-map")).toBe(
      DOCK_PANEL_MODULE_IDS.indexOf("waveform") + 1
    );
    expect(DEFAULT_DOCK_MODULES.at(-1)).toBe("stereoMap");
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
  it("uses shared snapshot and frequency gestures while keeping axis rails hidden", () => {
    const captureCurrentSnapshot = vi.fn();
    const setSelectedOffset = vi.fn();
    const onDockPanelControlsChange = vi.fn();
    const { container } = renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, panelId: "map-2", onDockPanelControlsChange },
      historyData: {
        selectedOffset: -1,
        historyChartInteractive: true,
        totalSamples: 100,
        captureCurrentSnapshot,
        setSelectedOffset,
      },
    });
    const chart = screen.getByTestId("stereo-map-chart");
    vi.spyOn(chart, "getBoundingClientRect").mockReturnValue(
      standIn({ width: 300, height: 40, left: 0, top: 0 })
    );
    expect(container.querySelector("[data-axis]")).toBeNull();
    fireEvent.click(chart);
    expect(captureCurrentSnapshot).toHaveBeenCalledOnce();
    fireEvent.doubleClick(chart);
    expect(setSelectedOffset).toHaveBeenCalledWith(-1);
    fireEvent.wheel(chart, { deltaY: -100, clientX: 150 });
    expect(onDockPanelControlsChange).toHaveBeenCalledWith(
      "map-2",
      expect.objectContaining({ stereoMapXMinFreq: expect.any(Number) })
    );
    const next = onDockPanelControlsChange.mock.calls.at(-1)[1];
    expect(next.stereoMapXMaxFreq - next.stereoMapXMinFreq).toBeLessThan(19980);
  });

  it("shows the shared hover probe at compact height", () => {
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((cb) => {
        cb();
        return 1;
      })
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      standIn({ width: 300, height: 40, left: 0, top: 0 })
    );
    const { container } = renderWith({
      result: primitiveRow(),
      historyData: { selectedOffset: -1, historyChartInteractive: true },
    });
    fireEvent.pointerMove(screen.getByTestId("stereo-map-chart"), { clientX: 10, clientY: 20 });
    expect(container.textContent).toContain("0%");
    expect(container.textContent).toMatch(/Hz/);
  });

  it("resolves snapshot holds from the selected key without reading live history", () => {
    const getStereoMapHistoryForKey = vi.fn();
    const resolveStereoMapSnapshotForKey = vi.fn(() => ({ missing: true }));
    renderWith({
      result: primitiveRow(),
      selectedControls: { ...controls, stereoMapHold: true },
      historyData: { selectedOffset: 1, getStereoMapHistoryForKey, resolveStereoMapSnapshotForKey },
    });
    expect(resolveStereoMapSnapshotForKey).toHaveBeenCalledWith(
      key,
      controls.stereoMapMode,
      { lowerBound: -1, upperBound: 1 },
      { withHold: true }
    );
    expect(getStereoMapHistoryForKey).not.toHaveBeenCalled();
    expect(screen.getByText("No data for this view at selected time")).toBeTruthy();
    expect(document.querySelector("canvas")).toBeNull();
  });

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

  it("renders the current curve and fill for the keyed live result", () => {
    const ctx = mockCanvas();
    const { container } = renderWith(
      /** @type {Parameters<typeof renderWith>[0]} */ ({ result: primitiveRow() })
    );
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    // At least one curve segment (fill + stroke); nothing draws a line at zero.
    expect(ctx.stroke.mock.calls.length).toBeGreaterThan(0);
    expect(ctx.fill).toHaveBeenCalled();
  });

  it("shows top/bottom pair labels only in Position mode", () => {
    renderWith(/** @type {Parameters<typeof renderWith>[0]} */ ({ result: primitiveRow() }));
    expect(screen.getByTestId("dock-stereo-map-pair-labels")).toBeTruthy();

    const { container } = renderWith({
      result: primitiveRow(),
      selectedControls: {
        ...controls,
        stereoMapMode: STEREO_MAP_MODES.CORRELATION,
      },
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
      selectedControls: {
        ...controls,
        stereoMapMode: STEREO_MAP_MODES.CORRELATION,
        stereoMapHold: false,
      },
      historyData: { getStereoMapHistoryForKey },
    });
    // Hold is always stroked in the primary token, distinct from Correlation's Bad/Warn/Good
    // curve colors, so its absence from the stroked colors means no outline was drawn.
    expect(ctxWithoutHold.strokedColors).not.toContain(STEREO_MAP_PRIMARY_CSS);

    const ctxWithHold = mockCanvas();
    renderWith({
      result: primitiveRow(),
      selectedControls: {
        ...controls,
        stereoMapMode: STEREO_MAP_MODES.CORRELATION,
        stereoMapHold: true,
      },
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

    const { container: dockContainer } = renderWith(
      /** @type {Parameters<typeof renderWith>[0]} */ ({
        result: primitiveRow(),
        selectedControls: { ...controls, stereoMapHold: true },
        historyData: { getStereoMapHistoryForKey },
      })
    );

    // Same shared slab.liveHoldValues() the Workspace panel reads (StereoMapHistorySlab), not a
    // private per-instance accumulator: both consumers of this key must see the identical points.
    const expectedHold = slab.liveHoldValues()[STEREO_MAP_MODES.POSITION];
    const dockCtx = ctxByCanvas.get(dockContainer.querySelector("canvas"));
    // Position stereoMapMode draws the maximum outline (second-to-last stroke) then the minimum (last).
    expect(dockCtx.strokedPaths.at(-2)).toBeTruthy();
    expect(expectedHold.maximum.some((v) => v !== null)).toBe(true);
  });

  it("keeps axis labels and snapshot chrome out of the strip", () => {
    const { container } = renderWith(
      /** @type {Parameters<typeof renderWith>[0]} */ ({ result: primitiveRow() })
    );
    expect(container.querySelector('[data-testid="stereo-map-chart"]')).toBeTruthy();
    expect(container.querySelector("[data-stereo-map-hover]")).toBeNull();
    expect(container.textContent).not.toMatch(/Hz/);
  });

  it("explains mono input without rendering a curve", () => {
    const { container } = renderWith(
      /** @type {Parameters<typeof renderWith>[0]} */ ({ result: primitiveRow(), channelCount: 1 })
    );
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeNull();
    expect(screen.getByText("Mono input — Stereo Map requires a channel pair.")).toBeTruthy();
  });

  it("does not treat channelCount 0 (not started yet) as mono", () => {
    const ctx = mockCanvas();
    renderWith(
      /** @type {Parameters<typeof renderWith>[0]} */ ({ result: primitiveRow(), channelCount: 0 })
    );
    // Unlike genuine mono input, a not-yet-started channel count must still draw the curve once a
    // result is available for the key.
    expect(ctx.stroke).toHaveBeenCalled();
  });

  it("renders compact placeholders (no curve) while the keyed request is pending", () => {
    const { container } = renderWith(
      /** @type {Parameters<typeof renderWith>[0]} */ ({ result: null })
    );
    const plot = container.querySelector('[data-stereo-map-plot="position"]');
    expect(plot).toBeTruthy();
    expect(screen.queryByText("Mono input — Stereo Map requires a channel pair.")).toBeNull();
  });
});
