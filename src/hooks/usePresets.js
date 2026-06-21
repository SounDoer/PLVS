import { useCallback, useEffect, useMemo, useState } from "react";
import { applyWindowBounds, currentWindowBounds } from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { DEFAULT_FOCUS_VIEW, normalizeFocusView } from "../lib/focusView.js";
import { hasKnownModulesOnly } from "../workspace/panelInstances.js";
import { normalizePanelControlsById } from "../workspace/panelControlInstances.js";
import { presetsStore } from "../persistence/index.js";
import { useWorkspaceStore } from "../workspace/WorkspaceContext.jsx";

const EMPTY_PRESETS = { list: [], activeId: null };

function clone(value) {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

function normalizePresets(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return EMPTY_PRESETS;
  const list = (Array.isArray(raw.list) ? raw.list : []).filter(hasKnownModulesOnly);
  const rawActiveId = typeof raw.activeId === "string" ? raw.activeId : null;
  const activeId = list.some((preset) => preset.id === rawActiveId) ? rawActiveId : null;
  return { list, activeId };
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
} = {}) {
  const { state: workspaceState, setView } = useWorkspaceStore();
  const [presets, setPresets] = useState(() => normalizePresets(presetsStore.read()));

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
      windowPinned: windowPinned === true,
      focusView: normalizeFocusView(focusView),
    };
    return windowBounds ? { ...snapshot, windowBounds } : snapshot;
  }, [
    windowPinned,
    focusView,
    workspaceState.panelControlsById,
    workspaceState.panelOrder,
    workspaceState.panelsById,
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
      write({ list: [...current.list, preset], activeId: preset.id });
      return preset;
    },
    [captureSnapshot, write]
  );

  const apply = useCallback(
    async (id) => {
      const current = normalizePresets(presetsStore.read());
      const preset = current.list.find((p) => p.id === id);
      if (!preset) return false;
      setView({
        tree: clone(preset.tree),
        panelsById: clone(preset.panelsById),
        panelOrder: [...preset.panelOrder],
        panelControlsById: normalizePanelControlsById(preset.panelsById, preset.panelControlsById),
      });
      if (preset.windowBounds && isTauri()) {
        try {
          await applyWindowBounds(preset.windowBounds);
        } catch (_) {
          write({ activeId: null });
          return false;
        }
      }
      if (typeof preset.windowPinned === "boolean") {
        setWindowPinned(preset.windowPinned);
      }
      if (preset.focusView) {
        setFocusView(normalizeFocusView(preset.focusView));
      }
      write({ activeId: id });
      return true;
    },
    [setView, setWindowPinned, setFocusView, write]
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
      save,
      apply,
      update,
      rename,
      remove,
    }),
    [apply, presets.activeId, presets.list, remove, rename, save, update]
  );
}
