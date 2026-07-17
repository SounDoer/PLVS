import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyWindowBounds, currentWindowBounds } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { onWindowBoundsChanged } from "../ipc/events.js";
import { setWindowDecorations } from "./useFocusViewWindow.js";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";
import { normalizePanelControlsById } from "../workspace/panelControlInstances.js";
import { normalizePinnedPanelsById } from "../workspace/reducer.js";
import { presetsStore, settingsStore } from "../persistence/index.js";
import { normalizeReferenceLufs } from "../settings/defaults.js";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";

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

function normalizePresetPanelControls(preset, currentWorkspaceState) {
  const rawControls = preset.panelControlsById ?? {};
  const normalized = normalizePanelControlsById(preset.panelsById, rawControls);
  const legacyReferenceLufs = normalizeReferenceLufs(settingsStore.read().referenceLufs);
  for (const [id, panel] of Object.entries(preset.panelsById ?? {})) {
    if (panel?.moduleId !== "loudness") continue;
    if (rawControls?.[id]?.loudnessReferenceLufs != null) continue;
    const currentReference =
      currentWorkspaceState.panelControlsById?.[id]?.loudnessReferenceLufs ?? legacyReferenceLufs;
    normalized[id] = {
      ...normalized[id],
      loudnessReferenceLufs: normalizeReferenceLufs(currentReference),
    };
  }
  return normalized;
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
  canApplyDockPreset = () => true,
  onApplyError = () => {},
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
    };
    return windowBounds ? { ...snapshot, windowBounds } : snapshot;
  }, [
    windowPinned,
    focusView,
    panelOpacity,
    glassEnabled,
    dock,
    workspaceState.panelControlsById,
    workspaceState.panelOrder,
    workspaceState.panelsById,
    workspaceState.pinnedPanelsById,
    workspaceState.tree,
  ]);

  const save = useCallback(
    async (name) => {
      const trimmed = String(name ?? "").trim();
      if (!trimmed) return null;
      const snapshot = await captureSnapshot();
      const preset = {
        id: `preset-${Date.now()}`,
        name: trimmed,
        ...snapshot,
      };
      const current = normalizePresets(presetsStore.read());
      write({ list: [...current.list, preset], activeId: preset.id, dirty: false });
      return preset;
    },
    [captureSnapshot, write]
  );

  const apply = useCallback(
    async (id) => {
      const current = normalizePresets(presetsStore.read());
      const preset = current.list.find((p) => p.id === id);
      if (!preset) return false;
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
      if (presetDock.enabled && !canApplyDockPreset(presetDock)) {
        const error = new Error("Dock presets are unavailable in FILE mode");
        onApplyError(error);
        return false;
      }
      if (preset.windowBounds && isTauri()) {
        suppressPresetDivergence();
      }
      setView({
        tree: clone(preset.tree),
        panelsById: clone(preset.panelsById),
        panelOrder: [...preset.panelOrder],
        panelControlsById: normalizePresetPanelControls(preset, workspaceState),
        pinnedPanelsById: normalizePinnedPanelsById(preset.panelsById, preset.pinnedPanelsById),
      });
      const presetFocusView = preset.focusView ? normalizeFocusView(preset.focusView) : null;
      let windowBoundsAppliedByDockExit;
      try {
        windowBoundsAppliedByDockExit = await applyDockPreset(presetDock, {
          bounds: preset.windowBounds,
          focusView: presetFocusView ?? undefined,
          pinned: preset.windowPinned,
        });
      } catch (error) {
        write({ activeId: null });
        onApplyError(error);
        return false;
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
          write({ activeId: null });
          onApplyError(error);
          return false;
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
      canApplyDockPreset,
      onApplyError,
      suppressPresetDivergence,
      workspaceState,
      write,
    ]
  );

  const update = useCallback(
    async (id) => {
      const current = normalizePresets(presetsStore.read());
      const existing = current.list.find((p) => p.id === id);
      if (!existing) return null;
      const snapshot = await captureSnapshot();
      const updated = { id, name: existing.name, ...snapshot };
      write({
        list: current.list.map((p) => (p.id === id ? updated : p)),
        activeId: id,
        dirty: false,
      });
      return updated;
    },
    [captureSnapshot, write]
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
      });
    },
    [write]
  );

  return useMemo(
    () => ({
      list: presets.list,
      activeId: presets.activeId,
      dirty: presets.dirty,
      save,
      apply,
      update,
      rename,
      remove,
      clearActive,
      markDirty,
    }),
    [
      apply,
      clearActive,
      markDirty,
      presets.activeId,
      presets.dirty,
      presets.list,
      remove,
      rename,
      save,
      update,
    ]
  );
}
