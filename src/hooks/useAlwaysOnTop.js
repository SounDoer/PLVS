import { useState, useEffect } from "react";
import { getCurrent } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

const STORAGE_KEY = "plvs:windowPinned";

export function useAlwaysOnTop() {
  const [pinned, setPinned] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) === "true";
  });

  useEffect(() => {
    if (!isTauri()) return;
    getCurrent().setAlwaysOnTop(pinned);
  }, [pinned]);

  function togglePin() {
    const next = !pinned;
    localStorage.setItem(STORAGE_KEY, String(next));
    setPinned(next);
  }

  return { pinned, togglePin };
}
