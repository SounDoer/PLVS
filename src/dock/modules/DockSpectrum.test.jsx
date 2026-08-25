/** @vitest-environment jsdom */
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { dockSpectrumKey } from "../dockAnalysisRequest.js";
import { DEFAULT_DOCK_CONTROLS_BY_MODULE_ID } from "../dockModuleControls.js";
import { DockSpectrum } from "./DockSpectrum.jsx";

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
  it("renders a themed live fill and both live outlines", () => {
    const controls = { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum, spectrumView: "lr" };
    const { container } = renderSpectrum(controls, {
      path: "M 0 130 L 1000 200",
      pathB: "M 0 150 L 1000 180",
    });
    const paths = [...container.querySelectorAll("svg > path")];

    expect(paths).toHaveLength(3);
    expect(paths[0].getAttribute("d")).toContain("L 1000 260 L 0 260 Z");
    expect(paths[0].getAttribute("fill")).toMatch(/^url\(#dock-spectrum-primary-/);
    expect(paths[1].getAttribute("stroke")).toBe("var(--ui-spectrum-primary)");
    expect(paths[2].getAttribute("stroke")).toBe("var(--ui-spectrum-secondary)");
    expect(paths[2].getAttribute("d")).toBe("M 0 150 L 1000 180");
  });

  it("keeps live outline stroke widths independent from SVG scaling", () => {
    const controls = { ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum, spectrumView: "lr" };
    const { container } = renderSpectrum(controls, {
      path: "M 0 130 L 1000 200",
      pathB: "M 0 150 L 1000 180",
    });
    const outlines = [...container.querySelectorAll('svg > path[fill="none"]')];

    expect(outlines).toHaveLength(2);
    expect(outlines[0].getAttribute("vector-effect")).toBe("non-scaling-stroke");
    expect(outlines[1].getAttribute("vector-effect")).toBe("non-scaling-stroke");
  });

  it("draws a held outline when Max Hold is on", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
      spectrumMaxHoldTrace: true,
    };
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [-30, -50],
    });

    expect(container.querySelector("[data-dock-spectrum-max-hold]")).toBeTruthy();
  });

  it("draws no held outline when Max Hold is off", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
      spectrumMaxHoldTrace: false,
    };
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [-30, -50],
    });

    expect(container.querySelector("[data-dock-spectrum-max-hold]")).toBeNull();
    expect(container.querySelector("[data-max-hold-reset]")).toBeNull();
  });

  it("clears the hold when the module is clicked", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
      spectrumMaxHoldTrace: true,
    };
    const { container, rerender } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [-30, -50],
    });
    const louder = (
      <FrameDataProvider
        value={{
          displayAudio: {
            spectrumResultsByKey: {
              [dockSpectrumKey(controls)]: { bandCentersHz: [100, 1000], smoothDb: [-40, -20] },
            },
          },
        }}
      >
        <DockSpectrum controls={controls} />
      </FrameDataProvider>
    );
    rerender(louder);
    const heldAfterTwoFrames = container
      .querySelector("[data-dock-spectrum-max-hold]")
      .getAttribute("d");

    fireEvent.click(container.querySelector("[data-max-hold-reset]"));
    rerender(louder);

    const heldAfterClear = container
      .querySelector("[data-dock-spectrum-max-hold]")
      .getAttribute("d");
    expect(heldAfterClear).not.toBe(heldAfterTwoFrames);
    expect(heldAfterClear).toBe(
      container.querySelector("[data-dock-spectrum-live]").getAttribute("d")
    );
  });

  it("fills to both peak contours while keeping the live outlines on top", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
      spectrumView: "lr",
      spectrumMaxDecay: true,
    };
    const { container } = renderSpectrum(controls, {
      path: "M 0 140 L 1000 190",
      pathB: "M 0 160 L 1000 210",
      peakPath: "M 0 80 L 1000 120",
      peakPathB: "M 0 100 L 1000 140",
    });
    const paths = [...container.querySelectorAll("svg > path")];

    expect(paths).toHaveLength(4);
    expect(paths[0].getAttribute("d")).toContain("M 0 80 L 1000 120");
    expect(paths[1].getAttribute("d")).toContain("M 0 100 L 1000 140");
    expect(paths[2].getAttribute("d")).toBe("M 0 140 L 1000 190");
    expect(paths[3].getAttribute("d")).toBe("M 0 160 L 1000 210");
  });

  it("applies the configured display ranges to reconstructed paths", () => {
    const controls = {
      ...DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum,
      spectrumXMinFreq: 100,
      spectrumXMaxFreq: 1000,
      spectrumYMinDb: -60,
      spectrumYMaxDb: 0,
    };
    const { container } = renderSpectrum(controls, {
      bandCentersHz: [100, 1000],
      smoothDb: [0, -60],
    });
    const outline = container.querySelector('svg > path[fill="none"]');

    expect(outline.getAttribute("d")).toBe("M 0.00 10.00 L 1000.00 256.00");
  });

  it("renders an empty svg without data", () => {
    const controls = DEFAULT_DOCK_CONTROLS_BY_MODULE_ID.spectrum;
    const { container } = render(
      <FrameDataProvider value={{ displayAudio: {} }}>
        <DockSpectrum controls={controls} />
      </FrameDataProvider>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg > path")).toBeNull();
  });
});
