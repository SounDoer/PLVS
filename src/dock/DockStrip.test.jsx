import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../workspace/AudioDataContext.jsx";
import { DockStrip } from "./DockStrip.jsx";

const BASE_PROPS = {
  panels: [
    { id: "levelMeter", moduleId: "levelMeter" },
    { id: "vectorscope", moduleId: "vectorscope" },
  ],
  onPointerEnter: vi.fn(),
  onPointerLeave: vi.fn(),
  controls: {
    sourceTransportState: {
      chromeState: "ready",
      sourceLabel: "LIVE",
      statusLabel: "00:00",
      actionLabel: "START",
      actionKind: "start",
      primaryActionDisabled: false,
    },
    notice: null,
  },
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

  it("reports pointer presence without rendering accessory controls in the strip", () => {
    const onPointerEnter = vi.fn();
    const onPointerLeave = vi.fn();
    renderStrip({ onPointerEnter, onPointerLeave });
    fireEvent.pointerEnter(screen.getByTestId("dock-strip"));
    fireEvent.pointerLeave(screen.getByTestId("dock-strip"));
    expect(onPointerEnter).toHaveBeenCalledOnce();
    expect(onPointerLeave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /restore window/i })).toBeNull();
  });

  it("passes controls down to the timer-only transport module", () => {
    renderStrip({ panels: [{ id: "transport", moduleId: "transport" }] });
    expect(screen.getByTestId("dock-transport-timer").textContent).toBe("00:00");
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("draws an accent frame around the module hovered in the editor", () => {
    renderStrip({ hoveredPanelId: "vectorscope" });
    const modules = screen.getAllByTestId("dock-module");
    expect(modules[0].dataset.hoverHighlighted).toBeUndefined();
    expect(modules[1].dataset.hoverHighlighted).toBe("true");
    expect(modules[1].className).toContain("ring-primary/60");
  });
});
