import { useEffect, useRef, useState } from "react";
import { isTauri } from "../ipc/env.js";
import {
  loadClearShortcutPrefs,
  saveClearShortcutPrefs,
  DEFAULT_CLEAR_SHORTCUT,
} from "../lib/clearShortcutPrefs.js";

/**
 * Owns the Clear shortcut: the combo (always used in-app) and whether it is
 * additionally registered system-wide.
 * @param {{ current: (() => void) | null }} onClearRef - ref whose `.current` is the latest clearAll.
 */
export function useClearShortcut(onClearRef) {
  const [shortcut, setShortcutState] = useState(DEFAULT_CLEAR_SHORTCUT);
  const [global, setGlobalState] = useState(false);
  const [ready, setReady] = useState(false);
  const [registrationError, setRegistrationError] = useState(null);
  const registeredRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    loadClearShortcutPrefs().then((prefs) => {
      if (!mounted) return;
      setShortcutState(prefs.shortcut);
      setGlobalState(prefs.global);
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
      if (!global) {
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
  }, [ready, global, shortcut, onClearRef]);

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

  function setClearGlobal(next) {
    setGlobalState(next);
    void saveClearShortcutPrefs({ shortcut, global: next });
  }

  function setClearShortcut(next) {
    setShortcutState(next);
    void saveClearShortcutPrefs({ shortcut: next, global });
  }

  return {
    clearShortcut: shortcut,
    clearGlobal: global,
    clearReady: ready,
    registrationError,
    setClearGlobal,
    setClearShortcut,
  };
}
