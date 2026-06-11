import { useEffect, useRef, useState } from "react";
import { isTauri } from "../ipc/env.js";
import {
  loadGlobalClearPrefs,
  saveGlobalClearPrefs,
  DEFAULT_GLOBAL_CLEAR_SHORTCUT,
} from "../lib/globalClearPrefs.js";

/**
 * Owns the system-wide clear shortcut lifecycle.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 */
export function useGlobalClearShortcut(onClearRef) {
  const [enabled, setEnabledState] = useState(false);
  const [shortcut, setShortcutState] = useState(DEFAULT_GLOBAL_CLEAR_SHORTCUT);
  const [ready, setReady] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const registeredRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadGlobalClearPrefs().then((prefs) => {
      if (!mounted) return;
      setEnabledState(prefs.enabled);
      setShortcutState(prefs.shortcut);
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    (async () => {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
      if (registeredRef.current && registeredRef.current !== shortcut) {
        try {
          await unregister(registeredRef.current);
        } catch (_) {}
        registeredRef.current = null;
      }
      if (!enabled) {
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
        await register(shortcut, (event) => {
          if (event && event.state && event.state !== "Pressed") return;
          onClearRef?.current?.();
        });
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
  }, [ready, enabled, shortcut, onClearRef]);

  useEffect(
    () => () => {
      const current = registeredRef.current;
      if (current && isTauri()) {
        import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) => {
          const result = unregister(current);
          if (result && typeof result.catch === "function") result.catch(() => {});
        });
      }
    },
    []
  );

  function setGlobalClearEnabled(next) {
    setEnabledState(next);
    void saveGlobalClearPrefs({ enabled: next, shortcut });
  }

  function setGlobalClearShortcut(next) {
    setShortcutState(next);
    void saveGlobalClearPrefs({ enabled, shortcut: next });
  }

  return {
    globalClearEnabled: enabled,
    globalClearShortcut: shortcut,
    globalClearReady: ready,
    registrationError,
    setGlobalClearEnabled,
    setGlobalClearShortcut,
  };
}
