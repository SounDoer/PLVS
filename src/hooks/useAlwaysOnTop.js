import { useCallback, useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";
import { presetsStore, settingsStore } from "../persistence/index.js";

export function useAlwaysOnTop() {
  const [pinned, setPinned] = useState(() => {
    return settingsStore.read().windowPinned === true;
  });

  useEffect(() => {
    if (!isTauri()) return;
    getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned]);

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
