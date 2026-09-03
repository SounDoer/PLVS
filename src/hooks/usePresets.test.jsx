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
  onWindowBoundsChanged: vi.fn(),
  unlistenWindowBounds: vi.fn(),
  windowBoundsHandler: null,
  isDecorated: vi.fn(),
  setDecorations: vi.fn(),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({
    isDecorated: mocks.isDecorated,
    setDecorations: mocks.setDecorations,
  }),
}));

vi.mock("../ipc/commands.js", () => ({
  applyWindowBounds: mocks.applyWindowBounds,
  currentWindowBounds: mocks.currentWindowBounds,
}));

vi.mock("../ipc/env.js", () => ({
  isTauri: mocks.isTauri,
}));

vi.mock("../ipc/events.js", () => ({
  onWindowBoundsChanged: mocks.onWindowBoundsChanged,
}));

import { useState } from "react";
import { usePresets } from "./usePresets.js";
import {
  BlockingEditorsProvider,
  useBlockingEditor,
  useBlockingEditors,
} from "./BlockingEditorsContext.jsx";
import { LoudnessProfileProvider, useLoudnessProfile } from "./LoudnessProfileContext.jsx";
import { settingsStore } from "../persistence/index.js";
import { LOUDNESS_PROFILE_OFF, profileSelectionId } from "../lib/loudnessProfileCatalog.js";

const TEST_PROFILE = {
  id: "test-profile",
  name: "Test profile",
  referenceLufs: -23,
  rules: [
    { metricId: "integrated", op: ">", value: -22.5, severity: "fail" },
    { metricId: "integrated", op: "<", value: -23.5, severity: "fail" },
    { metricId: "truePeak", op: ">", value: -1, severity: "fail" },
  ],
};

function wrapper({ children }) {
  return (
    <WorkspaceProvider>
      <LoudnessProfileProvider>{children}</LoudnessProfileProvider>
    </WorkspaceProvider>
  );
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

/// Presets and the profile wired together the way App does, so a round-trip has to survive the
/// real capture -> persist -> apply path.
function renderPresetsWithProfile() {
  return renderHook(
    () => {
      const profile = useLoudnessProfile();
      return {
        profile,
        presets: usePresets({
          snapshotLoudnessProfile: profile.snapshotForPreset,
          applyLoudnessProfileSnapshot: profile.applyPresetSnapshot,
        }),
      };
    },
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
    mocks.isDecorated.mockReset().mockResolvedValue(true);
    mocks.setDecorations.mockReset().mockResolvedValue(undefined);
    mocks.unlistenWindowBounds.mockReset();
    mocks.windowBoundsHandler = null;
    mocks.onWindowBoundsChanged.mockReset().mockImplementation(async (handler) => {
      mocks.windowBoundsHandler = handler;
      return mocks.unlistenWindowBounds;
    });
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
    expect(saved.pinnedPanelsById).toEqual({});
    expect(presetsStore.read().activeId).toBe("preset-123");
  });

  it("saves pinned panel sizes in snapshots", async () => {
    const { result } = renderPresetHook();
    act(() => {
      result.current.workspace.setPanelPinned("spectrum", { width: 640, height: 260 });
    });

    await act(async () => {
      await result.current.presets.save("Pinned");
    });

    expect(presetsStore.read().list[0].pinnedPanelsById).toEqual({
      spectrum: { width: 640, height: 260 },
    });
  });

  it("saves and restores the shared frequency viewport", async () => {
    const { result } = renderPresetHook();
    act(() => {
      result.current.workspace.setAxisViewport("frequency", { min: 200, max: 5000 });
    });

    expect(result.current.workspace.state.axisViewports.frequency).toEqual({
      min: 200,
      max: 5000,
    });
    await act(async () => {
      await result.current.presets.save("Zoomed");
    });
    expect(presetsStore.read().list[0].axisViewports.frequency).toEqual({ min: 200, max: 5000 });

    act(() => {
      result.current.workspace.setAxisViewport("frequency", { min: 20, max: 20000 });
    });
    await act(async () => {
      await result.current.presets.apply(presetsStore.read().list[0].id);
    });

    expect(result.current.workspace.state.axisViewports.frequency).toEqual({
      min: 200,
      max: 5000,
    });
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
          pinnedPanelsById: { spectrum: { width: 640, height: 260 } },
          windowBounds: { x: 1, y: 2, width: 300, height: 200, isMaximized: false },
          windowPinned: true,
          focusView: { autoHideControls: true, compactPanels: true },
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook({
      windowPinned: false,
      setWindowPinned,
      setFocusView,
    });
    await act(async () => {
      await result.current.presets.apply("p1");
    });
    expect(result.current.workspace.state.tree).toEqual(leaf(["spectrum"]));
    expect(result.current.workspace.state.pinnedPanelsById).toEqual({
      spectrum: { width: 640, height: 260 },
    });
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
      borderless: false,
    });
    expect(presetsStore.read().activeId).toBe("p1");
  });

  it("strips chrome before applying window bounds", async () => {
    // windowBounds pairs an outer position with an inner size. Land the bounds
    // while the window still wears the old chrome and the later decoration flip
    // hands the title bar area back to the client, growing the window past the
    // preset's — the drift this ordering exists to prevent.
    mocks.isTauri.mockReturnValue(true);
    const order = [];
    mocks.setDecorations.mockImplementation(async (enabled) => {
      order.push(`decorations:${enabled}`);
    });
    mocks.applyWindowBounds.mockImplementation(async () => {
      order.push("bounds");
    });
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Borderless",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
          pinnedPanelsById: {},
          windowBounds: { x: 1, y: 2, width: 300, height: 200, isMaximized: false },
          focusView: { autoHideControls: false, compactPanels: false, borderless: true },
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook({ setFocusView: vi.fn() });
    await act(async () => {
      await result.current.presets.apply("p1");
    });

    expect(order).toEqual(["decorations:false", "bounds"]);
  });

  it("does not reapply normal bounds after Dock exit restored the preset bounds", async () => {
    mocks.isTauri.mockReturnValue(true);
    const applyDockPreset = vi.fn(async () => true);
    const windowBounds = { x: 1, y: 2, width: 300, height: 200, isMaximized: false };
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: DEFAULT_WORKSPACE_STATE.panelControlsById,
          windowBounds,
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook({ applyDockPreset });

    await act(async () => {
      await result.current.presets.apply("p1");
    });

    expect(applyDockPreset).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false }),
      expect.objectContaining({ bounds: windowBounds })
    );
    expect(mocks.applyWindowBounds).not.toHaveBeenCalled();
    expect(presetsStore.read()).toMatchObject({ activeId: "p1", dirty: false });
  });

  it("marks the active preset dirty when window bounds change in Tauri", async () => {
    mocks.isTauri.mockReturnValue(true);
    presetsStore.patch({
      list: [
        {
          id: "p1",
          name: "Preset",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
        },
      ],
      activeId: "p1",
      dirty: false,
    });

    renderPresetHook();
    await act(async () => {});

    Date.now.mockReturnValue(2000);
    act(() => {
      mocks.windowBoundsHandler();
    });

    expect(presetsStore.read().dirty).toBe(true);
  });

  it("suppresses preset dirty marking while applying stored window bounds", async () => {
    mocks.isTauri.mockReturnValue(true);
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
      dirty: false,
    });
    const { result } = renderPresetHook();
    await act(async () => {});

    await act(async () => {
      await result.current.presets.apply("p1");
    });

    act(() => {
      mocks.windowBoundsHandler();
    });
    expect(presetsStore.read().dirty).toBe(false);

    Date.now.mockReturnValue(2000);
    act(() => {
      mocks.windowBoundsHandler();
    });
    expect(presetsStore.read().dirty).toBe(true);
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

  it("round-trips Stereo Map panel controls through save and apply", async () => {
    // Stereo Map's own panel module and Add Panel registration land in a later task; this exercises
    // the control-normalization/persistence layer this task owns by carrying stereoMap* keys on an
    // already-registered panel's controls object, the same flat, module-agnostic shape every panel
    // instance's controls already use.
    const { result } = renderPresetHook();
    const panelId = result.current.workspace.state.panelOrder.find(
      (id) => result.current.workspace.state.panelsById[id].moduleId === "spectrum"
    );
    const stereoMapControls = {
      stereoMapMode: "msRatioDb",
      stereoMapPair: { x: 0, y: 1 },
      stereoMapHold: true,
      stereoMapSpeedPercent: 60,
      stereoMapOctaveSmoothing: "1/6",
      stereoMapXMinFreq: 100,
      stereoMapXMaxFreq: 8000,
      stereoMapMonoLossYMinDb: -40,
      stereoMapMsRatioYMinDb: -30,
      stereoMapMsRatioYMaxDb: 30,
    };
    act(() => {
      result.current.workspace.setPanelControlsForPanel(panelId, stereoMapControls);
    });

    await act(async () => {
      await result.current.presets.save("StereoMap");
    });
    const saved = presetsStore.read().list[0];
    expect(saved.panelControlsById[panelId]).toMatchObject(stereoMapControls);

    act(() =>
      result.current.workspace.setPanelControlsForPanel(panelId, { stereoMapMode: "position" })
    );
    await act(async () => {
      await result.current.presets.apply(saved.id);
    });
    expect(result.current.workspace.state.panelControlsById[panelId]).toMatchObject(
      stereoMapControls
    );
  });

  it("filters out presets referencing unknown module ids", () => {
    presetsStore.patch({
      list: [
        {
          id: "p-valid",
          name: "Valid",
          tree: leaf(["spectrum"]),
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
        },
        {
          id: "p-legacy",
          name: "Legacy",
          tree: leaf(["loudnessStats"]),
          panelsById: { loudnessStats: { id: "loudnessStats", moduleId: "loudnessStats" } },
          panelOrder: ["loudnessStats"],
        },
      ],
      activeId: "p-legacy",
    });
    const { result } = renderPresetHook();
    expect(result.current.presets.list).toHaveLength(1);
    expect(result.current.presets.list[0].id).toBe("p-valid");
    // activeId pointed at the dropped legacy preset: it must not dangle.
    expect(result.current.presets.activeId).toBeNull();
  });

  it("captures and restores panelOpacity in presets", async () => {
    const setPanelOpacity = vi.fn();
    const { result } = renderPresetHook({ panelOpacity: 75, setPanelOpacity });
    await act(async () => {
      await result.current.presets.save("WithOpacity");
    });
    const saved = presetsStore.read().list[0];
    expect(saved.panelOpacity).toBe(75);

    // Apply restores it
    await act(async () => {
      await result.current.presets.apply(saved.id);
    });
    expect(setPanelOpacity).toHaveBeenCalledWith(75);
  });

  it("does not call setPanelOpacity when applying an older preset without panelOpacity", async () => {
    const setPanelOpacity = vi.fn();
    presetsStore.patch({
      list: [
        {
          id: "p-old",
          name: "Old",
          tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
          panelControlsById: {},
        },
      ],
      activeId: null,
    });
    const { result } = renderPresetHook({ setPanelOpacity });
    await act(async () => {
      await result.current.presets.apply("p-old");
    });
    expect(setPanelOpacity).not.toHaveBeenCalled();
  });

  it("captures and restores glassEnabled in presets", async () => {
    const setGlassEnabled = vi.fn();
    const { result } = renderPresetHook({ glassEnabled: true, setGlassEnabled });
    await act(async () => {
      await result.current.presets.save("WithGlass");
    });
    const saved = presetsStore.read().list[0];
    expect(saved.glassEnabled).toBe(true);

    await act(async () => {
      await result.current.presets.apply(saved.id);
    });
    expect(setGlassEnabled).toHaveBeenCalledWith(true);
  });

  it("does not call setGlassEnabled when applying an older preset without glassEnabled", async () => {
    const setGlassEnabled = vi.fn();
    presetsStore.patch({
      list: [
        {
          id: "p-old-glass",
          name: "OldGlass",
          tree: { type: "leaf", tabs: ["spectrum"], activeTab: "spectrum" },
          panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
          panelOrder: ["spectrum"],
        },
      ],
      activeId: null,
      dirty: false,
    });
    const { result } = renderPresetHook({ setGlassEnabled });
    await act(async () => {
      await result.current.presets.apply("p-old-glass");
    });
    expect(setGlassEnabled).not.toHaveBeenCalled();
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

  describe("dock in presets", () => {
    it("captureSnapshot includes the dock field", async () => {
      const dock = {
        enabled: true,
        edge: "top",
        monitor: "\\\\.\\DISPLAY2",
        reserveSpace: true,
        height: 96,
        panelsById: {
          levelMeter: { id: "levelMeter", moduleId: "levelMeter" },
          spectrum: { id: "spectrum", moduleId: "spectrum" },
        },
        panelOrder: ["levelMeter", "spectrum"],
        panelSizesById: { levelMeter: 210, spectrum: 420 },
        controlsByPanelId: { spectrum: { channel: { type: "single", channel: 0 } } },
      };
      const { result } = renderPresetHook({ dock });
      let preset;
      await act(async () => {
        preset = await result.current.presets.save("Docked");
      });
      expect(preset.dock).toEqual({
        ...dock,
      });
    });

    it("apply calls applyDockPreset with the preset dock (or a disabled default)", async () => {
      const applyDockPreset = vi.fn(async () => {});
      const { result } = renderPresetHook({ applyDockPreset });
      let preset;
      await act(async () => {
        preset = await result.current.presets.save("Normal");
      });
      await act(async () => {
        await result.current.presets.apply(preset.id);
      });
      expect(applyDockPreset).toHaveBeenCalledWith(
        {
          enabled: false,
          edge: "bottom",
          monitor: null,
          reserveSpace: false,
          height: 72,
          panelsById: {},
          panelOrder: [],
          panelSizesById: {},
          controlsByPanelId: {},
        },
        expect.objectContaining({ bounds: preset.windowBounds })
      );
    });

    it("rejects an ineligible dock preset before mutating the workspace", async () => {
      const applyDockPreset = vi.fn(async () => {});
      const dockPresetUnavailableReason = vi.fn(() => "fileMode");
      const onApplyError = vi.fn();
      presetsStore.patch({
        list: [
          {
            id: "dock-file-blocked",
            name: "Docked",
            tree: leaf(["spectrum"]),
            panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
            panelOrder: ["spectrum"],
            panelControlsById: {},
            dock: { enabled: true, edge: "top" },
          },
        ],
        activeId: null,
        dirty: false,
      });
      const { result } = renderPresetHook({
        applyDockPreset,
        dockPresetUnavailableReason,
        onApplyError,
      });
      const before = result.current.workspace.state;

      let applied;
      await act(async () => {
        applied = await result.current.presets.apply("dock-file-blocked");
      });

      expect(applied).toBe(false);
      expect(dockPresetUnavailableReason).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
      expect(applyDockPreset).not.toHaveBeenCalled();
      expect(result.current.workspace.state).toBe(before);
      // A structured refusal, not a bare Error: the notice reads its message, and App Control will
      // read `code` rather than parsing English.
      const [error] = onApplyError.mock.calls[0];
      expect(error.code).toBe("fileModeActive");
      expect(error.operation).toBe("preset.apply");
      expect(error.reason).toBe("fileMode");
      expect(error.message).toBe("Preset needs Dock, which is unavailable in FILE mode.");
    });

    it("applies the rest of a dock preset when no reason refuses it", async () => {
      const applyDockPreset = vi.fn(async () => false);
      const onApplyError = vi.fn();
      presetsStore.patch({
        list: [
          {
            id: "dock-ok",
            name: "Docked",
            tree: leaf(["spectrum"]),
            panelsById: { spectrum: { id: "spectrum", moduleId: "spectrum" } },
            panelOrder: ["spectrum"],
            panelControlsById: {},
            dock: { enabled: true, edge: "top" },
          },
        ],
        activeId: null,
        dirty: false,
      });
      // A platform with no dock support reports no reason: the dock is dropped downstream and the
      // rest of the preset still lands.
      const { result } = renderPresetHook({
        applyDockPreset,
        dockPresetUnavailableReason: () => null,
        onApplyError,
      });

      await act(async () => {
        await result.current.presets.apply("dock-ok");
      });

      expect(onApplyError).not.toHaveBeenCalled();
      expect(applyDockPreset).toHaveBeenCalled();
      expect(result.current.workspace.state.tree).toEqual(leaf(["spectrum"]));
    });

    it("presets without a dock field apply as dock-disabled (backward compat)", async () => {
      const applyDockPreset = vi.fn(async () => {});
      const { result } = renderPresetHook({ applyDockPreset });
      let preset;
      await act(async () => {
        preset = await result.current.presets.save("Legacy");
      });
      // Strip the dock field to simulate a preset saved before dock existed.
      const raw = presetsStore.read();
      presetsStore.patch({
        list: raw.list.map((p) => {
          const { dock: _dock, ...rest } = p;
          return rest;
        }),
      });
      await act(async () => {
        await result.current.presets.apply(preset.id);
      });
      expect(applyDockPreset).toHaveBeenCalledWith(
        {
          enabled: false,
          edge: "bottom",
          monitor: null,
          reserveSpace: false,
          height: undefined,
          panelsById: undefined,
          panelOrder: undefined,
          panelSizesById: undefined,
          controlsByPanelId: undefined,
        },
        expect.objectContaining({ bounds: preset.windowBounds })
      );
    });

    it("returns false and clears activeId when applyDockPreset rejects", async () => {
      const applyDockPreset = vi.fn(async () => {
        throw new Error("dock enter failed");
      });
      const onApplyError = vi.fn();
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
        activeId: "p1",
        dirty: false,
      });
      const { result } = renderPresetHook({ applyDockPreset, onApplyError });
      let applied;
      await act(async () => {
        applied = await result.current.presets.apply("p1");
      });
      expect(applied).toBe(false);
      expect(presetsStore.read().activeId).toBeNull();
      expect(onApplyError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "dock enter failed" })
      );
    });

    it("captures and applies Dock controls through the dock field", async () => {
      const applyDockPreset = vi.fn(async () => {});
      const dock = {
        enabled: true,
        edge: "top",
        monitor: "\\\\.\\DISPLAY2",
        reserveSpace: true,
        panelsById: { stats: { id: "stats", moduleId: "stats" } },
        panelOrder: ["stats"],
        controlsByPanelId: {
          stats: {
            statsVisibleIds: ["psr", "plr"],
            statsOrder: ["plr", "psr"],
          },
        },
      };
      const { result } = renderPresetHook({ dock, applyDockPreset });
      let preset;
      await act(async () => {
        preset = await result.current.presets.save("Stats dock");
      });
      expect(preset.dock.controlsByPanelId.stats).toEqual({
        statsVisibleIds: ["psr", "plr"],
        statsOrder: ["plr", "psr"],
      });
      await act(async () => {
        await result.current.presets.apply(preset.id);
      });
      expect(applyDockPreset).toHaveBeenCalledWith(
        expect.objectContaining({
          reserveSpace: true,
          monitor: "\\\\.\\DISPLAY2",
          controlsByPanelId: expect.objectContaining({
            stats: {
              statsVisibleIds: ["psr", "plr"],
              statsOrder: ["plr", "psr"],
            },
          }),
        }),
        expect.objectContaining({ bounds: preset.windowBounds })
      );
    });

    it("applies dock presets without legacy module fields", async () => {
      const applyDockPreset = vi.fn(async () => {});
      const dock = {
        enabled: true,
        monitor: "\\\\.\\DISPLAY2",
        panelsById: { loudness: { id: "loudness", moduleId: "loudness" } },
        panelOrder: ["loudness"],
        controlsByPanelId: { loudness: { metric: "integrated" } },
      };
      const { result } = renderPresetHook({ dock, applyDockPreset });
      let preset;
      await act(async () => {
        preset = await result.current.presets.save("Dock");
      });
      await act(async () => {
        await result.current.presets.apply(preset.id);
      });
      expect(applyDockPreset).toHaveBeenCalledWith(
        expect.not.objectContaining({
          modules: expect.anything(),
          controlsByModuleId: expect.anything(),
          statsIds: expect.anything(),
        }),
        expect.objectContaining({ bounds: preset.windowBounds })
      );
    });
  });
});

describe("usePresets Loudness Profile snapshot", () => {
  beforeEach(() => {
    localStorage.clear();
    settingsStore.reset();
    settingsStore.patch({ loudnessProfiles: { active: "off", profiles: [] } });
  });

  it("restores the profile that was active when the preset was saved", async () => {
    settingsStore.patch({
      loudnessProfiles: { active: "off", profiles: [TEST_PROFILE] },
    });
    const { result } = renderPresetsWithProfile();
    act(() => result.current.profile.select(profileSelectionId(TEST_PROFILE.id)));
    await act(async () => {
      await result.current.presets.save("Test");
    });
    const savedId = presetsStore.read().list[0].id;

    act(() => result.current.profile.selectOff());
    await act(async () => {
      await result.current.presets.apply(savedId);
    });

    expect(result.current.profile.referenceLufs).toBe(-23);
  });

  /// Saves one profile through the editor path, which is the only way into the library.
  function saveProfile(result, name) {
    act(() => result.current.profile.beginCreate());
    act(() => result.current.profile.editDraft((d) => ({ ...d, name })));
    act(() => result.current.profile.saveDraft());
  }

  it("stores the active selection but never the library", async () => {
    const { result } = renderPresetsWithProfile();
    saveProfile(result, "Mine");
    await act(async () => {
      await result.current.presets.save("WithLibrary");
    });

    const saved = presetsStore.read().list[0];
    expect(saved.loudnessProfileActive).toBeTruthy();
    expect(saved).not.toHaveProperty("profiles");
  });

  it("round-trips a user profile", async () => {
    const { result } = renderPresetsWithProfile();
    saveProfile(result, "Mine");
    const { id } = result.current.profile.profiles[0];
    act(() => result.current.profile.beginEdit(id));
    act(() => result.current.profile.editDraft((d) => ({ ...d, referenceLufs: -18 })));
    act(() => result.current.profile.saveDraft());
    await act(async () => {
      await result.current.presets.save("Draft");
    });
    const savedId = presetsStore.read().list[0].id;

    act(() => result.current.profile.selectOff());
    await act(async () => {
      await result.current.presets.apply(savedId);
    });

    expect(result.current.profile.referenceLufs).toBe(-18);
  });

  it("falls back to Off when the preset names a profile that has been deleted", async () => {
    const { result } = renderPresetsWithProfile();
    saveProfile(result, "Temporary");
    await act(async () => {
      await result.current.presets.save("Doomed");
    });
    const savedId = presetsStore.read().list[0].id;

    act(() => result.current.profile.removeProfile(result.current.profile.profiles[0].id));
    await act(async () => {
      await result.current.presets.apply(savedId);
    });

    // Off, and crucially the library is left alone rather than resurrected.
    expect(result.current.profile.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.current.profile.profiles).toEqual([]);
  });
});

/// The scene guard. Apply replaces the scene, Save and Update capture it, so all three are refused
/// while a draft-style editor is open -- open, not dirty. Refused here rather than in the popover
/// so the dock, the tray and App Control get the same answer.
describe("usePresets under an active blocking editor", () => {
  beforeEach(() => {
    localStorage.clear();
    // Preset ids are minted from Date.now(), so two saves in the same millisecond would collide
    // and a delete would take both.
    let now = 1000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1));
    mocks.isTauri.mockReset().mockReturnValue(true);
    mocks.applyWindowBounds.mockReset().mockResolvedValue(undefined);
    mocks.currentWindowBounds.mockReset().mockResolvedValue({
      x: 10,
      y: 20,
      width: 800,
      height: 600,
      isMaximized: false,
    });
    mocks.isDecorated.mockReset().mockResolvedValue(true);
    mocks.setDecorations.mockReset().mockResolvedValue(undefined);
    mocks.onWindowBoundsChanged.mockReset().mockImplementation(async () => () => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function guardWrapper({ children }) {
    return (
      <BlockingEditorsProvider>
        <WorkspaceProvider>
          <LoudnessProfileProvider>{children}</LoudnessProfileProvider>
        </WorkspaceProvider>
      </BlockingEditorsProvider>
    );
  }

  /// The real registry, driven the way an editor drives it. `spies` stands in for every scene
  /// mutation usePresets performs, so "refused before mutation" can be asserted as "none of these
  /// ran" rather than by reading the outcome back.
  function renderGuardedPresets() {
    const spies = {
      setWindowPinned: vi.fn(),
      setFocusView: vi.fn(),
      setPanelOpacity: vi.fn(),
      setGlassEnabled: vi.fn(),
      applyDockPreset: vi.fn(async () => false),
      applyLoudnessProfileSnapshot: vi.fn(),
    };
    let setEditorOpen;
    const view = renderHook(
      () => {
        const [open, setOpen] = useState(false);
        setEditorOpen = setOpen;
        useBlockingEditor("loudnessProfile", open);
        const { activeBlockingEditors, assertSceneOperationAllowed } = useBlockingEditors();
        return {
          workspace: useWorkspaceStore(),
          presets: usePresets({
            ...spies,
            assertSceneOperationAllowed,
            blockingEditors: activeBlockingEditors,
          }),
        };
      },
      { wrapper: guardWrapper }
    );
    return {
      ...view,
      spies,
      openEditor: () => act(() => setEditorOpen(true)),
      closeEditor: () => act(() => setEditorOpen(false)),
    };
  }

  async function refusal(call) {
    let thrown = null;
    await act(async () => {
      try {
        await call();
      } catch (error) {
        thrown = error;
      }
    });
    return thrown;
  }

  it("refuses apply before touching the workspace, the dock, the window or the profile", async () => {
    const view = renderGuardedPresets();
    await act(async () => {
      await view.result.current.presets.save("Saved");
    });
    const savedId = presetsStore.read().list[0].id;
    // Move the live scene away from the preset so a partial apply would be visible.
    act(() => view.result.current.workspace.setTree(leaf(["loudness"])));
    const before = presetsStore.read();

    view.openEditor();
    const thrown = await refusal(() => view.result.current.presets.apply(savedId));

    expect(thrown?.code).toBe("editorActive");
    expect(thrown?.operation).toBe("preset.apply");
    expect(thrown?.editors).toEqual(["loudnessProfile"]);
    expect(view.result.current.workspace.state.tree).toEqual(leaf(["loudness"]));
    expect(view.spies.applyDockPreset).not.toHaveBeenCalled();
    expect(view.spies.setFocusView).not.toHaveBeenCalled();
    expect(view.spies.setWindowPinned).not.toHaveBeenCalled();
    expect(view.spies.setPanelOpacity).not.toHaveBeenCalled();
    expect(view.spies.setGlassEnabled).not.toHaveBeenCalled();
    expect(view.spies.applyLoudnessProfileSnapshot).not.toHaveBeenCalled();
    expect(mocks.applyWindowBounds).not.toHaveBeenCalled();
    expect(mocks.setDecorations).not.toHaveBeenCalled();
    expect(presetsStore.read()).toEqual(before);
  });

  it("refuses save and update without writing to the library", async () => {
    const view = renderGuardedPresets();
    await act(async () => {
      await view.result.current.presets.save("Saved");
    });
    const savedId = presetsStore.read().list[0].id;
    const before = presetsStore.read();

    view.openEditor();
    const save = await refusal(() => view.result.current.presets.save("Second"));
    const update = await refusal(() => view.result.current.presets.update(savedId));

    expect(save?.operation).toBe("preset.save");
    expect(update?.operation).toBe("preset.update");
    // Capture is the risk here: what the editor previews is not what a snapshot would record.
    expect(presetsStore.read()).toEqual(before);
  });

  it("refuses even when the editor has no unsaved edits", async () => {
    const view = renderGuardedPresets();
    await act(async () => {
      await view.result.current.presets.save("Saved");
    });
    const savedId = presetsStore.read().list[0].id;

    // No edit was made; the editor is merely open. Dirty is invisible to the user and flips
    // mid-interaction, so the rule keys on open.
    view.openEditor();
    expect(view.result.current.presets.blocked).toBe(true);
    expect((await refusal(() => view.result.current.presets.apply(savedId)))?.code).toBe(
      "editorActive"
    );
  });

  it("still allows the library actions that neither read nor replace the scene", async () => {
    const view = renderGuardedPresets();
    await act(async () => {
      await view.result.current.presets.save("First");
    });
    await act(async () => {
      await view.result.current.presets.save("Second");
    });
    const [first, second] = presetsStore.read().list.map((preset) => preset.id);

    view.openEditor();
    act(() => view.result.current.presets.rename(first, "Renamed"));
    act(() => view.result.current.presets.reorder([second, first]));
    act(() => view.result.current.presets.remove(second));

    expect(presetsStore.read().list.map((preset) => preset.name)).toEqual(["Renamed"]);
  });

  it("allows the refused operation again once the editor closes", async () => {
    const view = renderGuardedPresets();
    await act(async () => {
      await view.result.current.presets.save("Saved");
    });
    const savedId = presetsStore.read().list[0].id;
    act(() => view.result.current.workspace.setTree(leaf(["loudness"])));

    view.openEditor();
    expect((await refusal(() => view.result.current.presets.apply(savedId)))?.code).toBe(
      "editorActive"
    );
    view.closeEditor();
    expect(view.result.current.presets.blocked).toBe(false);
    await act(async () => {
      await view.result.current.presets.apply(savedId);
    });

    expect(view.spies.applyDockPreset).toHaveBeenCalled();
    expect(view.result.current.presets.activeId).toBe(savedId);
  });
});
