import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const NO_HOVER = { move: null, refreshKey: undefined, hover: null };

export function useChartHover(computeFn, refreshKey) {
  const computeRef = useRef(computeFn);
  const refreshKeyRef = useRef(refreshKey);
  const rafRef = useRef(0);
  const pendingMoveRef = useRef(null);
  useLayoutEffect(() => {
    computeRef.current = computeFn;
    refreshKeyRef.current = refreshKey;
  }, [computeFn, refreshKey]);
  const [probe, setProbe] = useState(NO_HOVER);

  // Refreshed while rendering, not from an effect. Live panels change the key on every frame, and
  // an effect would answer each one with a state update of its own: a second commit per frame,
  // and, once frames arrive faster than those commits can be rendered apart, React's "Maximum
  // update depth exceeded". A state update during render restarts this render instead.
  if (probe.move && !Object.is(probe.refreshKey, refreshKey)) {
    setProbe({
      move: probe.move,
      refreshKey,
      hover: refreshKey == null ? probe.hover : computeFn(probe.move.xFrac, probe.move.yFrac),
    });
  }

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      // Refs survive a StrictMode or Fast Refresh remount. A cancelled id left here makes `onMove`
      // treat a frame as pending forever, and hover stops updating.
      rafRef.current = 0;
    },
    []
  );

  const onMove = useCallback(
    (/** @type {number} */ clientX, /** @type {number} */ clientY, rect) => {
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      const xFrac = Math.max(0, Math.min(1, (clientX - rect.left) / w));
      const yFrac = Math.max(0, Math.min(1, (clientY - rect.top) / h));
      pendingMoveRef.current = { xFrac, yFrac };
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const pendingMove = pendingMoveRef.current;
        pendingMoveRef.current = null;
        if (!pendingMove) return;
        setProbe({
          move: pendingMove,
          refreshKey: refreshKeyRef.current,
          hover: computeRef.current(pendingMove.xFrac, pendingMove.yFrac),
        });
      });
    },
    []
  );

  const onLeave = useCallback(() => {
    pendingMoveRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setProbe(NO_HOVER);
  }, []);
  return { hover: probe.hover, onMove, onLeave };
}
