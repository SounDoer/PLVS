/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceProvider, useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { DEFAULT_WORKSPACE_STATE } from "../workspace/constants.js";
import { presetsStore } from "../persistence/index.js";

const mocks = vi.hoisted(() => ({
  applyWindowBounds: vi.fn(),
  currentWindowBounds: vi.fn(),
  isTauri: vi.fn(() => false),
}));

vi.mock("../ipc/commands.js", () => ({
  applyWindowBounds: mocks.applyWindowBounds,
  currentWindowBounds: mocks.currentWindowBounds,
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: mocks.isTauri,
}));

import { usePresets } from "./usePresets.js";

function wrapper({ children }) {
  return <WorkspaceProvider>{children}</WorkspaceProvider>;
}

function renderPresetHook(presetOptions = {}) {
  return renderHook(
    () => ({
      presets: usePresets(presetOptions),
      workspace: useWorkspaceStore(),
    }),
    { wrapper }
  );
}

function leaf(tabs, activeTab = tabs[0]) {
  return { type: "leaf", tabs: [...tabs], activeTab };
}

describe("usePresets", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(Date, "now").mockReturnValue(123);
    mocks.applyWindowBounds.mockReset().mockResolvedValue(undefined);
    mocks.currentWindowBounds.mockReset().mockResolvedValue({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      isMaximized: false,
    });
    mocks.isTauri.mockReset().mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("starts with an empty list", () => {
    const { result } = renderPresetHook();
    expect(result.current.presets.list).toEqual([]);
    expect(result.current.presets.activeId).toBeNull();
  });

  it("saves a cloned snapshot and live window bounds in Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);
    const { result } = renderPresetHook({
      windowPinned: true,
      focusView: { autoHideControls: true, compactPanels: false },
    });
    await act(async () => {
      await result.current.presets.save("Mixing");
    });

    const saved = presetsStore.read().list[0];
    expect(saved).toMatchObject({
      id: "preset-123",
      name: "Mixing",
      windowBounds: { x: 10, y: 20, width: 800, height: 600, isMaximized: false },
      windowPinned: true,
      focusView: { autoHideControls: true, compactPanels: false },
    });
    expect(saved.tree).toEqual(DEFAULT_WORKSPACE_STATE.tree);
    expect(saved.tree).not.toBe(DEFAULT_WORKSPACE_STATE.tree);
    expect(saved.panelsById).toEqual(DEFAULT_WORKSPACE_STATE.panelsById);
    expect(saved.panelsById).not.toBe(DEFAULT_WORKSPACE_STATE.panelsById);
    expect(saved.panelOrder).toEqual(DEFAULT_WORKSPACE_STATE.panelOrder);
    expect(saved.panelOrder).not.toBe(DEFAULT_WORKSPACE_STATE.panelOrder);
    expect(presetsStore.read().activeId).toBe("preset-123");
  });

  it("omits windowBounds outside Tauri", async () => {
    const { result } = renderPresetHook({ windowPinned: false });
    await act(async () => {
      await result.current.presets.save("Browser");
    });
    expect(presetsStore.read().list[0]).not.toHaveProperty("windowBounds");
    expect(mocks.currentWindowBounds).not.toHaveBeenCalled();
    expect(presetsStore.read().list[0].windowPinned).toBe(false);
  });

  it("applies view, window bounds, and pin state, then marks active", async () => {
    mocks.isTauri.mockReturnValue(true);
    const setWindowPinned = vi.fn();
    const setFocusView = vi.fn();
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
          windowBounds: { x: 1, y: 2, width: 300, height: 200, isMaximized: false },
          windowPinned: true,
          focusView: { autoHideControls: true, compactPanels: true },
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook({ windowPinned: false, setWindowPinned, setFocusView });
    await act(async () => {
      await result.current.presets.apply("p1");
    });
    expect(result.current.workspace.state.tree).toEqual(leaf(["spectrum"]));
    expect(mocks.applyWindowBounds).toHaveBeenCalledWith({
      x: 1,
      y: 2,
      width: 300,
      height: 200,
      isMaximized: false,
    });
    expect(setWindowPinned).toHaveBeenCalledWith(true);
    expect(setFocusView).toHaveBeenCalledWith({
      autoHideControls: true,
      compactPanels: true,
    });
    expect(presetsStore.read().activeId).toBe("p1");
  });

  it("does not change Focus View when applying an older preset", async () => {
    const setFocusView = vi.fn();
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook({ setFocusView });
    await act(async () => {
      await result.current.presets.apply("p1");
    });
    expect(setFocusView).not.toHaveBeenCalled();
    expect(presetsStore.read().activeId).toBe("p1");
  });

  it("leaves activeId null when window apply fails", async () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.applyWindowBounds.mockRejectedValue(new Error("nope"));
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
          windowBounds: { x: 1, y: 2, width: 300, height: 200, isMaximized: false },
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook();
    await act(async () => {
      await result.current.presets.apply("p1");
    });
    expect(presetsStore.read().activeId).toBeNull();
  });

  it("updates an existing preset while preserving id and name", async () => {
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["levelMeter"]),
          panelsById: {
            levelMeter: { id: "levelMeter", moduleId: "levelMeter", customTitle: "Main Meter" },
          },
          panelOrder: ["levelMeter"],
          panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook();
    act(() => result.current.workspace.setTree(leaf(["loudness"])));
    await act(async () => {
      await result.current.presets.update("p1");
    });
    expect(presetsStore.read().list[0]).toMatchObject({
      id: "p1",
      name: "Preset",
      tree: leaf(["loudness"]),
      focusView: { autoHideControls: false, compactPanels: false },
    });
    expect(presetsStore.read().activeId).toBe("p1");
  });

  it("renames and removes presets", () => {
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["levelMeter"]),
          panelsById: { levelMeter: { id: "levelMeter", moduleId: "levelMeter" } },
          panelOrder: ["levelMeter"],
        },
      ],
      activeId: "p1",
    });
    const { result } = renderPresetHook();
    act(() => result.current.presets.rename("p1", "Renamed"));
    expect(presetsStore.read().list[0].name).toBe("Renamed");
    act(() => result.current.presets.remove("p1"));
    expect(presetsStore.read()).toEqual({ list: [], activeId: null });
  });
});
