import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";

export function useAutostart() {
  const [autostartEnabled, setAutostartEnabledState] = useState(false);
  const [autostartReady, setAutostartReady] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;
    invoke("plugin:autostart|is_enabled")
      .then((enabled) => {
        setAutostartEnabledState(enabled);
        setAutostartReady(true);
      })
      .catch(() => {
        setAutostartReady(false);
      });
  }, []);

  async function setAutostartEnabled(enabled) {
    if (!isTauri()) return;
    try {
      await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
      setAutostartEnabledState(enabled);
    } catch (_) {}
  }

  return { autostartEnabled, setAutostartEnabled, autostartReady };
}
