import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

export async function setWindowDecorations(enabled) {
  if (!isTauri()) return false;
  const win = getCurrentWindow();
  if (typeof win.setDecorations !== "function") return false;
  await win.setDecorations(enabled);
  return true;
}

export function useFocusViewWindow(autoHideControls) {
  useEffect(() => {
    void setWindowDecorations(autoHideControls !== true).catch(() => {});
  }, [autoHideControls]);
}
