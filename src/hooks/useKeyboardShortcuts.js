import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  configuredShortcutConflict,
  normalizeKeyboardShortcuts,
} from "../data/keyboardShortcutActions.js";
import { isTauri } from "../ipc/env.js";
import {
  loadKeyboardShortcutPrefs,
  saveKeyboardShortcutPrefs,
  saveKeyboardShortcutPrefsForControl,
} from "../lib/shortcutPrefs.js";
import { useCoordinatorRole } from "../lib/runtimeRole.js";

async function routeGlobalShortcut(actionId, dispatchRef) {
  try {
    const routedToPeer = await invoke("runtime_route_global_shortcut", { actionId });
    if (!routedToPeer) dispatchRef?.current?.(actionId);
  } catch (error) {
    console.warn(`Unable to route the global ${actionId} shortcut`, error);
  }
}

function globalShortcutHandler(actionId, dispatchRef) {
  return (event) => {
    if (event && event.state && event.state !== "Pressed") return;
    void routeGlobalShortcut(actionId, dispatchRef);
  };
}

function requestedGlobalRegistrations(shortcuts, enabled = true) {
  return new Map(
    enabled
      ? Object.entries(shortcuts)
          .filter(([, binding]) => binding.global && binding.accelerator)
          .map(([actionId, binding]) => [actionId, binding.accelerator])
      : []
  );
}

async function replaceRegistrationsAtomically(registered, desired, dispatchRef) {
  const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
  const previous = new Map(registered);
  const changed = new Set(
    [...new Set([...previous.keys(), ...desired.keys()])].filter(
      (actionId) => previous.get(actionId) !== desired.get(actionId)
    )
  );
  const occupiedByChanged = new Set(
    [...changed].map((actionId) => previous.get(actionId)).filter(Boolean)
  );
  const registeredNew = [];
  const releasedOld = [];
  try {
    for (const actionId of changed) {
      const accelerator = desired.get(actionId);
      if (!accelerator || occupiedByChanged.has(accelerator)) continue;
      await register(accelerator, globalShortcutHandler(actionId, dispatchRef));
      registeredNew.push([actionId, accelerator]);
    }
    for (const actionId of changed) {
      const accelerator = previous.get(actionId);
      if (!accelerator) continue;
      await unregister(accelerator);
      releasedOld.push([actionId, accelerator]);
    }
    for (const actionId of changed) {
      const accelerator = desired.get(actionId);
      if (!accelerator || !occupiedByChanged.has(accelerator)) continue;
      await register(accelerator, globalShortcutHandler(actionId, dispatchRef));
      registeredNew.push([actionId, accelerator]);
    }
  } catch (error) {
    for (const [, accelerator] of registeredNew.reverse())
      await unregister(accelerator).catch(() => {});
    for (const [actionId, accelerator] of releasedOld) {
      await register(accelerator, globalShortcutHandler(actionId, dispatchRef)).catch(() => {});
    }
    registered.clear();
    for (const entry of previous) registered.set(...entry);
    throw error;
  }
  registered.clear();
  for (const entry of desired) registered.set(...entry);
}

/**
 * Owns every configurable shortcut and the coordinator-only operating-system registrations.
 * @param {{ current: ((actionId: string) => any) | null }} dispatchRef
 */
export function useKeyboardShortcuts(dispatchRef) {
  const isCoordinator = useCoordinatorRole();
  const [shortcuts, setShortcuts] = useState(() => normalizeKeyboardShortcuts());
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [registrationErrors, setRegistrationErrors] = useState({});
  const registeredRef = useRef(new Map());

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      loadKeyboardShortcutPrefs().then((next) => {
        if (!mounted) return;
        setShortcuts(next);
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
    let cancelled = false;
    (async () => {
      const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");
      const desired = requestedGlobalRegistrations(shortcuts, isCoordinator && !capturing);

      for (const [actionId, accelerator] of [...registeredRef.current]) {
        if (desired.has(actionId)) continue;
        try {
          await unregister(accelerator);
        } catch (_) {}
        registeredRef.current.delete(actionId);
      }

      for (const [actionId, accelerator] of desired) {
        const previous = registeredRef.current.get(actionId);
        if (previous === accelerator) continue;
        try {
          await register(accelerator, globalShortcutHandler(actionId, dispatchRef));
          if (previous) {
            try {
              await unregister(previous);
            } catch (error) {
              await unregister(accelerator).catch(() => {});
              throw error;
            }
          }
          if (cancelled) {
            await unregister(accelerator).catch(() => {});
            if (previous)
              await register(previous, globalShortcutHandler(actionId, dispatchRef)).catch(
                () => {}
              );
          } else {
            registeredRef.current.set(actionId, accelerator);
            setRegistrationErrors((current) => {
              if (!(actionId in current)) return current;
              const next = { ...current };
              delete next[actionId];
              return next;
            });
          }
        } catch (error) {
          if (!cancelled) {
            setRegistrationErrors((current) => ({
              ...current,
              [actionId]: String(error?.message || error),
            }));
          }
        }
      }
      if (!cancelled) {
        setRegistrationErrors((current) =>
          Object.fromEntries(Object.entries(current).filter(([actionId]) => desired.has(actionId)))
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [capturing, dispatchRef, isCoordinator, ready, shortcuts]);

  useEffect(
    () => () => {
      if (!isTauri()) return;
      const registered = [...registeredRef.current.values()];
      registeredRef.current.clear();
      import("@tauri-apps/plugin-global-shortcut").then(({ unregister }) => {
        for (const accelerator of registered) {
          const result = unregister(accelerator);
          if (result && typeof result.catch === "function") result.catch(() => {});
        }
      });
    },
    []
  );

  const commitGuiUpdate = useCallback((update) => {
    setShortcuts((current) => {
      const next = normalizeKeyboardShortcuts(update(current));
      void saveKeyboardShortcutPrefs(next);
      return next;
    });
  }, []);

  const setShortcutAccelerator = useCallback(
    (actionId, accelerator) => {
      commitGuiUpdate((current) =>
        configuredShortcutConflict(current, actionId, accelerator)
          ? current
          : {
              ...current,
              [actionId]: {
                ...current[actionId],
                accelerator,
                ...(accelerator === null ? { global: false } : null),
              },
            }
      );
    },
    [commitGuiUpdate]
  );

  const setShortcutGlobal = useCallback(
    (actionId, global) => {
      commitGuiUpdate((current) => ({
        ...current,
        [actionId]: { ...current[actionId], global },
      }));
    },
    [commitGuiUpdate]
  );

  const applyKeyboardShortcutsForControl = useCallback(
    async (next) => {
      const normalized = normalizeKeyboardShortcuts(next);
      const shouldRegister = isTauri() && isCoordinator && ready && !capturing;
      const previousRegistrations = new Map(registeredRef.current);
      if (shouldRegister) {
        await replaceRegistrationsAtomically(
          registeredRef.current,
          requestedGlobalRegistrations(normalized),
          dispatchRef
        );
      }
      try {
        await saveKeyboardShortcutPrefsForControl(normalized);
      } catch (error) {
        if (shouldRegister) {
          await replaceRegistrationsAtomically(
            registeredRef.current,
            previousRegistrations,
            dispatchRef
          ).catch(() => {});
        }
        throw error;
      }
      setShortcuts(normalized);
      setRegistrationErrors({});
    },
    [capturing, dispatchRef, isCoordinator, ready]
  );

  return {
    keyboardShortcuts: shortcuts,
    shortcutsReady: ready,
    shortcutCapturing: capturing,
    shortcutRegistrationErrors: registrationErrors,
    setShortcutAccelerator,
    setShortcutGlobal,
    setShortcutCapturing: setCapturing,
    applyKeyboardShortcutsForControl,
  };
}
