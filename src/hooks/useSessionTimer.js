import { useCallback, useEffect, useRef } from "react";

/**
 * @param {number} ms
 */
export function formatClock(ms) {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Session timer driven by rAF. The transport subscribes to whole-second changes, while
 * history snapshots read `elapsedMsRef.current` for subsecond precision.
 */
export function useSessionTimer() {
  const runStartedAtRef = useRef(null);
  const accumulatedMsRef = useRef(0); // ms from previous start/stop cycles
  const rafIdRef = useRef(0);
  const lastTickMsRef = useRef(0);
  const elapsedMsRef = useRef(0); // current total elapsed ms
  const listenersRef = useRef(new Set());
  // Stable wrapper ref so RAF loop can reschedule itself without self-reference in useCallback
  const loopRef = useRef(null);

  const getElapsedSecond = useCallback(() => Math.floor(elapsedMsRef.current / 1000), []);

  const subscribe = useCallback((/** @type {() => void} */ listener) => {
    const listeners = listenersRef.current;
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const updateElapsed = useCallback(
    (/** @type {number} */ elapsedMs) => {
      const previousSecond = getElapsedSecond();
      elapsedMsRef.current = elapsedMs;
      if (getElapsedSecond() !== previousSecond) {
        for (const listener of listenersRef.current) listener();
      }
    },
    [getElapsedSecond]
  );

  useEffect(() => {
    loopRef.current = (/** @type {number} */ now) => {
      rafIdRef.current = requestAnimationFrame(loopRef.current);
      if (now - lastTickMsRef.current < 100) return; // ~10 Hz throttle
      lastTickMsRef.current = now;
      if (runStartedAtRef.current !== null) {
        updateElapsed(accumulatedMsRef.current + (performance.now() - runStartedAtRef.current));
      }
    };
  }, [updateElapsed]);

  const startTimer = useCallback(() => {
    if (runStartedAtRef.current !== null) return; // already running
    runStartedAtRef.current = performance.now();
    lastTickMsRef.current = 0;
    rafIdRef.current = requestAnimationFrame(loopRef.current);
  }, []);

  const stopTimer = useCallback(() => {
    if (runStartedAtRef.current === null) return;
    accumulatedMsRef.current += performance.now() - runStartedAtRef.current;
    runStartedAtRef.current = null;
    cancelAnimationFrame(rafIdRef.current);
    updateElapsed(accumulatedMsRef.current);
  }, [updateElapsed]);

  const resetTimer = useCallback(
    ({ restart = false } = {}) => {
      cancelAnimationFrame(rafIdRef.current);
      accumulatedMsRef.current = 0;
      runStartedAtRef.current = restart ? performance.now() : null;
      lastTickMsRef.current = 0;
      updateElapsed(0);
      if (restart) rafIdRef.current = requestAnimationFrame(loopRef.current);
    },
    [updateElapsed]
  );

  useEffect(() => {
    return () => cancelAnimationFrame(rafIdRef.current);
  }, []);

  return { elapsedMsRef, getElapsedSecond, subscribe, startTimer, stopTimer, resetTimer };
}
