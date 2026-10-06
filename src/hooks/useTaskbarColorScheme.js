import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "../ipc/env.js";

const asScheme = (/** @type {string} */ value) =>
  value === "light" || value === "dark" ? value : null;

/**
 * The light/dark mode of the Windows taskbar, which the tray icon sits on. It follows
 * `SystemUsesLightTheme`, not the app mode or the PLVS theme. `null` when disabled, outside
 * Tauri, or on a platform where the backend reports no such surface.
 */
export function useTaskbarColorScheme(enabled) {
  const [scheme, setScheme] = useState(null);

  useEffect(() => {
    if (!enabled || !isTauri()) return undefined;
    let cancelled = false;
    let unlisten = null;
    // Subscribe before reading so a change between the two is not lost.
    listen("taskbar-color-scheme-changed", (event) => {
      if (!cancelled) setScheme(asScheme(event.payload));
    })
      .then((stop) => {
        if (cancelled) stop();
        else unlisten = stop;
        return invoke("taskbar_color_scheme");
      })
      .then((value) => {
        if (!cancelled) setScheme(asScheme(value));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [enabled]);

  // A stale value from before disabling must not outlive the subscription.
  return enabled ? scheme : null;
}
