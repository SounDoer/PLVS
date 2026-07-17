import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

export async function setWindowDecorations(enabled) {
  if (!isTauri()) return false;
  const win = getCurrentWindow();
  if (typeof win.setDecorations !== "function") return false;
  const current = typeof win.isDecorated === "function" ? await win.isDecorated() : null;
  if (current === enabled) return false;
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
    // While docked (suspended), Rust owns window chrome: apply_dock_form strips
    // decorations/shadow, and this mount effect must not re-decorate the strip
    // (boot-into-dock would otherwise get a title bar). `suspended` stays in the
    // deps so flipping it false on exit re-asserts the user's true attributes —
    // a harmless double-set with exitDock's own restore.
    if (suspended) return;
    const frameless = autoHideControls === true || borderless === true;
    void (async () => {
      const decorationsChanged = await setWindowDecorations(!frameless);
      if (decorationsChanged) await setWindowShadow(!frameless);
    })().catch(() => {});
  }, [autoHideControls, borderless, suspended]);
}
