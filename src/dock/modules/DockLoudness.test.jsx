import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../../workspace/AudioDataContext.jsx";
import { DockLoudness } from "./DockLoudness.jsx";

function renderWith({ displayAudio, histSourceList = [] }) {
  return render(
    <FrameDataProvider value={{ displayAudio }}>
      <HistoryDataProvider value={{ histSourceList }}>
        <DockLoudness />
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

  it("cycles S → I → M on click", () => {
    renderWith({ displayAudio: { momentary: -18.2, shortTerm: -19.4, integrated: -20.1 } });
    const button = screen.getByRole("button", { name: /loudness metric/i });
    fireEvent.click(button);
    expect(screen.getByText("-20.1")).toBeTruthy();
    expect(screen.getByText("I")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.getByText("-18.2")).toBeTruthy();
    expect(screen.getByText("M")).toBeTruthy();
  });

  it("renders a dash for non-finite values and an svg sparkline with history", () => {
    // Real history rows use the short keys written by FrameIntake.pushHistRow (m / st).
    const rows = Array.from({ length: 40 }, (_, i) => ({ m: -30 + i * 0.1, st: -30 + i * 0.2 }));
    const { container } = renderWith({
      displayAudio: { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity },
      histSourceList: rows,
    });
    expect(screen.getByText("-")).toBeTruthy();
    const path = container.querySelector("svg path");
    expect(path).not.toBeNull();
    // Varying st values must produce more than one distinct Y — a flat line means
    // the component read the wrong row key and every sample floored to the bottom.
    const yValues = path
      .getAttribute("d")
      .split(/[ML]/)
      .map((pair) => pair.trim())
      .filter(Boolean)
      .map((pair) => pair.split(/\s+/)[1]);
    expect(new Set(yValues).size).toBeGreaterThan(1);
  });
});
