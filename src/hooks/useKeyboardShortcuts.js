import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  configuredShortcutConflict,
  normalizeKeyboardShortcuts,
} from "../data/keyboardShortcutActions.js";
import { isTauri } from "../ipc/env.js";
import {
  keyboardShortcutPrefsRevision,
  loadKeyboardShortcutPrefs,
  saveKeyboardShortcutPrefs,
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
  const saved = useRef({ shortcuts, revision: 0 });
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [registrationErrors, setRegistrationErrors] = useState({});
  const [saveErrors, setSaveErrors] = useState(/** @type {Record<string, string>} */ ({}));
  const registeredRef = useRef(new Map());
  const pendingUpdate = useRef(Promise.resolve());
  const enqueueUpdate = useCallback((update) => {
    const pending = pendingUpdate.current.then(update);
    pendingUpdate.current = pending.catch(() => {});
    return pending;
  }, []);
  const publishShortcuts = useCallback((next, revision) => {
    saved.current = { shortcuts: next, revision };
    setShortcuts(next);
  }, []);

  useEffect(() => {
    let mounted = true;
    const sync = () => {
      void enqueueUpdate(async () => {
        if (!mounted) return;
        const revision = keyboardShortcutPrefsRevision();
        const next = await loadKeyboardShortcutPrefs();
        if (!mounted) return;
        if (revision >= saved.current.revision) publishShortcuts(next, revision);
        setReady(true);
      });
    };
    sync();
    window.addEventListener("plvs-global-preferences-changed", sync);
    return () => {
      mounted = false;
      window.removeEventListener("plvs-global-preferences-changed", sync);
    };
  }, [enqueueUpdate, publishShortcuts]);

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

  const commitGuiUpdate = useCallback(
    (/** @type {string} */ actionId, update) =>
      enqueueUpdate(async () => {
        const { shortcuts: current, revision } = saved.current;
        const updated = update(current);
        if (updated === current) return;
        const next = normalizeKeyboardShortcuts(updated);
        try {
          const savedRevision = await saveKeyboardShortcutPrefs(next, revision);
          publishShortcuts(next, savedRevision ?? revision);
        } catch (error) {
          setSaveErrors((errors) => ({
            ...errors,
            [actionId]:
              error?.reason === "conflict"
                ? "Shortcuts changed in another workbench. Try again."
                : "Could not save shortcut. Try again.",
          }));
          return;
        }
        setSaveErrors(({ [actionId]: _saved, ...errors }) => errors);
      }),
    [enqueueUpdate, publishShortcuts]
  );

  const setShortcutAccelerator = useCallback(
    (actionId, accelerator) => {
      commitGuiUpdate(actionId, (current) =>
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
      commitGuiUpdate(actionId, (current) => ({
        ...current,
        [actionId]: { ...current[actionId], global },
      }));
    },
    [commitGuiUpdate]
  );

  const applyKeyboardShortcutsForControl = useCallback(
    (next, expected = undefined) =>
      enqueueUpdate(async () => {
        const { shortcuts: current, revision } = saved.current;
        if (
          expected &&
          JSON.stringify(normalizeKeyboardShortcuts(expected)) !== JSON.stringify(current)
        ) {
          throw new Error("Keyboard shortcuts changed before this operation could be applied.");
        }
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
          const savedRevision = await saveKeyboardShortcutPrefs(normalized, revision);
          publishShortcuts(normalized, savedRevision ?? revision);
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
        setRegistrationErrors({});
        setSaveErrors({});
      }),
    [capturing, dispatchRef, enqueueUpdate, isCoordinator, publishShortcuts, ready]
  );

  return {
    keyboardShortcuts: shortcuts,
    shortcutsReady: ready,
    shortcutCapturing: capturing,
    shortcutRegistrationErrors: registrationErrors,
    shortcutSaveErrors: saveErrors,
    setShortcutAccelerator,
    setShortcutGlobal,
    setShortcutCapturing: setCapturing,
    applyKeyboardShortcutsForControl,
  };
}
