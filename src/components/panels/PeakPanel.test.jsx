/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { AudioDataContext } from "../../workspace/AudioDataContext.jsx";
import { PeakPanel } from "./PeakPanel.jsx";

function renderPanel() {
  return render(
    <AudioDataContext.Provider
      value={{
        displayAudio: { peakDb: [-9.9, -10] },
        peakLabelContext: { resolvedLayout: "stereo" },
        fmt: (v) => (Number.isFinite(v) ? v.toFixed(1) : "-"),
        hasTpMaxValue: true,
        tpMaxText: "-1.0 dBTP",
      }}
    >
      <PeakPanel />
    </AudioDataContext.Provider>
  );
}

describe("PeakPanel", () => {
  it("renders peak values in fixed-width nowrap slots separate from channel labels", () => {
    renderPanel();

    const leftValue = screen.getByText("-9.9");
    const leftLabel = screen.getByText("L");

    expect(leftValue.className).toContain("w-[5ch]");
    expect(leftValue.className).toContain("whitespace-nowrap");
    expect(leftValue.closest("[data-peak-value]")).toBeTruthy();
    expect(leftLabel.closest("[data-peak-channel-label]")).toBeTruthy();
    expect(leftValue.parentElement).not.toBe(leftLabel.parentElement);
  });
});
