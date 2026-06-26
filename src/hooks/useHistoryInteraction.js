import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeSelectionOffset,
  computePanOffset,
  computeWheelZoom,
} from "../math/historyInteractionMath";

const ACTIVE_PULSE_MS = 160;

export function useHistoryInteraction({
  /** When false, history pointer/wheel handlers and HUD helpers from this hook are no-ops (App: `historyChartInteractive`). */
  enabled,
  sampleSec,
  minWindowSec,
  maxWindowSec,
  defaultWindowSec,
  totalSamples,
  visibleSamples,
  maxOffsetSamples,
  effectiveOffsetSamples,
  effectiveOffsetSec,
  setSelectedOffset,
  setHistoryOffsetSec,
  setHistoryWindowSec,
  setHistoryHudUntilTs,
  setHistoryHudHold,
}) {
  const dragModeRef = useRef(null);
  const panStartRef = useRef({ x: 0, offset: 0 });
  const timeAxisPanStartRef = useRef(null);
  const lastRightDownTsRef = useRef(0);
  const activeTimerRef = useRef(null);
  const wheelRafRef = useRef(0);
  const pendingWheelZoomRef = useRef(null);
  const [isTimeAxisActive, setIsTimeAxisActive] = useState(false);

  const pulseTimeAxis = useCallback(() => {
    setIsTimeAxisActive(true);
    if (activeTimerRef.current != null) window.clearTimeout(activeTimerRef.current);
    activeTimerRef.current = window.setTimeout(() => {
      activeTimerRef.current = null;
      setIsTimeAxisActive(false);
    }, ACTIVE_PULSE_MS);
  }, []);

  useEffect(
    () => () => {
      if (activeTimerRef.current != null) window.clearTimeout(activeTimerRef.current);
      if (wheelRafRef.current) cancelAnimationFrame(wheelRafRef.current);
    },
    []
  );

  const showHistoryHud = useCallback(
    (ms = 1600) => {
      if (!enabled) return;
      setHistoryHudUntilTs(Date.now() + Math.max(200, ms));
    },
    [enabled, setHistoryHudUntilTs]
  );

  const holdHistoryHud = useCallback(
    (on) => {
      if (!enabled) return;
      setHistoryHudHold(Boolean(on));
      if (on) showHistoryHud(2200);
    },
    [enabled, setHistoryHudHold, showHistoryHud]
  );

  const updateSelectionFromClientX = useCallback(
    (clientX, rect) => {
      setSelectedOffset(
        computeSelectionOffset(clientX, rect, effectiveOffsetSamples, visibleSamples, sampleSec)
      );
    },
    [effectiveOffsetSamples, visibleSamples, setSelectedOffset, sampleSec]
  );

  const onHistoryPointerDown = useCallback(
    (ev) => {
      if (!enabled) return;
      if (totalSamples <= 0) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      if (ev.button === 0) {
        if (ev.ctrlKey) {
          if (totalSamples <= visibleSamples) return;
          dragModeRef.current = "pan";
          panStartRef.current = { x: ev.clientX, offset: effectiveOffsetSec };
          if (activeTimerRef.current != null) window.clearTimeout(activeTimerRef.current);
          setIsTimeAxisActive(true);
          holdHistoryHud(true);
          showHistoryHud(1600);
          try {
            ev.currentTarget.setPointerCapture(ev.pointerId);
          } catch (_) {}
          return;
        }
        dragModeRef.current = "select";
        holdHistoryHud(true);
        showHistoryHud(1600);
        updateSelectionFromClientX(ev.clientX, rect);
      } else if (ev.button === 2) {
        const nowTs =
          typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
        if (nowTs - lastRightDownTsRef.current <= 320) {
          setHistoryWindowSec(defaultWindowSec);
          setHistoryOffsetSec(0);
          holdHistoryHud(false);
          showHistoryHud(1200);
          lastRightDownTsRef.current = 0;
          return;
        }
        lastRightDownTsRef.current = nowTs;
        if (totalSamples <= visibleSamples) return;
        dragModeRef.current = "pan";
        panStartRef.current = { x: ev.clientX, offset: effectiveOffsetSec };
        if (activeTimerRef.current != null) window.clearTimeout(activeTimerRef.current);
        setIsTimeAxisActive(true);
        holdHistoryHud(true);
        showHistoryHud(1600);
      } else return;
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch (_) {}
    },
    [
      holdHistoryHud,
      showHistoryHud,
      updateSelectionFromClientX,
      setHistoryWindowSec,
      defaultWindowSec,
      setHistoryOffsetSec,
      totalSamples,
      visibleSamples,
      effectiveOffsetSec,
      enabled,
    ]
  );

  const onHistoryPointerMove = useCallback(
    (ev) => {
      if (!enabled) return;
      const mode = dragModeRef.current;
      if (!mode) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      if (mode === "select") {
        showHistoryHud(1600);
        updateSelectionFromClientX(ev.clientX, rect);
        return;
      }
      const dx = ev.clientX - panStartRef.current.x;
      const next = computePanOffset(
        panStartRef.current.offset,
        dx,
        visibleSamples,
        sampleSec,
        rect.width,
        maxOffsetSamples * sampleSec
      );
      setHistoryOffsetSec(next);
      showHistoryHud(1600);
    },
    [
      enabled,
      showHistoryHud,
      updateSelectionFromClientX,
      visibleSamples,
      sampleSec,
      maxOffsetSamples,
      setHistoryOffsetSec,
    ]
  );

  const onHistoryPointerUp = useCallback(
    (ev) => {
      const mode = dragModeRef.current;
      dragModeRef.current = null;
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch (_) {}
      if (!enabled || !mode) return;
      if (mode === "pan") setIsTimeAxisActive(false);
      holdHistoryHud(false);
      showHistoryHud(900);
    },
    [enabled, holdHistoryHud, showHistoryHud]
  );

  const onHistoryWheel = useCallback(
    (ev) => {
      if (!enabled) return;
      if (totalSamples <= 0) return;
      ev.preventDefault();
      showHistoryHud(1600);
      const factor = ev.deltaY < 0 ? 0.85 : 1.18;
      const rect = ev.currentTarget.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const x = Math.max(0, Math.min(width, ev.clientX - rect.left));
      const norm = 1 - x / width;
      const pending = pendingWheelZoomRef.current;
      pendingWheelZoomRef.current = {
        factor: (pending?.factor ?? 1) * factor,
        norm,
      };
      if (wheelRafRef.current) return;
      wheelRafRef.current = requestAnimationFrame(() => {
        wheelRafRef.current = 0;
        const pending = pendingWheelZoomRef.current;
        pendingWheelZoomRef.current = null;
        if (!pending) return;
        const { nextWindowSec, nextOffsetSec } = computeWheelZoom({
          factor: pending.factor,
          norm: pending.norm,
          effectiveOffsetSamples,
          visibleSamples,
          sampleSec,
          minWindowSec,
          maxWindowSec,
          totalSamples,
        });
        setHistoryWindowSec(nextWindowSec);
        setHistoryOffsetSec(nextOffsetSec);
      });
      pulseTimeAxis();
    },
    [
      enabled,
      showHistoryHud,
      effectiveOffsetSamples,
      visibleSamples,
      sampleSec,
      minWindowSec,
      maxWindowSec,
      totalSamples,
      setHistoryWindowSec,
      setHistoryOffsetSec,
      pulseTimeAxis,
    ]
  );

  const zoomTimeFromWheel = useCallback(
    (ev) => {
      showHistoryHud(1600);
      const factor = ev.deltaY < 0 ? 0.85 : 1.18;
      const rect = ev.currentTarget.getBoundingClientRect();
      const width = Math.max(1, rect.width);
      const x = Math.max(0, Math.min(width, ev.clientX - rect.left));
      const norm = 1 - x / width;
      const { nextWindowSec, nextOffsetSec } = computeWheelZoom({
        factor,
        norm,
        effectiveOffsetSamples,
        visibleSamples,
        sampleSec,
        minWindowSec,
        maxWindowSec,
        totalSamples,
      });
      setHistoryWindowSec(nextWindowSec);
      setHistoryOffsetSec(nextOffsetSec);
      pulseTimeAxis();
    },
    [
      effectiveOffsetSamples,
      maxWindowSec,
      minWindowSec,
      sampleSec,
      setHistoryOffsetSec,
      setHistoryWindowSec,
      showHistoryHud,
      totalSamples,
      visibleSamples,
      pulseTimeAxis,
    ]
  );

  const onHistoryTimeAxisWheel = useCallback(
    (ev) => {
      if (!enabled || totalSamples <= 0) return;
      ev.preventDefault();
      zoomTimeFromWheel(ev);
    },
    [enabled, totalSamples, zoomTimeFromWheel]
  );

  const onHistoryTimeAxisPointerDown = useCallback(
    (ev) => {
      if (!enabled || totalSamples <= visibleSamples || ev.button !== 0) return;
      ev.preventDefault();
      timeAxisPanStartRef.current = { x: ev.clientX, offset: effectiveOffsetSec };
      if (activeTimerRef.current != null) window.clearTimeout(activeTimerRef.current);
      setIsTimeAxisActive(true);
      holdHistoryHud(true);
      showHistoryHud(1600);
      try {
        ev.currentTarget.setPointerCapture(ev.pointerId);
      } catch (_) {}
    },
    [effectiveOffsetSec, enabled, holdHistoryHud, showHistoryHud, totalSamples, visibleSamples]
  );

  const onHistoryTimeAxisPointerMove = useCallback(
    (ev) => {
      const start = timeAxisPanStartRef.current;
      if (!enabled || !start) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const next = computePanOffset(
        start.offset,
        ev.clientX - start.x,
        visibleSamples,
        sampleSec,
        rect.width,
        maxOffsetSamples * sampleSec
      );
      setHistoryOffsetSec(next);
      showHistoryHud(1600);
    },
    [enabled, maxOffsetSamples, sampleSec, setHistoryOffsetSec, showHistoryHud, visibleSamples]
  );

  const onHistoryTimeAxisPointerUp = useCallback(
    (ev) => {
      const wasDragging = !!timeAxisPanStartRef.current;
      timeAxisPanStartRef.current = null;
      try {
        ev.currentTarget.releasePointerCapture(ev.pointerId);
      } catch (_) {}
      if (!enabled || !wasDragging) return;
      setIsTimeAxisActive(false);
      holdHistoryHud(false);
      showHistoryHud(900);
    },
    [enabled, holdHistoryHud, showHistoryHud]
  );

  const onHistoryTimeAxisDoubleClick = useCallback(
    (ev) => {
      if (!enabled) return;
      ev.preventDefault();
      setHistoryWindowSec(defaultWindowSec);
      setHistoryOffsetSec(0);
      pulseTimeAxis();
      holdHistoryHud(false);
      showHistoryHud(1200);
    },
    [
      defaultWindowSec,
      enabled,
      holdHistoryHud,
      setHistoryOffsetSec,
      setHistoryWindowSec,
      showHistoryHud,
      pulseTimeAxis,
    ]
  );

  return {
    showHistoryHud,
    holdHistoryHud,
    onHistoryPointerDown,
    onHistoryPointerMove,
    onHistoryPointerUp,
    onHistoryWheel,
    isTimeAxisActive,
    historyTimeAxisHandlers: {
      onWheel: onHistoryTimeAxisWheel,
      onPointerDown: onHistoryTimeAxisPointerDown,
      onPointerMove: onHistoryTimeAxisPointerMove,
      onPointerUp: onHistoryTimeAxisPointerUp,
      onPointerCancel: onHistoryTimeAxisPointerUp,
      onDoubleClick: onHistoryTimeAxisDoubleClick,
    },
  };
}
