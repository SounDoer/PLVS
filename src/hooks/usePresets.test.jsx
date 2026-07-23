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

import { usePresets } from "./usePresets.js";
import { LoudnessProfileProvider, useLoudnessProfile } from "./LoudnessProfileContext.jsx";
import { settingsStore } from "../persistence/index.js";
import { LOUDNESS_PROFILE_OFF, builtinSelectionId } from "../lib/loudnessProfileCatalog.js";

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
      const canApplyDockPreset = vi.fn(() => false);
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
        canApplyDockPreset,
        onApplyError,
      });
      const before = result.current.workspace.state;

      let applied;
      await act(async () => {
        applied = await result.current.presets.apply("dock-file-blocked");
      });

      expect(applied).toBe(false);
      expect(canApplyDockPreset).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }));
      expect(applyDockPreset).not.toHaveBeenCalled();
      expect(result.current.workspace.state).toBe(before);
      expect(onApplyError).toHaveBeenCalledWith(
        expect.objectContaining({ message: "Dock presets are unavailable in FILE mode" })
      );
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
  });

  it("restores the built-in that was active when the preset was saved", async () => {
    const { result } = renderPresetsWithProfile();
    act(() => result.current.profile.select(builtinSelectionId("streaming-14")));
    await act(async () => {
      await result.current.presets.save("Streaming");
    });
    const savedId = presetsStore.read().list[0].id;

    act(() => result.current.profile.selectOff());
    await act(async () => {
      await result.current.presets.apply(savedId);
    });

    expect(result.current.profile.referenceLufs).toBe(-14);
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
    expect(saved).not.toHaveProperty("userProfiles");
  });

  it("round-trips a user profile", async () => {
    const { result } = renderPresetsWithProfile();
    saveProfile(result, "Mine");
    const { id } = result.current.profile.userProfiles[0];
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

    act(() => result.current.profile.removeUser(result.current.profile.userProfiles[0].id));
    await act(async () => {
      await result.current.presets.apply(savedId);
    });

    // Off, and crucially the library is left alone rather than resurrected.
    expect(result.current.profile.active).toBe(LOUDNESS_PROFILE_OFF);
    expect(result.current.profile.userProfiles).toEqual([]);
  });
});
