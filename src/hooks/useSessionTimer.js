import { useCallback, useEffect, useRef } from "react";

function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Session timer driven by rAF, decoupled from React render cycle.
 *
 * Attach `clockRef` to a DOM text node to get ~10Hz clock updates without
 * triggering React re-renders. Read `elapsedMsRef.current` for accumulated ms.
 * Read `canClearRef.current` to gate the Clear button.
 */
export function useSessionTimer() {
  const runStartedAtRef = useRef(null); // Date.now() when last started, null when stopped
  const accumulatedMsRef = useRef(0); // ms from previous start/stop cycles
  const rafIdRef = useRef(0);
  const lastTickMsRef = useRef(0);
  const clockRef = useRef(null); // attach to a DOM text node
  const elapsedMsRef = useRef(0); // current total elapsed ms
  const canClearRef = useRef(false);
  // Stable wrapper ref so RAF loop can reschedule itself without self-reference in useCallback
  const loopRef = useRef(null);

  const updateClockDom = useCallback(() => {
    if (clockRef.current) {
      clockRef.current.textContent = formatClock(elapsedMsRef.current);
    }
  }, []);

  useEffect(() => {
    loopRef.current = (now) => {
      rafIdRef.current = requestAnimationFrame(loopRef.current);
      if (now - lastTickMsRef.current < 100) return; // ~10 Hz throttle
      lastTickMsRef.current = now;
      if (runStartedAtRef.current !== null) {
        elapsedMsRef.current = accumulatedMsRef.current + (Date.now() - runStartedAtRef.current);
        canClearRef.current = true;
        updateClockDom();
      }
    };
  }, [updateClockDom]);

  const startTimer = useCallback(() => {
    if (runStartedAtRef.current !== null) return; // already running
    runStartedAtRef.current = Date.now();
    lastTickMsRef.current = 0;
    rafIdRef.current = requestAnimationFrame(loopRef.current);
  }, []);

  const stopTimer = useCallback(() => {
    if (runStartedAtRef.current === null) return;
    accumulatedMsRef.current += Date.now() - runStartedAtRef.current;
    runStartedAtRef.current = null;
    elapsedMsRef.current = accumulatedMsRef.current;
    canClearRef.current = accumulatedMsRef.current > 0;
    cancelAnimationFrame(rafIdRef.current);
    updateClockDom();
  }, [updateClockDom]);

  const resetTimer = useCallback(({ restart = false } = {}) => {
    cancelAnimationFrame(rafIdRef.current);
    accumulatedMsRef.current = 0;
    elapsedMsRef.current = 0;
    canClearRef.current = false;
    runStartedAtRef.current = restart ? Date.now() : null;
    lastTickMsRef.current = 0;
    if (clockRef.current) clockRef.current.textContent = restart ? formatClock(0) : "";
    if (restart) rafIdRef.current = requestAnimationFrame(loopRef.current);
  }, []);

  useEffect(() => {
    return () => cancelAnimationFrame(rafIdRef.current);
  }, []);

  return { clockRef, elapsedMsRef, canClearRef, startTimer, stopTimer, resetTimer };
}
