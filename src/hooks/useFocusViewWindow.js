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

export function useFocusViewWindow(autoHideControls, borderless, { suspended = false } = {}) {
  useEffect(() => {
    // Rust applies the Dock shell before the webview mounts, but native-state
    // reconciliation can arrive after an initial normal-form render. Re-assert
    // frameless chrome when suspended so that transient render cannot leave a
    // title bar consuming the entire Dock strip.
    const frameless = suspended || autoHideControls === true || borderless === true;
    void setWindowDecorations(!frameless).catch(() => {});
    void setWindowShadow(!frameless).catch(() => {});
  }, [autoHideControls, borderless, suspended]);
}
