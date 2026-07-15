import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { FrameDataProvider, HistoryDataProvider } from "../workspace/AudioDataContext.jsx";
import { DockStrip } from "./DockStrip.jsx";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
  }
  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

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

  it("exposes the resolved height presentation tier", () => {
    const { rerender } = renderStrip({ height: 119 });
    expect(screen.getByTestId("dock-strip").dataset.heightMode).toBe("standard");

    rerender(
      <FrameDataProvider value={{ displayAudio: { peakDb: [-12, -10] }, correlation: 0.3 }}>
        <HistoryDataProvider value={{ histSourceList: [] }}>
          <DockStrip {...BASE_PROPS} height={120} />
        </HistoryDataProvider>
      </FrameDataProvider>
    );
    expect(screen.getByTestId("dock-strip").dataset.heightMode).toBe("expanded");
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

  it("routes time-window gestures through the shared Dock viewport", () => {
    const onDockHistoryWheel = vi.fn();
    const onDockHistoryPointerDown = vi.fn();
    renderStrip({
      panels: [
        { id: "loudness-1", moduleId: "loudness" },
        { id: "waveform-1", moduleId: "waveform" },
      ],
      controls: {
        ...BASE_PROPS.controls,
        dockHistoryWindowSec: 60,
        dockHistoryHud: { panelId: "waveform-1", windowSec: 60 },
        onDockHistoryWheel,
        onDockHistoryPointerDown,
      },
    });

    fireEvent.wheel(screen.getByTestId("dock-loudness-history"), { deltaY: -1 });
    expect(onDockHistoryWheel).toHaveBeenCalledWith("loudness-1", -1);
    const waveformCanvas = screen.getByTestId("dock-waveform-canvas");
    fireEvent(waveformCanvas, new MouseEvent("pointerdown", { bubbles: true, button: 2 }));
    expect(onDockHistoryPointerDown).toHaveBeenCalledWith("waveform-1", 2, expect.any(Number));
    expect(screen.getByRole("status").textContent).toBe("1m");
  });

  it("draws an accent frame around the module hovered in the editor", () => {
    renderStrip({ hoveredPanelId: "vectorscope" });
    const modules = screen.getAllByTestId("dock-module");
    expect(modules[0].dataset.hoverHighlighted).toBeUndefined();
    expect(modules[1].dataset.hoverHighlighted).toBe("true");
    expect(modules[1].className).toContain("ring-primary/60");
  });

  it("exposes an edge-aware keyboard height resize handle", () => {
    const onHeightChange = vi.fn();
    renderStrip({ edge: "bottom", height: 72, onHeightChange });
    const handle = screen.getByRole("separator", { name: /resize dock height/i });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "ArrowDown", shiftKey: true });
    fireEvent.doubleClick(handle);
    expect(onHeightChange).toHaveBeenNthCalledWith(1, 76, { persist: true });
    expect(onHeightChange).toHaveBeenNthCalledWith(2, 56, { persist: true });
    expect(onHeightChange).toHaveBeenNthCalledWith(3, 72, { persist: true });
  });

  it("disables height resizing while an accessory editor is open", () => {
    renderStrip({ heightResizeDisabled: true });
    const handle = screen.getByRole("separator", { name: /resize dock height/i });
    expect(handle.getAttribute("aria-disabled")).toBe("true");
    expect(handle.getAttribute("tabindex")).toBe("-1");
  });

  it("resizes and resets an adjacent panel pair from its divider", () => {
    const onPanelResize = vi.fn();
    const onPanelResizeReset = vi.fn();
    renderStrip({ onPanelResize, onPanelResizeReset });
    const divider = screen.getByRole("separator", {
      name: /resize levelMeter and vectorscope/i,
    });
    fireEvent.keyDown(divider, { key: "ArrowRight" });
    fireEvent.doubleClick(divider);
    expect(onPanelResize).toHaveBeenCalledWith({
      leftPanelId: "levelMeter",
      rightPanelId: "vectorscope",
      leftWidth: 180,
      rightWidth: 220,
      delta: 4,
      persist: true,
    });
    expect(onPanelResizeReset).toHaveBeenCalledWith("levelMeter", "vectorscope");
  });

  it("resizes from preferred bases instead of flexible rendered widths", () => {
    const onPanelResize = vi.fn();
    renderStrip({
      panels: [
        { id: "spectrum", moduleId: "spectrum" },
        { id: "levelMeter", moduleId: "levelMeter" },
      ],
      panelSizesById: { spectrum: 600, levelMeter: 200 },
      onPanelResize,
    });
    const [spectrum, level] = screen.getAllByTestId("dock-module");
    vi.spyOn(spectrum, "getBoundingClientRect").mockReturnValue({ width: 1200 });
    vi.spyOn(level, "getBoundingClientRect").mockReturnValue({ width: 200 });
    const divider = screen.getByRole("separator", {
      name: /resize spectrum and levelMeter/i,
    });

    const pointerEvent = (type, values) => {
      const event = new Event(type, { bubbles: true });
      for (const [key, value] of Object.entries(values)) {
        Object.defineProperty(event, key, { value });
      }
      return event;
    };
    fireEvent(divider, pointerEvent("pointerdown", { button: 0, pointerId: 1, clientX: 100 }));
    fireEvent(divider, pointerEvent("pointermove", { pointerId: 1, clientX: 112 }));
    fireEvent(divider, pointerEvent("pointerup", { pointerId: 1, clientX: 112 }));

    expect(onPanelResize).toHaveBeenNthCalledWith(1, {
      leftPanelId: "spectrum",
      rightPanelId: "levelMeter",
      leftWidth: 600,
      rightWidth: 200,
      delta: 12,
      persist: false,
    });
    expect(onPanelResize).toHaveBeenNthCalledWith(2, {
      leftPanelId: "spectrum",
      rightPanelId: "levelMeter",
      leftWidth: 600,
      rightWidth: 200,
      delta: 12,
      persist: true,
    });
  });
});
