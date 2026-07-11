import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DOCK_SPECTRUM_KEY } from "../dockAnalysisRequest.js";
import { DockSpectrum } from "./DockSpectrum.jsx";

describe("DockSpectrum", () => {
  it("renders the live spectrum area path for the dock key", () => {
    const { container } = render(
      <FrameDataProvider
        value={{
          displayAudio: {
            spectrumResultsByKey: {
              [DOCK_SPECTRUM_KEY]: { path: "M 0 130 L 500 100 L 1000 200" },
            },
          },
        }}
      >
        <DockSpectrum />
      </FrameDataProvider>
    );
    const path = container.querySelector("svg path");
    expect(path).not.toBeNull();
    expect(path.getAttribute("d")).toContain("M 0 130 L 500 100 L 1000 200");
    expect(path.getAttribute("d")).toContain("L 1000 260 L 0 260 Z");
  });

  it("renders an empty svg without data", () => {
    const { container } = render(
      <FrameDataProvider value={{ displayAudio: {} }}>
        <DockSpectrum />
      </FrameDataProvider>
    );
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("svg path")).toBeNull();
  });
});
