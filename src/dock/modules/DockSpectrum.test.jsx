/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FrameDataProvider as BaseFrameDataProvider,
  HistoryDataProvider,
} from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { DockSpectrum } from "./DockSpectrum.jsx";

function FrameDataProvider({ value, children }) {
  return (
    <BaseFrameDataProvider value={value}>
      <HistoryDataProvider
        value={{ selectedOffset: -1, historyChartInteractive: true, totalSamples: 0 }}
      >
        {children}
      </HistoryDataProvider>
    </BaseFrameDataProvider>
  );
}

// Rows, not paths: the engine sends untilted dB rows and the dock builds every path itself.
// Tilt off unless a test is about tilt, so a coordinate assertion stays about the thing it names.
function flatControls(overrides) {
  return {
    ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
    spectrumTiltDbPerOctave: 0,
    ...overrides,
  };
}

function renderSpectrum(controls, result) {
  return render(
    <FrameDataProvider
      value={{
        displayAudio: {
          spectrumResultsByKey: { [dockSpectrumKey(controls)]: result },
        },
      }}
    >
      <DockSpectrum controls={controls} />
    </FrameDataProvider>
  );
}

describe("DockSpectrum", () => {
  it("uses shared snapshot selection and exits on double-click at compact height", () => {
    const captureCurrentSnapshot = vi.fn();
    const setSelectedOffset = vi.fn();
    const resolveSpectrumSnapshotForKey = vi.fn(() => ({ missing: true }));
    const controls = flatControls({});
    const tree = (selectedOffset) => (
      <FrameDataProvider value={{ displayAudio: {} }}>
        <HistoryDataProvider
          value={{
            selectedOffset,
            totalSamples: 10,
            historyChartInteractive: true,
            captureCurrentSnapshot,
            setSelectedOffset,
            resolveSpectrumSnapshotForKey,
          }}
        >
          <DockSpectrum controls={controls} heightMode="compact" />
        </HistoryDataProvider>
      </FrameDataProvider>
    );
    const { getByTestId, rerender, container } = render(tree(-1));
    fireEvent.click(getByTestId("spectrum-chart"));
    expect(captureCurrentSnapshot).toHaveBeenCalledOnce();
    rerender(tree(0));
    expect(resolveSpectrumSnapshotForKey).toHaveBeenCalledWith(
      dockSpectrumKey(controls),
      expect.anything()
    );
    expect(container.querySelector("[data-spectrum-live]")).toBeNull();
    fireEvent.doubleClick(container.firstElementChild.firstElementChild);
    expect(setSelectedOffset).toHaveBeenCalledWith(-1);
  });

  it("uses the shared chart and writes range gestures only to its Dock panel", () => {
    const onDockPanelControlsChange = vi.fn();
    const controls = flatControls({
      panelId: "dock-spectrum",
      spectrumGrid: true,
      spectrumPeakLabels: true,
      onDockPanelControlsChange,
    });
    const tree = (heightMode) => (
      <FrameDataProvider value={{ displayAudio: {} }}>
        <DockSpectrum controls={controls} heightMode={heightMode} />
      </FrameDataProvider>
    );
    const { container, getByTestId, rerender } = render(tree("expanded"));
    expect(container.querySelector("[data-spectrum-grid]")).toBeTruthy();
    expect(container.querySelector("svg text")).toBeNull();
    fireEvent.wheel(getByTestId("spectrum-chart"), { deltaY: -100, clientX: 100 });
    expect(onDockPanelControlsChange).toHaveBeenCalledWith(
      "dock-spectrum",
      expect.objectContaining({ spectrumGrid: true, spectrumPeakLabels: true })
    );
    const changed = onDockPanelControlsChange.mock.calls[0][1];
    expect(changed.spectrumXMaxFreq - changed.spectrumXMinFreq).toBeLessThan(19980);
    rerender(tree("compact"));
    expect(container.querySelector("[data-spectrum-grid]")).toBeTruthy();
    rerender(tree("expanded"));
    expect(container.querySelector("[data-spectrum-grid]")).toBeTruthy();
    expect(controls.spectrumGrid).toBe(true);
  });

  it("renders a themed live fill and both live outlines", () => {
    const controls = flatControls({ spectrumView: "lr" });
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [-30, -50],
      smoothDbB: [-40, -20],
    });
    const paths = [...container.querySelectorAll("svg path")];

    expect(paths).toHaveLength(3);
    expect(paths[0].getAttribute("d")).toContain("L 1000 260 L 0 260 Z");
    expect(paths[0].getAttribute("fill")).toMatch(/^url\(#spectrum-live-/);
    expect(container.querySelector('[data-spectrum-live="primary"]').getAttribute("stroke")).toBe(
      "var(--ui-spectrum-primary)"
    );
    expect(container.querySelector('[data-spectrum-live="secondary"]').getAttribute("stroke")).toBe(
      "var(--ui-spectrum-secondary)"
    );
    expect(paths[2].getAttribute("d")).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
  });

  it("keeps live outline stroke widths independent from SVG scaling", () => {
    const controls = flatControls({ spectrumView: "lr" });
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [-30, -50],
      smoothDbB: [-40, -20],
    });
    const outlines = [...container.querySelectorAll('svg path[fill="none"]')];

    expect(outlines).toHaveLength(2);
    expect(outlines[0].getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(outlines[1].getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  const BANDS = [100, 1000];

  function holdControls(mode) {
    return flatControls({ spectrumMaxMode: mode });
  }

  function frame(controls, smoothDb, heightMode = "standard") {
    return (
      <FrameDataProvider
        value={{
          displayAudio: {
            spectrumResultsByKey: {
              [dockSpectrumKey(controls)]: { bandCentersHz: BANDS, smoothDb, peakDb: [-10, -10] },
            },
          },
        }}
      >
        <DockSpectrum controls={controls} heightMode={heightMode} />
      </FrameDataProvider>
    );
  }

  function fillEdge(container) {
    return container.querySelector("svg path[fill^='url']")?.getAttribute("d");
  }

  it("fills to the cumulative hold in Hold mode", () => {
    const controls = holdControls("hold");
    const { container, rerender } = render(frame(controls, [-30, -50]));
    rerender(frame(controls, [-40, -20]));

    const held = fillEdge(container);
    // The maximum of the two frames: higher than either frame is on its own at both bands.
    expect(held).not.toBe(fillEdge(render(frame(controls, [-40, -20])).container));
  });

  it("retains cumulative Max Hold while resizing across compact and expanded heights", () => {
    const controls = holdControls("hold");
    const { container, rerender } = render(frame(controls, [-20, -20], "compact"));
    const held = fillEdge(container);
    rerender(frame(controls, [-60, -60], "expanded"));
    expect(fillEdge(container)).toBe(held);
    rerender(frame(controls, [-60, -60], "compact"));
    expect(fillEdge(container)).toBe(held);
  });

  it("offers the clear target only in Hold mode", () => {
    expect(
      render(frame(holdControls("hold"), [-30, -50])).container.querySelector(
        "[data-spectrum-max-hold-hit]"
      )
    ).toBeTruthy();
    expect(
      render(frame(holdControls("decay"), [-30, -50])).container.querySelector(
        "[data-spectrum-max-hold-hit]"
      )
    ).toBeNull();
    expect(
      render(frame(holdControls("off"), [-30, -50])).container.querySelector(
        "[data-spectrum-max-hold-hit]"
      )
    ).toBeNull();
  });

  it("clears the hold when its contour is clicked", () => {
    const controls = holdControls("hold");
    const { container, rerender } = render(frame(controls, [-30, -50]));
    rerender(frame(controls, [-40, -20]));
    const heldAfterTwoFrames = fillEdge(container);

    fireEvent.click(container.querySelector("[data-spectrum-max-hold-hit]"));
    rerender(frame(controls, [-40, -20]));

    expect(fillEdge(container)).not.toBe(heldAfterTwoFrames);
  });

  it("fills to both peak contours while keeping the live outlines on top", () => {
    const controls = flatControls({
      spectrumView: "lr",
      spectrumMaxMode: "decay",
      spectrumYMinDb: -60,
      spectrumYMaxDb: 0,
      spectrumXMinFreq: 100,
      spectrumXMaxFreq: 1000,
    });
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [-30, -60],
      smoothDbB: [-30, -60],
      peakDb: [0, -30],
      peakDbB: [0, -30],
    });
    const paths = [...container.querySelectorAll("svg path")];

    // Two fills up to the peak contours, then the two live outlines on top of them.
    expect(paths).toHaveLength(4);
    expect(paths[0].getAttribute("d")).toContain("M 0.00 10.00 L 1000.00 133.00");
    expect(paths[1].getAttribute("d")).toContain("M 0.00 10.00 L 1000.00 133.00");
    expect(paths[2].getAttribute("d")).toBe("M 0.00 133.00 L 1000.00 256.00");
    expect(paths[3].getAttribute("d")).toBe("M 0.00 133.00 L 1000.00 256.00");
  });

  it("applies the configured display ranges to reconstructed paths", () => {
    const controls = flatControls({
      spectrumXMinFreq: 100,
      spectrumXMaxFreq: 1000,
      spectrumYMinDb: -60,
      spectrumYMaxDb: 0,
    });
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [0, -60],
    });
    const outline = container.querySelector('svg path[fill="none"]');

    expect(outline.getAttribute("d")).toBe("M 0.00 10.00 L 1000.00 256.00");
  });

  it("tilts the reconstructed curve around 1 kHz", () => {
    // The engine sends untilted rows, so the dock is what puts the slope on the curve. At
    // 3 dB/oct the 1 kHz point is untouched and 100 Hz drops by 3 dB per octave below it.
    const range = {
      spectrumXMinFreq: 100,
      spectrumXMaxFreq: 1000,
      spectrumYMinDb: -60,
      spectrumYMaxDb: 0,
    };
    const result = { bandCentersHz: [100, 1000], smoothDb: [-30, -30] };
    const flat = renderSpectrum(flatControls(range), result);
    const tilted = renderSpectrum(flatControls({ ...range, spectrumTiltDbPerOctave: 3 }), result);

    const edge = (view) => view.container.querySelector('svg path[fill="none"]').getAttribute("d");
    const [flatStart, flatEnd] = edge(flat).match(/[\d.]+(?= L|$)/g) ?? [];
    const [tiltedStart, tiltedEnd] = edge(tilted).match(/[\d.]+(?= L|$)/g) ?? [];

    expect(tiltedEnd).toBe(flatEnd);
    expect(Number(tiltedStart)).toBeGreaterThan(Number(flatStart));
  });

  it("renders an empty svg without data", () => {
    const controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum;
    const { container } = render(
      <FrameDataProvider value={{ displayAudio: {} }}>
        <DockSpectrum controls={controls} />
      </FrameDataProvider>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg path")).toBeNull();
  });
});
