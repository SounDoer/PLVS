import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockLoudness } from "./DockLoudness.jsx";

function renderWith({ displayAudio, histSourceList = [], controls }) {
  return render(
    <FrameDataProvider value={{ displayAudio }}>
      <HistoryDataProvider value={{ histSourceList }}>
        <DockLoudness controls={controls} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("DockLoudness", () => {
  it("shows short-term LUFS by default", () => {
    renderWith({ displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 } });
    expect(screen.getByText("-19.4")).toBeTruthy();
    expect(screen.getByText("S")).toBeTruthy();
  });

  it("uses the Dock-owned metric", () => {
    renderWith({
      displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 },
      controls: { metric: "integrated", showSparkline: true },
    });
    expect(screen.getByText("-20.1")).toBeTruthy();
    expect(screen.getByText("I")).toBeTruthy();
  });

  it("renders a dash for non-finite values and a sparkline with history", () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -30 + i * 0.2 }));
    const { container } = renderWith({
      displayAudio: { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity },
      histSourceList: rows,
    });
    expect(screen.getByText("-")).toBeTruthy();
    const path = container.querySelector("svg path");
    expect(path).not.toBeNull();
    const yValues = path
      .getAttribute("d")
      .split(/[ML]/)
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => pair.split(/\s+/)[1]);
    expect(new Set(yValues).size).toBeGreaterThan(1);
  });
});
