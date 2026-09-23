import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "../ipc/env.js";
import {
  loadClearShortcutPrefs,
  saveClearShortcutPrefs,
  saveClearShortcutPrefsForControl,
  DEFAULT_CLEAR_SHORTCUT,
} from "../lib/clearShortcutPrefs.js";
import { ownsCoordinatorResources, useCoordinatorRole } from "../lib/runtimeRole.js";

async function routeGlobalClear(onClearRef) {
  try {
    const routedToPeer = await invoke("runtime_route_global_clear");
    if (!routedToPeer) onClearRef?.current?.();
  } catch (error) {
    console.warn("Unable to route the global Clear shortcut", error);
  }
}

function globalClearHandler(onClearRef) {
  return (event) => {
    if (event && event.state && event.state !== "Pressed") return;
    void routeGlobalClear(onClearRef);
  };
}

/**
 * Owns the Clear shortcut: the combo (always used in-app) and whether it is
 * additionally registered system-wide.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 */
export function useClearShortcut(onClearRef) {
  const isCoordinator = useCoordinatorRole();
  const [shortcut, setShortcutState] = useState(DEFAULT_CLEAR_SHORTCUT);
  const [global, setGlobalState] = useState(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const registeredRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      loadClearShortcutPrefs().then((prefs) => {
        if (!mounted) return;
        setShortcutState(prefs.shortcut);
        setGlobalState(prefs.global);
        setReady(true);
      });
    };
    sync();
    window.addEventListener("plvs-global-preferences-changed", sync);
    return () => {
      mounted = false;
      window.removeEventListener("plvs-global-preferences-changed", sync);
    };
  }, []);

  useEffect(() => {
    if (!ready || !isTauri()) return;
    if (!isCoordinator) return;
    let cancelled = false;
    (async () => {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
      if (registeredRef.current && registeredRef.current !== shortcut) {
        try {
          await unregister(registeredRef.current);
        } catch (_) {}
        registeredRef.current = null;
      }
      if (!global || capturing) {
        if (registeredRef.current) {
          try {
            await unregister(registeredRef.current);
          } catch (_) {}
          registeredRef.current = null;
        }
        setRegistrationError(null);
        return;
      }
      if (registeredRef.current === shortcut) return;
      try {
        await register(shortcut, globalClearHandler(onClearRef));
        if (!cancelled) {
          registeredRef.current = shortcut;
          setRegistrationError(null);
        }
      } catch (e) {
        if (!cancelled) setRegistrationError(String(e?.message || e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, global, capturing, shortcut, onClearRef, isCoordinator]);

  useEffect(
    () => () => {
      const current = registeredRef.current;
      if (current && isTauri() && ownsCoordinatorResources()) {
        import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) => {
          const result = unregister(current);
          if (result && typeof result.catch === "function") result.catch(() => {});
        });
      }
    },
    []
  );

  function setClearGlobal(next) {
    setGlobalState(next);
    void saveClearShortcutPrefs({ shortcut, global: next });
  }

  function setClearShortcut(next) {
    setShortcutState(next);
    void saveClearShortcutPrefs({ shortcut: next, global });
  }

  async function applyClearShortcutForControl(next) {
    if (!ready || capturing) throw new Error("Clear shortcut is unavailable.");
    const previous = { shortcut, global, registered: registeredRef.current };
    let register;
    let unregister;
    let registeredNew = false;
    if (isTauri() && ownsCoordinatorResources()) {
      ({ register, unregister } = await import("@tauri-apps/plugin-global-shortcut"));
      if (next.global && previous.registered !== next.accelerator) {
        await register(next.accelerator, globalClearHandler(onClearRef));
        registeredNew = true;
      }
      if (previous.registered && (!next.global || previous.registered !== next.accelerator)) {
        await unregister(previous.registered);
      }
    }
    try {
      await saveClearShortcutPrefsForControl({
        shortcut: next.accelerator,
        global: next.global,
      });
    } catch (error) {
      if (isTauri() && ownsCoordinatorResources()) {
        if (registeredNew) await unregister(next.accelerator).catch(() => {});
        if (previous.registered) {
          await register(previous.registered, globalClearHandler(onClearRef)).catch(() => {});
        }
      }
      registeredRef.current = previous.registered;
      throw error;
    }
    registeredRef.current = next.global ? next.accelerator : null;
    setShortcutState(next.accelerator);
    setGlobalState(next.global);
    setRegistrationError(null);
  }

  return {
    clearShortcut: shortcut,
    clearGlobal: global,
    clearReady: ready,
    clearCapturing: capturing,
    registrationError,
    setClearGlobal,
    setClearShortcut,
    setClearCapturing: setCapturing,
    applyClearShortcutForControl,
  };
}
