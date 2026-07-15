import { useCallback, useEffect, useRef, useState } from "react";
import { HISTORY_MIN_WINDOW_SEC } from "../math/historyMath.js";
import { UI_PREFERENCES } from "../uiPreferences.js";

export const DOCK_HISTORY_DEFAULT_WINDOW_SEC =
  UI_PREFERENCES.modules.loudness.history.defaultWindowSec;

export function clampDockHistoryWindow(value, maxWindowSec) {
  const safeMax = Math.max(HISTORY_MIN_WINDOW_SEC, Number(maxWindowSec) || 0);
  const safeValue = Number.isFinite(value) ? value : DOCK_HISTORY_DEFAULT_WINDOW_SEC;
  return Math.max(HISTORY_MIN_WINDOW_SEC, Math.min(safeMax, safeValue));
}

/** Shared live-only viewport for all time-based Dock panels. */
export function useDockHistoryViewport({ maxWindowSec }) {
  const initialWindowSec = clampDockHistoryWindow(DOCK_HISTORY_DEFAULT_WINDOW_SEC, maxWindowSec);
  const maxRef = useRef(maxWindowSec);
  const windowRef = useRef(initialWindowSec);
  const [windowSec, setWindowSec] = useState(initialWindowSec);
  const [hud, setHud] = useState(null);
  const hudTimerRef = useRef(null);
  const wheelRafRef = useRef(0);
  const pendingWheelRef = useRef(null);
  const lastRightDownRef = useRef({ panelId: null, timestamp: -Infinity });

  const showHud = useCallback((panelId, nextWindowSec) => {
    setHud({ panelId, windowSec: nextWindowSec });
    if (hudTimerRef.current != null) window.clearTimeout(hudTimerRef.current);
    hudTimerRef.current = window.setTimeout(() => {
      hudTimerRef.current = null;
      setHud(null);
    }, 1000);
  }, []);

  const commitWindow = useCallback(
    (value, panelId, withHud = true) => {
      const next = clampDockHistoryWindow(value, maxRef.current);
      windowRef.current = next;
      setWindowSec(next);
      if (withHud && panelId) showHud(panelId, next);
      return next;
    },
    [showHud]
  );

  useEffect(() => {
    maxRef.current = maxWindowSec;
    commitWindow(windowRef.current, null, false);
  }, [commitWindow, maxWindowSec]);

  useEffect(
    () => () => {
      if (hudTimerRef.current != null) window.clearTimeout(hudTimerRef.current);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
    },
    []
  );

  const onWheel = useCallback(
    (panelId, deltaY) => {
      const factor = deltaY < 0 ? 0.85 : 1.18;
      const pending = pendingWheelRef.current;
      pendingWheelRef.current = {
        panelId,
        factor: (pending?.factor ?? 1) * factor,
      };
      if (wheelRafRef.current) return;
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = 0;
        const next = pendingWheelRef.current;
        pendingWheelRef.current = null;
        if (!next) return;
        commitWindow(windowRef.current * next.factor, next.panelId);
      });
    },
    [commitWindow]
  );

  const onPointerDown = useCallback(
    (panelId, button, timestamp) => {
      if (button !== 2) return false;
      const now = Number.isFinite(timestamp)
        ? timestamp
        : typeof performance !== "undefined" && performance.now
          ? performance.now()
          : Date.now();
      const previous = lastRightDownRef.current;
      const isDouble = previous.panelId === panelId && now - previous.timestamp <= 320;
      lastRightDownRef.current = isDouble
        ? { panelId: null, timestamp: -Infinity }
        : { panelId, timestamp: now };
      if (isDouble) commitWindow(DOCK_HISTORY_DEFAULT_WINDOW_SEC, panelId);
      return isDouble;
    },
    [commitWindow]
  );

  return {
    dockHistoryWindowSec: windowSec,
    dockHistoryHud: hud,
    onDockHistoryWheel: onWheel,
    onDockHistoryPointerDown: onPointerDown,
  };
}
