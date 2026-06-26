import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export function useChartHover(computeFn, refreshKey) {
  const computeRef = useRef(computeFn);
  const rafRef = useRef(0);
  const pendingMoveRef = useRef(null);
  const lastMoveRef = useRef(null);
  useLayoutEffect(() => {
    computeRef.current = computeFn;
  }, [computeFn]);
  const [hover, setHover] = useState(null);

  useEffect(
    () => () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    },
    []
  );

  const onMove = useCallback((clientX, clientY, rect) => {
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
      lastMoveRef.current = pendingMove;
      setHover(computeRef.current(pendingMove.xFrac, pendingMove.yFrac));
    });
  }, []);

  useEffect(() => {
    if (refreshKey == null) return;
    const lastMove = lastMoveRef.current;
    if (!lastMove) return;
    setHover(computeRef.current(lastMove.xFrac, lastMove.yFrac));
  }, [refreshKey]);

  const onLeave = useCallback(() => {
    pendingMoveRef.current = null;
    lastMoveRef.current = null;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
    setHover(null);
  }, []);
  return { hover, onMove, onLeave };
}
