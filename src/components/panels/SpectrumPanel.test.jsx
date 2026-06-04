/** @vitest-environment jsdom */
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { SpectrumPanel } from "./SpectrumPanel.jsx";

vi.mock("framer-motion", () => ({
  useReducedMotion: () => true,
  AnimatePresence: ({ children }) => <>{children}</>,
  motion: {
    g: React.forwardRef(function MotionG(
      { initial: _initial, animate: _animate, exit: _exit, transition: _transition, ...props },
      ref
    ) {
      return <g ref={ref} {...props} />;
    }),
  },
}));

function renderPanel(audioData) {
  return render(
    <AudioDataContext.Provider value={audioData}>
      <SpectrumPanel />
    </AudioDataContext.Provider>
  );
}

describe("SpectrumPanel", () => {
  it("renders the live peak overlay with the live spectrum token", () => {
    const peakPath = "M 0 20 L 1000 20";
    const { container } = renderPanel({
      displaySpectrumPath: "M 0 120 L 1000 80",
      displaySpectrumPeakPath: peakPath,
      selectedOffset: -1,
      spectrumHover: null,
      onSpectrumHoverMove: vi.fn(),
      onSpectrumHoverLeave: vi.fn(),
    });

    const peakOverlay = container.querySelector(`path[d="${peakPath}"]`);

    expect(peakOverlay).toBeTruthy();
    expect(peakOverlay?.getAttribute("stroke")).toBe("var(--ui-chart-spectrum-live)");
  });
});
