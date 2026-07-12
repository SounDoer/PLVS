import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../workspace/AudioDataContext.jsx";
import { DockStrip } from "./DockStrip.jsx";

const BASE_PROPS = {
  modules: ["level", "correlation"],
  onToggleModule: vi.fn(),
  onReorderModule: vi.fn(),
  controls: {
    sourceTransportState: {
      chromeState: "ready",
      sourceLabel: "LIVE",
      statusLabel: "00:00",
      actionLabel: "START",
      actionKind: "start",
      primaryActionDisabled: false,
    },
    onSourceTransportAction: vi.fn(),
    onClear: vi.fn(),
    clearDisabled: false,
    dockEdge: "bottom",
    onDockEdgeChange: vi.fn(),
    onExitDock: vi.fn(),
    notice: null,
  },
  presets: { list: [], activeId: null, dirty: false, apply: vi.fn(), save: vi.fn() },
};

function renderStrip(props = {}) {
  return render(
    <FrameDataProvider value={{ displayAudio: { peakDb: [-12, -10] }, correlation: 0.3 }}>
      <HistoryDataProvider value={{ histSourceList: [] }}>
        <DockStrip {...BASE_PROPS} {...props} />
      </HistoryDataProvider>
    </FrameDataProvider>
  );
}

describe("DockStrip", () => {
  it("renders the enabled modules in order", () => {
    renderStrip();
    expect(screen.getAllByTestId("dock-module")).toHaveLength(2);
  });

  it("reveals controls on pointer enter and hides them after leave", () => {
    renderStrip();
    expect(screen.queryByRole("button", { name: /restore window/i })).toBeNull();
    fireEvent.pointerEnter(screen.getByTestId("dock-strip"));
    expect(screen.getByRole("button", { name: /restore window/i })).toBeTruthy();
  });

  it("opens the modules editor from the control bar", () => {
    renderStrip();
    fireEvent.pointerEnter(screen.getByTestId("dock-strip"));
    fireEvent.click(screen.getByRole("button", { name: /edit modules/i }));
    expect(screen.getByRole("button", { name: /done/i })).toBeTruthy();
  });

  it("shows the health dot in error state when the notice is an error", () => {
    renderStrip({
      controls: { ...BASE_PROPS.controls, notice: { kind: "error", text: "capture failed" } },
    });
    expect(screen.getByTestId("dock-health-dot").dataset.health).toBe("error");
  });
});
