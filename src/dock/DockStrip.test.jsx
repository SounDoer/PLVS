import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../workspace/AudioDataContext.jsx";
import { DockStrip } from "./DockStrip.jsx";

const BASE_PROPS = {
  modules: ["level", "correlation"],
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

  it("passes controls down to modules (transport pill renders without hover)", () => {
    renderStrip({ modules: ["transport"] });
    // DockTransport reads controls.sourceTransportState; no hover involved.
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
  });

  it("shows the health dot in error state when the notice is an error", () => {
    renderStrip({
      controls: { ...BASE_PROPS.controls, notice: { kind: "error", text: "capture failed" } },
    });
    expect(screen.getByTestId("dock-health-dot").dataset.health).toBe("error");
  });
});
