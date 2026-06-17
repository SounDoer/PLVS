import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";
import { settingsStore } from "../persistence/index.js";

export function useAlwaysOnTop() {
  const [pinned, setPinned] = useState(() => {
    return settingsStore.read().windowPinned === true;
  });

  useEffect(() => {
    if (!isTauri()) return;
    getCurrentWindow().setAlwaysOnTop(pinned);
  }, [pinned]);

  function togglePin() {
    const next = !pinned;
    settingsStore.patch({ windowPinned: next });
    setPinned(next);
  }

  return { pinned, togglePin };
}
