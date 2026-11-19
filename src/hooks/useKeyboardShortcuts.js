import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
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

function requestedGlobalRegistrations(shortcuts) {
  return new Map(
    Object.entries(shortcuts)
      .filter(([, binding]) => binding.global && binding.accelerator)
      .map(([actionId, binding]) => [binding.accelerator, actionId])
  );
}

async function reconcileRegistrations(registered, desired, dispatch, { stopOnError = false } = {}) {
  const errors = new Map();
  const missing = [...desired].filter((accelerator) => !registered.has(accelerator));
  const obsolete = [...registered].filter((accelerator) => !desired.has(accelerator));
  if (!missing.length && !obsolete.length) return errors;
  const { register, unregister } = await import("@tauri-apps/plugin-global-shortcut");

  for (const accelerator of missing) {
    try {
      await register(accelerator, (event) => {
        if (event?.state && event.state !== "Pressed") return;
        if (registered.has(accelerator)) dispatch(accelerator);
      });
      registered.add(accelerator);
    } catch (error) {
      errors.set(accelerator, String(error?.message || error));
      if (stopOnError) return errors;
    }
  }
  for (const accelerator of obsolete) {
    try {
      await unregister(accelerator);
      registered.delete(accelerator);
    } catch (error) {
      errors.set(accelerator, String(error?.message || error));
      if (stopOnError) return errors;
    }
  }
  return errors;
}

function registrationErrorsByAction(errors, bindings, previous = new Map()) {
  return Object.fromEntries(
    [...errors].flatMap(([accelerator, message]) => {
      const actionId = bindings.get(accelerator) ?? previous.get(accelerator);
      return actionId ? [[actionId, message]] : [];
    })
  );
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
  const registeredRef = useRef(new Set());
  const registrationEnabled = useRef(false);
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

  useLayoutEffect(() => {
    registrationEnabled.current = ready && isTauri() && isCoordinator && !capturing;
    return () => {
      registrationEnabled.current = false;
    };
  }, [capturing, isCoordinator, ready]);

  const dispatchGlobal = useCallback(
    (accelerator) => {
      if (!registrationEnabled.current) return;
      // Native registration owns the key. The latest saved binding decides which action it runs.
      const actionId = requestedGlobalRegistrations(saved.current.shortcuts).get(accelerator);
      if (actionId) void routeGlobalShortcut(actionId, dispatchRef);
    },
    [dispatchRef]
  );

  useEffect(() => {
    if (!ready || !isTauri()) return;
    let cancelled = false;
    void enqueueUpdate(async () => {
      if (cancelled) return;
      const bindings = requestedGlobalRegistrations(saved.current.shortcuts);
      const desired = new Set(registrationEnabled.current ? bindings.keys() : []);
      const errors = await reconcileRegistrations(registeredRef.current, desired, dispatchGlobal);
      if (!cancelled) setRegistrationErrors(registrationErrorsByAction(errors, bindings));
    });
    return () => {
      cancelled = true;
    };
  }, [capturing, dispatchGlobal, enqueueUpdate, isCoordinator, ready, shortcuts]);

  useEffect(
    () => () => {
      if (!isTauri()) return;
      void enqueueUpdate(() =>
        reconcileRegistrations(registeredRef.current, new Set(), dispatchGlobal)
      );
    },
    [dispatchGlobal, enqueueUpdate]
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
        const shouldRegister = registrationEnabled.current;
        const registered = registeredRef.current;
        const previous = new Set(registered);
        const desired = requestedGlobalRegistrations(normalized);
        try {
          if (shouldRegister) {
            const errors = await reconcileRegistrations(
              registered,
              new Set(desired.keys()),
              dispatchGlobal,
              { stopOnError: true }
            );
            if (errors.size) {
              throw new Error([...errors.values()].join(" "));
            }
          }
          const savedRevision = await saveKeyboardShortcutPrefs(normalized, revision);
          publishShortcuts(normalized, savedRevision ?? revision);
        } catch (error) {
          if (shouldRegister) {
            const previousBindings = requestedGlobalRegistrations(current);
            const errors = await reconcileRegistrations(
              registered,
              registrationEnabled.current ? previous : new Set(),
              dispatchGlobal
            );
            if (errors.size) {
              setRegistrationErrors((existing) => ({
                ...existing,
                ...registrationErrorsByAction(errors, previousBindings, desired),
              }));
              throw Object.assign(
                new Error(
                  `${error?.message || error} Could not restore global shortcuts: ${[
                    ...errors.values(),
                  ].join(" ")}`,
                  { cause: error }
                ),
                { partial: true, rollback: "failed" }
              );
            }
          }
          throw error;
        }
        setRegistrationErrors({});
        setSaveErrors({});
      }),
    [dispatchGlobal, enqueueUpdate, publishShortcuts]
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
