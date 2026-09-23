import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";

const KEY = "openAtLogin";

function transactionalBoot() {
  return typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.multiInstancePersistence;
}

function bootPreference() {
  const value = window.__PLVS_INITIAL_STATE__?.globalPreferences?.[KEY];
  return typeof value === "boolean" ? value : null;
}

async function savePreference(enabled) {
  if (!transactionalBoot()) return;
  const initial = window.__PLVS_INITIAL_STATE__;
  const expectedRevision = initial.multiInstancePersistence.globalPreferenceRevisions?.[KEY] ?? 0;
  const revisions = await invoke("persistence_save_global_preferences", {
    values: { [KEY]: enabled },
    expectedRevisions: { [KEY]: expectedRevision },
  });
  initial.globalPreferences = { ...(initial.globalPreferences || {}), [KEY]: enabled };
  initial.multiInstancePersistence.globalPreferenceRevisions = {
    ...(initial.multiInstancePersistence.globalPreferenceRevisions || {}),
    ...revisions,
  };
}

async function applyNativePreference(enabled) {
  const current = await invoke("plugin:autostart|is_enabled");
  if (current !== enabled) {
    await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
  }
}

export function useAutostart() {
  const isCoordinator = useCoordinatorRole();
  const [autostartEnabled, setAutostartEnabledState] = useState(() => bootPreference() ?? false);
  const [autostartReady, setAutostartReady] = useState(
    () => isTauri() && (bootPreference() !== null || !isCoordinator)
  );

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const shared = bootPreference();
    if (shared !== null) {
      if (isCoordinator) {
        applyNativePreference(shared).catch(() => {
          if (!cancelled) setAutostartReady(false);
        });
      }
      return () => {
        cancelled = true;
      };
    }
    if (!isCoordinator) {
      return () => {
        cancelled = true;
      };
    }
    invoke("plugin:autostart|is_enabled")
      .then(async (enabled) => {
        if (cancelled) return;
        setAutostartEnabledState(enabled);
        setAutostartReady(true);
        await savePreference(enabled);
      })
      .catch(() => {
        if (!cancelled) setAutostartReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isCoordinator]);

  useEffect(() => {
    const sync = () => {
      const shared = bootPreference();
      if (shared === null) return;
      setAutostartEnabledState(shared);
      setAutostartReady(true);
      if (isCoordinator) void applyNativePreference(shared);
    };
    window.addEventListener("plvs-global-preferences-changed", sync);
    return () => window.removeEventListener("plvs-global-preferences-changed", sync);
  }, [isCoordinator]);

  const setAutostartEnabledForControl = useCallback(
    async (enabled) => {
      if (!isTauri() || !autostartReady) throw new Error("Autostart is unavailable.");
      if (isCoordinator) await applyNativePreference(enabled);
      await savePreference(enabled);
      setAutostartEnabledState(enabled);
    },
    [autostartReady, isCoordinator]
  );

  const setAutostartEnabled = useCallback(
    async (enabled) => {
      try {
        await setAutostartEnabledForControl(enabled);
      } catch (_) {}
    },
    [setAutostartEnabledForControl]
  );

  return {
    autostartEnabled,
    setAutostartEnabled,
    setAutostartEnabledForControl,
    autostartReady,
  };
}
