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
    const rows = Array.from({ length: 40 }, (_, i) => ({ shortTerm: -30 + i * 0.1 }));
    const { container } = renderWith({
      displayAudio: { momentary: -Infinity, shortTerm: -Infinity, integrated: -Infinity },
      histSourceList: rows,
    });
    expect(screen.getByText("-")).toBeTruthy();
    expect(container.querySelector("svg path")).not.toBeNull();
  });
});
