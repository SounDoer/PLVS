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

export function useFocusViewWindow(autoHideControls, borderless, { suspended = false } = {}) {
  useEffect(() => {
    // While docked (suspended), Rust owns window chrome: apply_dock_form strips
    // decorations/shadow, and this mount effect must not re-decorate the strip
    // (boot-into-dock would otherwise get a title bar). `suspended` stays in the
    // deps so flipping it false on exit re-asserts the user's true attributes —
    // a harmless double-set with exitDock's own restore.
    if (suspended) return;
    // Decorations only. The shadow is Rust-owned: a normal window always keeps it
    // (Tauri's default, restored by exit_dock), the docked strip never has it.
    // Driving it from `frameless` here contradicted that and left the shadow
    // dependent on which side ran last — and since the stored geometry pairs an
    // outer position with an inner size, a shadow that disagrees with the one at
    // save time drifts the window by a frame.
    const frameless = autoHideControls === true || borderless === true;
    void setWindowDecorations(!frameless).catch(() => {});
  }, [autoHideControls, borderless, suspended]);
}
