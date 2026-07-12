import { useCallback, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";
import { presetsStore, settingsStore } from "../persistence/index.js";

export function useAlwaysOnTop({ suspended = false } = {}) {
  const [pinned, setPinned] = useState(() => {
    return settingsStore.read().windowPinned === true;
  });

  useEffect(() => {
    // While docked (suspended), Rust owns always-on-top: the strip is forced
    // topmost by apply_dock_form, and this effect must not undo that when the
    // stored pin is false (e.g. a preset apply flips windowPinned while
    // docked). `suspended` stays in the deps so flipping it false on exit
    // re-asserts the stored value — a harmless double-set with exitDock's own
    // restore.
    if (suspended) return;
    if (!isTauri()) return;
    getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned, suspended]);

  const setWindowPinned = useCallback((nextPinned) => {
    const next = nextPinned === true;
    settingsStore.patch({ windowPinned: next });
    presetsStore.patch({ dirty: true });
    setPinned(next);
  }, []);

  function togglePin() {
    setWindowPinned(!pinned);
  }

  return { pinned, setPinned: setWindowPinned, togglePin };
}
