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

async function setWindowShadow(enabled) {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  if (typeof win.setShadow === "function") {
    await win.setShadow(enabled);
  }
}

export function useFocusViewWindow(autoHideControls) {
  useEffect(() => {
    const frameless = autoHideControls === true;
    void setWindowDecorations(!frameless).catch(() => {});
    void setWindowShadow(!frameless).catch(() => {});
  }, [autoHideControls]);
}
