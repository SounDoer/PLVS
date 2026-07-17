import { useCallback, useEffect, useRef, useState } from "react";
import {
  enterDock,
  exitDock,
  getDockState,
  setDockHeight,
  setDockReserveSpace,
  setDockSuspended,
} from "../ipc/commands.js";
import { isTauri } from "../ipc/env.js";
import { presetsStore } from "../persistence/index.js";
import { clampDockHeight } from "../dock/dockSizing.js";

function supportsDockReserveSpace() {
  return (
    typeof navigator !== "undefined" && /Win/i.test(navigator.platform || navigator.userAgent || "")
  );
}

function normalizeDockState(raw) {
  const edge = raw?.edge === "top" ? "top" : "bottom";
  const monitor = typeof raw?.monitor === "string" ? raw.monitor : null;
  return {
    enabled: raw?.enabled === true,
    edge,
    monitor,
    reserveSpace: supportsDockReserveSpace() && raw?.reserveSpace !== false,
    height: clampDockHeight(raw?.height),
  };
}

/**
 * Dock window-form state. Rust owns geometry + the persisted dockState key;
 * this hook mirrors it for rendering and drives enter/exit transitions.
 * Attribute restores (decorations / always-on-top) are passed by the caller so
 * stored user settings are never rewritten by the dock override.
 */
export function useDockMode() {
  const [dock, setDock] = useState(() =>
    normalizeDockState(
      typeof window !== "undefined" ? window.__PLVS_INITIAL_STATE__?.dockState : undefined
    )
  );
  const [dockPreviewHeight, setDockPreviewHeight] = useState(null);
  const [dockSuspended, setDockSuspendedState] = useState(false);
  const dockRef = useRef(dock);
  const transitionTailRef = useRef(Promise.resolve());
  const heightTransitionTailRef = useRef(Promise.resolve());
  const heightRequestRef = useRef(0);

  const commitDock = useCallback((update) => {
    const next = typeof update === "function" ? update(dockRef.current) : update;
    dockRef.current = next;
    setDock(next);
    return next;
  }, []);

  const enqueueTransition = useCallback((operation) => {
    const result = transitionTailRef.current.then(operation, operation);
    transitionTailRef.current = result.catch(() => {});
    return result;
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    let retryTimer = null;
    const reconcile = () => {
      getDockState()
        .then((snapshot) => {
          if (cancelled || !snapshot || typeof snapshot !== "object") return;
          if (snapshot.ready !== true) {
            retryTimer = window.setTimeout(reconcile, 16);
            return;
          }
          if (!snapshot.state || typeof snapshot.state !== "object") return;
          const normalized = normalizeDockState(snapshot.state);
          commitDock(normalized);
          if (!normalized.enabled) setDockSuspendedState(false);
        })
        .catch(() => {});
    };
    reconcile();
    return () => {
      cancelled = true;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [commitDock]);

  const enterDockMode = useCallback(
    (edge, reserveSpaceOverride, monitorOverride, heightOverride) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(async () => {
        const current = dockRef.current;
        const hasReserveOverride = typeof reserveSpaceOverride === "boolean";
        const normalizedReserveOverride = hasReserveOverride
          ? supportsDockReserveSpace() && reserveSpaceOverride
          : undefined;
        const hasHeightOverride = Number.isFinite(heightOverride);
        const resolved = await enterDock(
          edge,
          normalizedReserveOverride,
          monitorOverride,
          hasHeightOverride ? clampDockHeight(heightOverride) : undefined
        );
        const monitor =
          typeof resolved?.monitor === "string"
            ? resolved.monitor
            : typeof monitorOverride === "string"
              ? monitorOverride
              : current.monitor;
        const changed =
          !current.enabled ||
          current.edge !== edge ||
          (typeof monitorOverride === "string" && current.monitor !== monitorOverride) ||
          (hasReserveOverride && current.reserveSpace !== normalizedReserveOverride) ||
          (hasHeightOverride && current.height !== clampDockHeight(heightOverride));
        commitDock((latest) => ({
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
        }));
        setDockSuspendedState(false);
        if (changed) presetsStore.patch({ dirty: true });
      });
    },
    [commitDock, enqueueTransition]
  );

  const exitDockMode = useCallback(
    ({ decorations, alwaysOnTop, bounds }) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(async () => {
        const wasEnabled = dockRef.current.enabled;
        await exitDock({ decorations, alwaysOnTop, bounds });
        commitDock((latest) => ({ ...latest, enabled: false }));
        setDockSuspendedState(false);
        if (wasEnabled) presetsStore.patch({ dirty: true });
      });
    },
    [commitDock, enqueueTransition]
  );

  const applyReserveSpace = useCallback(
    async (enabled, edgeOverride) => {
      const current = dockRef.current;
      const edge =
        edgeOverride === "top" || edgeOverride === "bottom" ? edgeOverride : current.edge;
      if (!supportsDockReserveSpace()) {
        if (current.reserveSpace) {
          commitDock((latest) => ({ ...latest, reserveSpace: false }));
        }
        return;
      }
      await setDockReserveSpace({ enabled, edge });
      commitDock((latest) => ({ ...latest, edge, reserveSpace: enabled }));
      if (current.reserveSpace !== enabled || current.edge !== edge) {
        presetsStore.patch({ dirty: true });
      }
    },
    [commitDock]
  );

  const setReserveSpace = useCallback(
    (enabled, edgeOverride) => {
      if (!isTauri()) return Promise.resolve();
      return enqueueTransition(() => applyReserveSpace(enabled, edgeOverride));
    },
    [applyReserveSpace, enqueueTransition]
  );

  const toggleReserveSpace = useCallback(() => {
    if (!isTauri()) return Promise.resolve();
    return enqueueTransition(() => applyReserveSpace(!dockRef.current.reserveSpace));
  }, [applyReserveSpace, enqueueTransition]);

  const resizeDockHeight = useCallback(
    (height, { persist = true } = {}) => {
      if (!isTauri() || !dockRef.current.enabled) return;
      const previousHeight = dockRef.current.height;
      const nextHeight = clampDockHeight(height);
      const request = ++heightRequestRef.current;
      setDockPreviewHeight(nextHeight);
      const operation = heightTransitionTailRef.current.then(async () => {
        try {
          const resolved = await setDockHeight({ height: nextHeight, persist });
          if (persist && request === heightRequestRef.current) {
            commitDock((latest) => ({ ...latest, height: clampDockHeight(resolved) }));
            setDockPreviewHeight(null);
          }
          if (persist && previousHeight !== nextHeight) presetsStore.patch({ dirty: true });
        } catch (error) {
          if (request === heightRequestRef.current) {
            commitDock((latest) => ({ ...latest, height: previousHeight }));
            setDockPreviewHeight(null);
          }
          throw error;
        }
      });
      heightTransitionTailRef.current = operation.catch(() => {});
      return operation;
    },
    [commitDock]
  );

  const suspendDockMode = useCallback(async () => {
    if (!isTauri() || !dockRef.current.enabled) return;
    await setDockSuspended(true);
    setDockSuspendedState(true);
  }, []);

  const resumeDockMode = useCallback(async () => {
    if (!isTauri() || !dockRef.current.enabled) return;
    const resolved = await setDockSuspended(false);
    if (resolved && typeof resolved === "object") {
      commitDock((latest) => ({
        ...latest,
        monitor: typeof resolved.monitor === "string" ? resolved.monitor : latest.monitor,
        reserveSpace:
          typeof resolved.reserveSpace === "boolean" ? resolved.reserveSpace : latest.reserveSpace,
        height: clampDockHeight(resolved.height ?? latest.height),
      }));
    }
    setDockSuspendedState(false);
  }, [commitDock]);

  return {
    dockEnabled: dock.enabled,
    dockEdge: dock.edge,
    dockMonitor: dock.monitor,
    dockHeight: dock.height,
    dockPreviewHeight,
    dockSuspended,
    reserveSpace: dock.reserveSpace,
    enterDockMode,
    exitDockMode,
    setReserveSpace,
    toggleReserveSpace,
    resizeDockHeight,
    suspendDockMode,
    resumeDockMode,
  };
}
