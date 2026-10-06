import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../ipc/env.js";

/**
 * Applies the stored always-on-top preference to the window. The value itself is a setting; see
 * `useWindowPinnedSetting`.
 *
 * @param {boolean} pinned
 * @param {{ suspended?: boolean }} [options]
 */
export function useAlwaysOnTop(pinned, { suspended = false } = {}) {
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
}
