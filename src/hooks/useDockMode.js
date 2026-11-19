import { useCallback, useEffect, useRef, useState } from "react";
import {
  enterDock,
  exitDock,
  getDockState,
  setDockHeight,
  setDockAboveFullScreen,
  setDockReserveSpace,
  setDockSuspended,
} from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { clampDockHeight } from "../dock/dockSizing.js";
import { SCENE_OPERATIONS } from "../lib/sceneOperations.js";
import {
  isDockSupported,
  isDockReserveSpaceSupported as supportsDockReserveSpace,
  isMacOS,
  isDockAboveFullScreenSupported,
  isWindows,
} from "../lib/platform.js";
import { updateDiagnosticDock } from "../lib/feedbackDiagnostics.js";
import { onDockNativeGeometryChanged } from "../ipc/events.js";

export function isDockSaveFailure(error) {
  return String(error?.message ?? error).startsWith("Could not save applied Dock settings:");
}

function normalizeDockState(raw) {
  // No stored form (first run): the tuned first-run Dock sits on the top edge. Rust always writes an
  // edge, so this only decides the no-record case.
  const edge = raw?.edge === "bottom" ? "bottom" : "top";
  const monitor = typeof raw?.monitor === "string" ? raw.monitor : null;
  return {
    enabled: isDockSupported() && raw?.enabled === true,
    edge,
    monitor,
    reserveSpace:
      supportsDockReserveSpace() &&
      (isWindows() ? raw?.reserveSpace !== false : raw?.reserveSpace === true),
    height: clampDockHeight(raw?.height),
    aboveFullScreen: isDockAboveFullScreenSupported() && raw?.aboveFullScreen !== false,
  };
}

/**
 * Dock window-form state. Rust owns geometry + the persisted dockState key;
 * this hook mirrors it for rendering and drives enter/exit transitions.
 * Attribute restores (decorations / always-on-top) are passed by the caller so
 * stored user settings are never rewritten by the dock override.
 *
 * Dock entry asks the scene guard before changing the window form. An editor without a
 * transferable presentation would otherwise be stranded off screen.
 * `assertSceneOperationAllowed` refuses the entry in that case -- it used to
 * cancel the profile draft instead, which is the silent discard this guard
 * exists to prevent. Passed in rather than reached for: the dock knows it is a
 * monitoring posture, not which editors that strands.
 * @param {{ assertSceneOperationAllowed?: (...args: any[]) => any }} [options]
 */
export function useDockMode({ assertSceneOperationAllowed = () => {} } = {}) {
  const [dock, setDock] = useState(() =>
    normalizeDockState(
      typeof window !== "undefined" ? window.__PLVS_INITIAL_STATE__?.dockState : undefined
    )
  );
  const [dockPreviewHeight, setDockPreviewHeight] = useState(null);
  const [dockSuspended, setDockSuspendedState] = useState(false);
  const [dockTransitioning, setDockTransitioning] = useState(false);
  const dockRef = useRef(dock);
  const transitionTailRef = useRef(Promise.resolve());
  const transitionCountRef = useRef(0);
  const heightRequestRef = useRef(0);
  const nativeRevisionRef = useRef(0);
  const nativeMutationRef = useRef(false);

  useEffect(() => {
    updateDiagnosticDock({
      enabled: dock.enabled,
      suspended: dockSuspended,
      height: dock.height,
      previewHeight: dockPreviewHeight,
    });
  }, [dock.enabled, dock.height, dockSuspended, dockPreviewHeight]);

  const commitDock = useCallback((update) => {
    const next = typeof update === "function" ? update(dockRef.current) : update;
    dockRef.current = next;
    setDock(next);
    return next;
  }, []);

  const applySnapshot = useCallback(
    (snapshot) => {
      if (snapshot?.ready !== true || !snapshot.state || typeof snapshot.state !== "object") return;
      const normalized = normalizeDockState(snapshot.state);
      commitDock(normalized);
      if (!normalized.enabled) setDockSuspendedState(false);
    },
    [commitDock]
  );

  const enqueueTransition = useCallback(
    (operation, showTransition = true) => {
      if (showTransition) {
        transitionCountRef.current += 1;
        setDockTransitioning(true);
      }
      const result = transitionTailRef.current.then(async () => {
        nativeRevisionRef.current += 1;
        nativeMutationRef.current = true;
        try {
          return await operation();
        } catch (error) {
          if (isDockSaveFailure(error)) {
            await getDockState()
              .then(applySnapshot)
              .catch(() => {});
          }
          throw error;
        } finally {
          nativeMutationRef.current = false;
          nativeRevisionRef.current += 1;
        }
      });
      transitionTailRef.current = result.catch(() => {});
      return result.finally(() => {
        if (!showTransition) return;
        transitionCountRef.current -= 1;
        if (transitionCountRef.current === 0) setDockTransitioning(false);
      });
    },
    [applySnapshot]
  );

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let retryTimer = null;
    let lastRequest = 0;
    const reconcile = async () => {
      window.clearTimeout(retryTimer);
      const request = ++lastRequest;
      const revision = nativeRevisionRef.current;
      const snapshot = await getDockState().catch(() => null);
      if (cancelled || request !== lastRequest) return;
      if (nativeMutationRef.current || revision !== nativeRevisionRef.current) {
        retryTimer = window.setTimeout(reconcile, 100);
        return;
      }
      applySnapshot(snapshot);
      if (snapshot?.ready === false) retryTimer = window.setTimeout(reconcile, 16);
      else if (isMacOS() || snapshot === null) retryTimer = window.setTimeout(reconcile, 1000);
    };
    reconcile();
    let stopGeometry;
    if (!isWindows() && !isMacOS() && isDockSupported()) {
      void onDockNativeGeometryChanged(reconcile)
        .then((stop) => {
          if (cancelled) stop();
          else stopGeometry = stop;
        })
        .catch(() => {});
    }
    return () => {
      cancelled = true;
      stopGeometry?.();
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [applySnapshot]);

  const enterDockMode = useCallback(
    (
      /** @type {string} */ edge,
      reserveSpaceOverride,
      monitorOverride,
      heightOverride,
      origin = undefined,
      aboveFullScreenOverride = undefined
    ) => {
      // Before the platform checks so the refusal does not depend on where it runs, and before
      // enqueueTransition so a blocked entry never joins the transition chain.
      assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter);
      if (!isDockSupported()) {
        return Promise.reject(new Error("Dock is unavailable on this platform."));
      }
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(async () => {
        // A draft can open while a preceding native transition is still pending.
        assertSceneOperationAllowed(SCENE_OPERATIONS.dockEnter);
        const current = dockRef.current;
        const hasReserveOverride = typeof reserveSpaceOverride === "boolean";
        const normalizedReserveOverride = hasReserveOverride
          ? supportsDockReserveSpace() && reserveSpaceOverride
          : undefined;
        const hasHeightOverride = Number.isFinite(heightOverride);
        const hasAboveOverride = typeof aboveFullScreenOverride === "boolean";
        const resolved = await enterDock(
          edge,
          normalizedReserveOverride,
          monitorOverride,
          hasHeightOverride ? clampDockHeight(heightOverride) : undefined,
          ...(hasAboveOverride ? [origin, aboveFullScreenOverride] : origin ? [origin] : [])
        );
        const monitor =
          typeof resolved?.monitor === "string"
            ? resolved.monitor
            : typeof monitorOverride === "string"
              ? monitorOverride
              : current.monitor;
        const effective = commitDock((latest) => ({
          ...latest,
          enabled: true,
          edge,
          monitor,
          reserveSpace:
            typeof resolved?.reserveSpace === "boolean"
              ? resolved.reserveSpace
              : hasReserveOverride
                ? normalizedReserveOverride
                : latest.reserveSpace,
          height: clampDockHeight(resolved?.height ?? heightOverride ?? latest.height),
          aboveFullScreen:
            typeof resolved?.aboveFullScreen === "boolean"
              ? resolved.aboveFullScreen
              : hasAboveOverride
                ? aboveFullScreenOverride
                : latest.aboveFullScreen,
        }));
        setDockSuspendedState(false);
        return effective;
      });
    },
    [assertSceneOperationAllowed, commitDock, enqueueTransition]
  );

  const exitDockMode = useCallback(
    ({ decorations, alwaysOnTop, bounds, origin = undefined }) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(async () => {
        await exitDock({ decorations, alwaysOnTop, bounds, ...(origin ? { origin } : {}) });
        commitDock((latest) => ({ ...latest, enabled: false }));
        setDockSuspendedState(false);
      });
    },
    [commitDock, enqueueTransition]
  );

  const applyReserveSpace = useCallback(
    async (/** @type {boolean} */ enabled, edgeOverride, origin = undefined) => {
      const current = dockRef.current;
      const edge =
        edgeOverride === "top" || edgeOverride === "bottom" ? edgeOverride : current.edge;
      if (!supportsDockReserveSpace()) {
        if (current.reserveSpace) {
          commitDock((latest) => ({ ...latest, reserveSpace: false }));
        }
        return;
      }
      await setDockReserveSpace({ enabled, edge, ...(origin ? { origin } : {}) });
      commitDock((latest) => ({ ...latest, edge, reserveSpace: enabled }));
    },
    [commitDock]
  );

  const setReserveSpace = useCallback(
    (enabled, edgeOverride, origin = undefined) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(() => applyReserveSpace(enabled, edgeOverride, origin));
    },
    [applyReserveSpace, enqueueTransition]
  );

  const toggleReserveSpace = useCallback(() => {
    if (!isTauri()) return Promise.resolve();
    return enqueueTransition(() => applyReserveSpace(!dockRef.current.reserveSpace));
  }, [applyReserveSpace, enqueueTransition]);

  const applyAboveFullScreen = useCallback(
    async (/** @type {boolean} */ enabled, origin = undefined) => {
      await setDockAboveFullScreen({ enabled, ...(origin ? { origin } : {}) });
      commitDock((latest) => ({ ...latest, aboveFullScreen: enabled }));
    },
    [commitDock]
  );
  const setAboveFullScreen = useCallback(
    (/** @type {boolean} */ enabled, origin = undefined) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(() => applyAboveFullScreen(enabled, origin));
    },
    [applyAboveFullScreen, enqueueTransition]
  );

  const toggleAboveFullScreen = useCallback(() => {
    if (!isTauri()) return Promise.resolve();
    return enqueueTransition(() => applyAboveFullScreen(!dockRef.current.aboveFullScreen));
  }, [applyAboveFullScreen, enqueueTransition]);

  const resizeDockHeight = useCallback(
    (height, { persist = true, cancelled = false, origin = undefined } = {}) => {
      if (!isTauri() || !dockRef.current.enabled) return;
      const nextHeight = clampDockHeight(height);
      const request = ++heightRequestRef.current;
      setDockPreviewHeight(nextHeight);
      return enqueueTransition(async () => {
        try {
          const resolved = await setDockHeight({
            height: nextHeight,
            persist,
            ...(cancelled ? { cancelled } : {}),
            ...(origin ? { origin } : {}),
          });
          if (!persist && request === heightRequestRef.current) {
            setDockPreviewHeight(clampDockHeight(resolved));
          }
          if (persist) {
            commitDock((latest) => ({ ...latest, height: clampDockHeight(resolved) }));
            if (request === heightRequestRef.current) setDockPreviewHeight(null);
          }
        } catch (error) {
          if (request === heightRequestRef.current) {
            setDockPreviewHeight(null);
          }
          throw error;
        }
      }, false);
    },
    [commitDock, enqueueTransition]
  );

  const suspendDockMode = useCallback(async () => {
    if (!isTauri() || !dockRef.current.enabled) return;
    await enqueueTransition(async () => {
      if (!dockRef.current.enabled) return;
      await setDockSuspended(true);
      setDockSuspendedState(true);
    }, false);
  }, [enqueueTransition]);

  const resumeDockMode = useCallback(async () => {
    if (!isTauri() || !dockRef.current.enabled) return;
    await enqueueTransition(async () => {
      if (!dockRef.current.enabled) return;
      const resolved = await setDockSuspended(false);
      if (resolved && typeof resolved === "object") {
        commitDock((latest) => ({
          ...latest,
          monitor: typeof resolved.monitor === "string" ? resolved.monitor : latest.monitor,
          reserveSpace:
            typeof resolved.reserveSpace === "boolean"
              ? resolved.reserveSpace
              : latest.reserveSpace,
          height: clampDockHeight(resolved.height ?? latest.height),
        }));
      }
      setDockSuspendedState(false);
    }, false);
  }, [commitDock, enqueueTransition]);

  return {
    dockEnabled: dock.enabled,
    dockEdge: dock.edge,
    dockMonitor: dock.monitor,
    dockHeight: dock.height,
    dockPreviewHeight,
    dockSuspended,
    dockTransitioning,
    reserveSpace: dock.reserveSpace,
    aboveFullScreen: dock.aboveFullScreen,
    enterDockMode,
    exitDockMode,
    setReserveSpace,
    toggleReserveSpace,
    setAboveFullScreen,
    toggleAboveFullScreen,
    resizeDockHeight,
    suspendDockMode,
    resumeDockMode,
  };
}
