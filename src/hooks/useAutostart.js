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

  async function setAutostartEnabledForControl(enabled) {
    if (!isTauri() || !autostartReady) throw new Error("Autostart is unavailable.");
    await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
    setAutostartEnabledState(enabled);
  }

  async function setAutostartEnabled(enabled) {
    try {
      await setAutostartEnabledForControl(enabled);
    } catch (_) {}
  }

  return {
    autostartEnabled,
    setAutostartEnabled,
    setAutostartEnabledForControl,
    autostartReady,
  };
}
