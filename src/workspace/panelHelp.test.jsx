/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { SplitLayout } from "./SplitLayout.jsx";
import { WorkspacePreviewProvider, useWorkspaceStore } from "./WorkspaceContext.jsx";
import { DragProvider } from "./DragContext.jsx";
import { HistoryDataProvider, PanelChromeProvider } from "./AudioDataContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "./constants.js";
import { normalizePanelControls } from "../lib/panelControls.js";

// Exercise both real header mounts without rendering audio plots or unrelated settings editors.
vi.mock("../components/panels/VectorscopePanel", () => ({ VectorscopePanel: () => null }));
vi.mock("../components/PanelSettingsMenu.jsx", () => ({ PanelSettingsMenu: () => null }));

beforeEach(() => {
  window.matchMedia = vi.fn().mockImplementation((media) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe.each([false, true])("panel help in fullscreen=%s", (fullscreen) => {
  it("updates and removes help with the panel's own snapshot state, including an open pin", () => {
    const state = {
      ...DEFAULT_WORKSPACE_STATE,
      tree: {
        type: /** @type {const} */ ("leaf"),
        tabs: ["vectorscope"],
        activeTab: "vectorscope",
      },
      fullscreenId: fullscreen ? "vectorscope" : null,
      panelControlsById: {
        ...DEFAULT_WORKSPACE_STATE.panelControlsById,
        vectorscope: normalizePanelControls({
          vectorscopeMode: "polarLevel",
          vectorscopePolarLevelMaxHold: true,
        }),
      },
    };
    const renderLayout = (selectedOffset) => (
      <HistoryDataProvider value={{ selectedOffset, running: false, hasHistoryData: false }}>
        <PanelChromeProvider value={{ hideAxesAndLabels: false }}>
          <WorkspacePreviewProvider state={state}>
            <DragProvider onDrop={vi.fn()}>
              <SplitLayout />
            </DragProvider>
          </WorkspacePreviewProvider>
        </PanelChromeProvider>
      </HistoryDataProvider>
    );
    const { rerender } = render(renderLayout(-1));
    const trigger = screen.getByRole("button", { name: "Shortcuts and gestures" });
    fireEvent.click(trigger);
    expect(screen.getByText("Reset Max Hold")).toBeTruthy();
    rerender(renderLayout(0));
    expect(screen.queryByRole("button", { name: "Shortcuts and gestures" })).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Panel gestures" })).toBeNull();
    rerender(renderLayout(-1));
    expect(
      screen.getByRole("button", { name: "Shortcuts and gestures" }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(screen.queryByRole("dialog", { name: "Panel gestures" })).toBeNull();
  });
});

it("Escape closes help without exiting fullscreen", () => {
  /** @type {any} */
  let workspace;
  function Actions() {
    workspace = useWorkspaceStore();
    return null;
  }
  render(
    <HistoryDataProvider value={{ selectedOffset: -1 }}>
      <PanelChromeProvider value={{}}>
        <WorkspacePreviewProvider
          state={{
            ...DEFAULT_WORKSPACE_STATE,
            tree: { type: "leaf", tabs: ["vectorscope"], activeTab: "vectorscope" },
            panelControlsById: {
              ...DEFAULT_WORKSPACE_STATE.panelControlsById,
              vectorscope: normalizePanelControls({ vectorscopeMode: "lissajous" }),
            },
          }}
        >
          <Actions />
          <DragProvider onDrop={vi.fn()}>
            <SplitLayout />
          </DragProvider>
        </WorkspacePreviewProvider>
      </PanelChromeProvider>
    </HistoryDataProvider>
  );
  act(() => workspace.setFullscreen("vectorscope"));
  fireEvent.click(screen.getByRole("button", { name: "Shortcuts and gestures" }));
  fireEvent.keyDown(screen.getByRole("dialog", { name: "Panel gestures" }), { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "Panel gestures" })).toBeNull();
  expect(workspace.state.fullscreenId).toBe("vectorscope");
});
