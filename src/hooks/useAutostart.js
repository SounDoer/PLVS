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
  if (current !== enabled) {
    await invoke(enabled ? "plugin:autostart|enable" : "plugin:autostart|disable");
  }
}

function applySharedPreference() {
  const saved = bootPreference();
  if (saved !== null && ownsCoordinatorResources()) return applyNativePreference(saved);
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

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    const shared = bootPreference();
    if (shared !== null) {
      if (isCoordinator) {
        enqueue(() => {
          if (!cancelled) return applySharedPreference();
        }).catch(() => {
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
    enqueue(async () => {
      if (cancelled || !ownsCoordinatorResources()) return;
      const enabled = await invoke("plugin:autostart|is_enabled");
      if (cancelled || !ownsCoordinatorResources()) return;
      await savePreference(enabled);
      if (cancelled) return;
      setAutostartEnabledState(enabled);
      setAutostartReady(true);
    }).catch(() => {
      if (!cancelled) setAutostartReady(false);
    });
    return () => {
      cancelled = true;
    };
  }, [enqueue, isCoordinator]);

  useEffect(() => {
    const sync = () => {
      const shared = bootPreference();
      if (shared === null) return;
      setAutostartEnabledState(shared);
      setAutostartReady(true);
      if (isCoordinator) {
        void enqueue(applySharedPreference).catch(() =>
          setAutostartError("Could not apply Open at Login. Try again.")
        );
      }
    };
    window.addEventListener("plvs-global-preferences-changed", sync);
    return () => window.removeEventListener("plvs-global-preferences-changed", sync);
  }, [enqueue, isCoordinator]);

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
  };
}
