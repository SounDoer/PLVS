import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";
import { ownsCoordinatorResources, useCoordinatorRole } from "../lib/runtimeRole.js";

const KEY = "openAtLogin";

function transactionalBoot() {
  return typeof window !== "undefined" && window.__PLVS_INITIAL_STATE__?.multiInstancePersistence;
}

function bootPreference() {
  const value = window.__PLVS_INITIAL_STATE__?.globalPreferences?.[KEY];
  return typeof value === "boolean" ? value : null;
}

function preferenceRevision() {
  return transactionalBoot()?.globalPreferenceRevisions?.[KEY] ?? 0;
}

function rememberPreference(enabled, revision) {
  const initial = window.__PLVS_INITIAL_STATE__;
  if (revision < preferenceRevision()) return;
  initial.globalPreferences = { ...initial.globalPreferences, [KEY]: enabled };
  initial.multiInstancePersistence.globalPreferenceRevisions = {
    ...initial.multiInstancePersistence.globalPreferenceRevisions,
    [KEY]: revision,
  };
}

async function savePreference(enabled, expectedRevision = preferenceRevision()) {
  if (!transactionalBoot()) return;
  const revisions = await invoke("persistence_save_global_preferences", {
    values: { [KEY]: enabled },
    expectedRevisions: { [KEY]: expectedRevision },
  });
  rememberPreference(enabled, revisions[KEY]);
}

/**
 * @param {boolean} enabled
 */
async function applyNativePreference(enabled) {
  const current = await invoke("plugin:autostart|is_enabled");
  if (current !== enabled && ownsCoordinatorResources()) {
    await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
  }
}

export function useAutostart() {
  const isCoordinator = useCoordinatorRole();
  const [autostartEnabled, setAutostartEnabledState] = useState(() => bootPreference() ?? false);
  const [autostartReady, setAutostartReady] = useState(
    () => isTauri() && (bootPreference() !== null || !isCoordinator)
  );
  const [autostartError, setAutostartError] = useState("");
  const pending = useRef(Promise.resolve());
  const enqueue = useCallback((action) => {
    const work = pending.current.then(action);
    pending.current = work.catch(() => {});
    return work;
  }, []);

  const syncAutostart = useCallback(
    (active) =>
      enqueue(async () => {
        if (!active()) return;
        try {
          let saved = bootPreference();
          if (ownsCoordinatorResources()) {
            if (saved === null) {
              const revision = preferenceRevision();
              saved = (await invoke("plugin:autostart|is_enabled")) === true;
              if (!active() || !ownsCoordinatorResources()) return;
              await savePreference(saved, revision);
              saved = bootPreference() ?? saved;
            } else {
              await applyNativePreference(saved);
            }
          }
          if (!active()) return;
          setAutostartEnabledState(saved ?? false);
          setAutostartReady(true);
          setAutostartError("");
        } catch {
          if (!active()) return;
          setAutostartReady(false);
          setAutostartError("Could not refresh Open at Login.");
        }
      }),
    [enqueue]
  );

  useEffect(() => {
    if (!isTauri()) return;
    let mounted = true;
    const active = () => mounted;
    const sync = () => {
      if (bootPreference() !== null) void syncAutostart(active);
    };
    if (isCoordinator || bootPreference() !== null) void syncAutostart(active);
    window.addEventListener("plvs-global-preferences-changed", sync);
    return () => {
      mounted = false;
      window.removeEventListener("plvs-global-preferences-changed", sync);
    };
  }, [isCoordinator, syncAutostart]);

  const retryAutostart = useCallback(async () => {
    if (!isTauri()) return;
    setAutostartError("");
    await syncAutostart(() => true);
  }, [syncAutostart]);

  const setAutostartEnabledForControl = useCallback(
    (enabled) =>
      enqueue(async () => {
        if (!isTauri() || !autostartReady) throw new Error("Autostart is unavailable.");
        const coordinator = ownsCoordinatorResources();
        const revision = preferenceRevision();
        setAutostartError("");
        try {
          if (coordinator) await applyNativePreference(enabled);
          await savePreference(enabled, revision);
          setAutostartEnabledState(bootPreference() ?? enabled);
        } catch (error) {
          if (transactionalBoot()) {
            const hydrated = await invoke("persistence_hydrate").catch(() => null);
            const saved = hydrated?.globalPreferences?.[KEY];
            if (typeof saved === "boolean") {
              rememberPreference(saved, hydrated.globalPreferenceRevisions?.[KEY] ?? 0);
            }
          }
          const saved = bootPreference() ?? autostartEnabled;
          setAutostartEnabledState(saved);
          if (coordinator && ownsCoordinatorResources()) {
            try {
              await applyNativePreference(saved);
            } catch (restoreError) {
              setAutostartError("Could not restore the system login setting. Try again.");
              throw new AggregateError(
                [error, restoreError],
                "Could not save or restore Open at Login.",
                { cause: restoreError }
              );
            }
          }
          setAutostartError("Could not save Open at Login. Try again.");
          throw error;
        }
      }),
    [autostartEnabled, autostartReady, enqueue]
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
    autostartError,
    retryAutostart,
  };
}
