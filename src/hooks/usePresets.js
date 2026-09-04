import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyWindowBounds, currentWindowBounds } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { onWindowBoundsChanged } from "../ipc/events.js";
import { setWindowDecorations } from "./useFocusViewWindow.js";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";
import { normalizePanelControlsById } from "../workspace/panelControlInstances.js";
import { normalizePinnedPanelsById } from "../workspace/reducer.js";
import { presetWorkspaceView } from "../lib/presetWorkspaceView.js";
import { presetsStore } from "../persistence/index.js";
import { SCENE_OPERATIONS, SceneOperationUnavailableError } from "../lib/sceneOperations.js";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";
import { normalizeAxisViewportsState } from "../workspace/axisViewports.js";

const EMPTY_PRESETS = { list: [], activeId: null, dirty: false };

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizePresets(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PRESETS;
  const list = (Array.isArray(raw.list) ? raw.list : []).filter(hasKnownModulesOnly);
  const rawActiveId = typeof raw.activeId === "string" ? raw.activeId : null;
  const activeId = list.some((preset) => preset.id === rawActiveId) ? rawActiveId : null;
  const dirty = activeId !== null && raw.dirty === true;
  return { list, activeId, dirty };
}

async function readWindowBounds() {
  if (!isTauri()) return undefined;
  try {
    return await currentWindowBounds();
  } catch (_) {
    return undefined;
  }
}

export function usePresets({
  windowPinned = false,
  setWindowPinned = () => {},
  focusView = DEFAULT_FOCUS_VIEW,
  setFocusView = () => {},
  panelOpacity = 100,
  setPanelOpacity = () => {},
  glassEnabled = false,
  setGlassEnabled = () => {},
  dock = {
    enabled: false,
    edge: "bottom",
    monitor: null,
    reserveSpace: false,
    height: 72,
    panelsById: {},
    panelOrder: [],
    panelSizesById: {},
    controlsByPanelId: undefined,
  },
  applyDockPreset = async () => {},
  // Returns the reason the preset's dock cannot be honoured, or null. A reason refuses the whole
  // apply before anything moves; a platform that simply has no dock is not one -- `applyDockPreset`
  // drops the dock and applies the rest.
  dockPresetUnavailableReason = () => null,
  onApplyError = () => {},
  // Which Loudness Profile was active, never the library itself -- the same way a view snapshot
  // records the active theme rather than every theme.
  snapshotLoudnessProfile = () => ({}),
  applyLoudnessProfileSnapshot = () => {},
  // Apply, Save and Update are scene operations: the first replaces the scene, the other two
  // capture it. All three are refused while a draft-style editor is open, and refused here rather
  // than in the popover so the dock, the tray and App Control get the same answer. Throws a
  // SceneOperationBlockedError; see `lib/sceneOperations.js`.
  assertSceneOperationAllowed = () => {},
  blockingEditors = [],
} = {}) {
  const { state: workspaceState, setView } = useWorkspaceStore();
  const [presets, setPresets] = useState(() => normalizePresets(presetsStore.read()));
  const suppressPresetDivergenceUntilRef = useRef(0);

  useEffect(
    () =>
      presetsStore.subscribe(() => {
        setPresets(normalizePresets(presetsStore.read()));
      }),
    []
  );

  const write = useCallback((next) => {
    presetsStore.patch(next);
    setPresets(normalizePresets(presetsStore.read()));
  }, []);

  const clearActive = useCallback(() => {
    write({ activeId: null, dirty: false });
  }, [write]);

  const markDirty = useCallback(() => {
    write({ dirty: true });
  }, [write]);
  const suppressPresetDivergence = useCallback((durationMs = 1500) => {
    suppressPresetDivergenceUntilRef.current = Date.now() + durationMs;
  }, []);

  useEffect(() => {
    suppressPresetDivergence();
  }, [suppressPresetDivergence]);

  useEffect(() => {
    if (!isTauri()) return undefined;
    let disposed = false;
    let unlisten = null;
    onWindowBoundsChanged(() => {
      if (Date.now() < suppressPresetDivergenceUntilRef.current) return;
      markDirty();
    }).then((fn) => {
      if (disposed) {
        fn();
      } else {
        unlisten = fn;
      }
    });
    return () => {
      disposed = true;
      if (unlisten) unlisten();
    };
  }, [markDirty]);

  const captureSnapshot = useCallback(async () => {
    const windowBounds = await readWindowBounds();
    const snapshot = {
      tree: clone(workspaceState.tree),
      panelsById: clone(workspaceState.panelsById),
      panelOrder: [...workspaceState.panelOrder],
      panelControlsById: normalizePanelControlsById(
        workspaceState.panelsById,
        workspaceState.panelControlsById
      ),
      pinnedPanelsById: normalizePinnedPanelsById(
        workspaceState.panelsById,
        workspaceState.pinnedPanelsById
      ),
      axisViewports: normalizeAxisViewportsState(workspaceState.axisViewports),
      windowPinned: windowPinned === true,
      focusView: normalizeFocusView(focusView),
      panelOpacity,
      glassEnabled,
      dock: {
        enabled: dock.enabled === true,
        edge: dock.edge === "top" ? "top" : "bottom",
        monitor: typeof dock.monitor === "string" ? dock.monitor : null,
        reserveSpace: dock.reserveSpace === true,
        height: Number.isFinite(dock.height) ? dock.height : 72,
        panelsById: clone(dock.panelsById ?? {}),
        panelOrder: Array.isArray(dock.panelOrder) ? [...dock.panelOrder] : [],
        panelSizesById: clone(dock.panelSizesById ?? {}),
        controlsByPanelId: clone(dock.controlsByPanelId ?? {}),
      },
      ...snapshotLoudnessProfile(),
    };
    return windowBounds ? { ...snapshot, windowBounds } : snapshot;
  }, [
    snapshotLoudnessProfile,
    windowPinned,
    focusView,
    panelOpacity,
    glassEnabled,
    dock,
    workspaceState.axisViewports,
    workspaceState.panelControlsById,
    workspaceState.panelOrder,
    workspaceState.panelsById,
    workspaceState.pinnedPanelsById,
    workspaceState.tree,
  ]);

  const saveSnapshot = useCallback(
    (name, snapshot) => {
      const trimmed = String(name ?? "").trim();
      if (!trimmed) return null;
      const preset = {
        id: `preset-${Date.now()}`,
        name: trimmed,
        ...snapshot,
      };
      const current = normalizePresets(presetsStore.read());
      write({ list: [...current.list, preset], activeId: preset.id, dirty: false });
      return preset;
    },
    [write]
  );

  const save = useCallback(
    async (name) => {
      assertSceneOperationAllowed(SCENE_OPERATIONS.presetSave);
      const trimmed = String(name ?? "").trim();
      if (!trimmed) return null;
      const snapshot = await captureSnapshot();
      return saveSnapshot(trimmed, snapshot);
    },
    [assertSceneOperationAllowed, captureSnapshot, saveSnapshot]
  );

  const preflightApplySnapshot = useCallback(
    (id) => {
      const current = normalizePresets(presetsStore.read());
      const preset = current.list.find((p) => p.id === id);
      if (!preset) return null;
      const presetDock = {
        enabled: preset.dock?.enabled === true,
        edge: preset.dock?.edge === "top" ? "top" : "bottom",
        monitor: typeof preset.dock?.monitor === "string" ? preset.dock.monitor : null,
        reserveSpace: preset.dock?.reserveSpace === true,
        height: Number.isFinite(preset.dock?.height) ? preset.dock.height : undefined,
        panelsById: preset.dock?.panelsById,
        panelOrder: preset.dock?.panelOrder,
        panelSizesById: preset.dock?.panelSizesById,
        controlsByPanelId: preset.dock?.controlsByPanelId,
      };
      const dockUnavailableReason = presetDock.enabled
        ? dockPresetUnavailableReason(presetDock)
        : null;
      if (dockUnavailableReason) {
        throw new SceneOperationUnavailableError(
          SCENE_OPERATIONS.presetApply,
          dockUnavailableReason
        );
      }
      return { preset, presetDock };
    },
    [dockPresetUnavailableReason]
  );

  const applySnapshot = useCallback(
    async (id, { applyWorkspace = true } = {}) => {
      const preflight = preflightApplySnapshot(id);
      if (!preflight) return false;
      const { preset, presetDock } = preflight;
      if (preset.windowBounds && isTauri()) {
        suppressPresetDivergence();
      }
      if (applyWorkspace) {
        setView(presetWorkspaceView(preset));
      }
      const presetFocusView = preset.focusView ? normalizeFocusView(preset.focusView) : null;
      let windowBoundsAppliedByDockExit;
      try {
        windowBoundsAppliedByDockExit = await applyDockPreset(presetDock, {
          bounds: preset.windowBounds,
          focusView: presetFocusView ?? undefined,
          pinned: preset.windowPinned,
        });
      } catch (error) {
        write({ activeId: null, dirty: false });
        error.stage = "dock";
        throw error;
      }
      if (
        !presetDock.enabled &&
        preset.windowBounds &&
        !windowBoundsAppliedByDockExit &&
        isTauri()
      ) {
        try {
          // Chrome before geometry. windowBounds pairs an outer position with an
          // inner size, so the frame must already match the preset's when the
          // bounds land. setFocusView below only schedules the change — it runs in
          // useFocusViewWindow's effect, after this await chain — and Windows keeps
          // the outer rect when decorations drop, handing the title bar area back
          // to the client and growing the window by that much. The dock path
          // already gets this right by passing decorations into exit_dock.
          if (presetFocusView) {
            await setWindowDecorations(
              !(presetFocusView.autoHideControls || presetFocusView.borderless)
            );
          }
          await applyWindowBounds(preset.windowBounds);
        } catch (error) {
          write({ activeId: null, dirty: false });
          error.stage = "window";
          throw error;
        }
      }
      if (typeof preset.windowPinned === "boolean") {
        setWindowPinned(preset.windowPinned);
      }
      if (presetFocusView) {
        setFocusView(presetFocusView);
      }
      if (typeof preset.panelOpacity === "number") {
        setPanelOpacity(preset.panelOpacity);
      }
      if (typeof preset.glassEnabled === "boolean") {
        setGlassEnabled(preset.glassEnabled);
      }
      applyLoudnessProfileSnapshot(preset);
      write({ activeId: id, dirty: false });
      return true;
    },
    [
      setView,
      setWindowPinned,
      setFocusView,
      setPanelOpacity,
      setGlassEnabled,
      applyDockPreset,
      suppressPresetDivergence,
      applyLoudnessProfileSnapshot,
      preflightApplySnapshot,
      write,
    ]
  );

  const activateSnapshot = useCallback(
    (id) => {
      const current = normalizePresets(presetsStore.read());
      if (!current.list.some((preset) => preset.id === id)) return false;
      write({ activeId: id, dirty: false });
      return true;
    },
    [write]
  );

  const apply = useCallback(
    async (id) => {
      // Before `setView`, before the dock transition, before any window call: a refusal must not
      // leave half a preset applied.
      assertSceneOperationAllowed(SCENE_OPERATIONS.presetApply);
      try {
        return await applySnapshot(id);
      } catch (error) {
        onApplyError(error);
        return false;
      }
    },
    [applySnapshot, assertSceneOperationAllowed, onApplyError]
  );

  const updateSnapshot = useCallback(
    (id, snapshot) => {
      const current = normalizePresets(presetsStore.read());
      const existing = current.list.find((p) => p.id === id);
      if (!existing) return null;
      const updated = { id, name: existing.name, ...snapshot };
      write({
        list: current.list.map((p) => (p.id === id ? updated : p)),
        activeId: id,
        dirty: false,
      });
      return updated;
    },
    [write]
  );

  const update = useCallback(
    async (id) => {
      assertSceneOperationAllowed(SCENE_OPERATIONS.presetUpdate);
      const snapshot = await captureSnapshot();
      return updateSnapshot(id, snapshot);
    },
    [assertSceneOperationAllowed, captureSnapshot, updateSnapshot]
  );

  const rename = useCallback(
    (id, name) => {
      const trimmed = String(name ?? "").trim();
      if (!trimmed) return false;
      const current = normalizePresets(presetsStore.read());
      write({
        list: current.list.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
      });
      return true;
    },
    [write]
  );

  const remove = useCallback(
    (id) => {
      const current = normalizePresets(presetsStore.read());
      write({
        list: current.list.filter((p) => p.id !== id),
        activeId: current.activeId === id ? null : current.activeId,
        dirty: current.activeId === id ? false : current.dirty,
      });
    },
    [write]
  );

  const reorder = useCallback(
    (nextIds) => {
      const current = normalizePresets(presetsStore.read());
      const byId = new Map(current.list.map((p) => [p.id, p]));
      const reordered = nextIds.map((id) => byId.get(id)).filter(Boolean);
      if (reordered.length !== current.list.length) return;
      write({ list: reordered });
    },
    [write]
  );

  return useMemo(
    () => ({
      list: presets.list,
      activeId: presets.activeId,
      dirty: presets.dirty,
      // What the popover, the dock row and the tray grey out. The refusal above is the guard;
      // this only makes it legible.
      blocked: blockingEditors.length > 0,
      save,
      apply,
      update,
      rename,
      remove,
      reorder,
      clearActive,
      markDirty,
      captureSnapshot,
      assertSceneOperationAllowed,
      saveSnapshot,
      updateSnapshot,
      applySnapshot,
      activateSnapshot,
      preflightApplySnapshot,
    }),
    [
      apply,
      applySnapshot,
      activateSnapshot,
      assertSceneOperationAllowed,
      blockingEditors,
      captureSnapshot,
      clearActive,
      markDirty,
      preflightApplySnapshot,
      presets.activeId,
      presets.dirty,
      presets.list,
      remove,
      reorder,
      rename,
      save,
      saveSnapshot,
      update,
      updateSnapshot,
    ]
  );
}
