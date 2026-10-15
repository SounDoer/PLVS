/** @vitest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { LoudnessProfileProvider } from "../hooks/LoudnessProfileContext.jsx";
import { FrameDataProvider, HistoryDataProvider } from "../workspace/AudioDataContext.jsx";
import { DockStrip } from "./DockStrip.jsx";

beforeAll(() => {
  class ResizeObserverStub {
    observe() {}
    disconnect() {}
    unobserve() {}
  }
  window.ResizeObserver = ResizeObserverStub;
  globalThis.ResizeObserver = ResizeObserverStub;
});

const BASE_PROPS = {
  panels: [
    { id: "levelMeter", moduleId: "levelMeter" },
    { id: "vectorscope", moduleId: "vectorscope" },
  ],
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
    <LoudnessProfileProvider>
      <FrameDataProvider value={{ displayAudio: { peakDb: [-12, -10] }, correlation: 0.3 }}>
        <HistoryDataProvider value={{ histSourceList: [] }}>
          <DockStrip {...BASE_PROPS} {...props} />
        </HistoryDataProvider>
      </FrameDataProvider>
    </LoudnessProfileProvider>
  );
}

describe("DockStrip", () => {
  it("does not add layout space when entering Snapshot", () => {
    const tree = (selectedOffset) => (
      <HistoryDataProvider value={{ selectedOffset }}>
        <DockStrip panels={[]} controls={{}} />
      </HistoryDataProvider>
    );
    const { rerender } = render(tree(-1));
    const before = screen.getByTestId("dock-strip").innerHTML;
    rerender(tree(0));
    expect(screen.getByTestId("dock-strip").innerHTML).toBe(before);
    expect(screen.getByTestId("dock-strip").hasAttribute("data-history")).toBe(true);
    expect(screen.queryByRole("button", { name: "Go Live" })).toBeNull();
  });

  it("applies surface opacity once to the Dock shell", () => {
    renderStrip();

    expect(screen.getByTestId("dock-strip").style.background).toBe("");
    for (const module of screen.getAllByTestId("dock-module")) {
      expect(module.style.opacity).toBe("");
    }
  });

  it("renders the enabled modules in order", () => {
    renderStrip();
    expect(screen.getAllByTestId("dock-module")).toHaveLength(2);
  });

  it("exposes the resolved height presentation tier", () => {
    const { rerender } = renderStrip({ height: 119 });
    expect(screen.getByTestId("dock-strip").dataset.heightMode).toBe("standard");

    rerender(
      <LoudnessProfileProvider>
        <FrameDataProvider value={{ displayAudio: { peakDb: [-12, -10] }, correlation: 0.3 }}>
          <HistoryDataProvider value={{ histSourceList: [] }}>
            <DockStrip {...BASE_PROPS} height={120} />
          </HistoryDataProvider>
        </FrameDataProvider>
      </LoudnessProfileProvider>
    );
    expect(screen.getByTestId("dock-strip").dataset.heightMode).toBe("expanded");
  });

  it("offers the toolbar entry and no accessory controls", () => {
    const onToolbarToggle = vi.fn();
    renderStrip({ onToolbarToggle });

    const entry = screen.getByRole("button", { name: "show toolbar" });
    expect(entry.getAttribute("aria-pressed")).toBe("false");
    fireEvent.pointerEnter(screen.getByTestId("dock-strip"));
    fireEvent.pointerLeave(screen.getByTestId("dock-strip"));
    expect(onToolbarToggle).not.toHaveBeenCalled();

    fireEvent.click(entry);
    expect(onToolbarToggle).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: /restore window/i })).toBeNull();
  });

  it("marks the entry pressed while the toolbar is shown", () => {
    renderStrip({ toolbarOpen: true });

    const entry = screen.getByRole("button", { name: "hide toolbar" });
    expect(entry.getAttribute("aria-pressed")).toBe("true");
  });

  it.each([
    ["bottom", false, "up"],
    ["bottom", true, "down"],
    ["top", false, "down"],
    ["top", true, "up"],
  ])("points the entry arrow for edge %s, open %s: %s", (edge, toolbarOpen, direction) => {
    renderStrip({ edge, toolbarOpen });

    const icon = screen.getByRole("button", { name: /toolbar$/ }).querySelector("svg");
    expect(icon.dataset.direction).toBe(direction);
  });

  it("keeps the entry out of the module row", () => {
    renderStrip();

    const entry = screen.getByRole("button", { name: "show toolbar" });
    for (const module of screen.getAllByTestId("dock-module")) {
      expect(module.contains(entry)).toBe(false);
    }
  });

  it("caps a flexible module's auto-grow at its preferred max width", () => {
    // A lone flexible module (no persisted panelSizesById entry) among otherwise-fixed modules
    // used to flex-grow unbounded to fill the whole strip; it must stop at maxPreferredWidth.
    renderStrip({
      panels: [
        { id: "levelMeter", moduleId: "levelMeter" },
        { id: "spectrum", moduleId: "spectrum" },
      ],
    });
    const [, spectrum] = screen.getAllByTestId("dock-module");
    expect(spectrum.style.maxWidth).toBe("960px");
  });

  it("draws an accent frame around the module hovered in the editor", () => {
    renderStrip({ hoveredPanelId: "vectorscope" });
    const modules = screen.getAllByTestId("dock-module");
    expect(modules[0].dataset.hoverHighlighted).toBeUndefined();
    expect(modules[1].dataset.hoverHighlighted).toBe("true");
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
    expect(onHeightChange).toHaveBeenNthCalledWith(3, 56, { persist: true });
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
    vi.spyOn(spectrum, "getBoundingClientRect").mockReturnValue(
      /** @type {ReturnType<typeof spectrum.getBoundingClientRect>} */ ({ width: 1200 })
    );
    vi.spyOn(level, "getBoundingClientRect").mockReturnValue(
      /** @type {ReturnType<typeof level.getBoundingClientRect>} */ ({ width: 200 })
    );
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
