import { useCallback, useRef, useState } from "react";

export function useChartHover(computeFn) {
  const computeRef = useRef(computeFn);
  computeRef.current = computeFn;
  const [hover, setHover] = useState(null);
  const onMove = useCallback((clientX, clientY, rect) => {
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    const xFrac = Math.max(0, Math.min(1, (clientX - rect.left) / w));
    const yFrac = Math.max(0, Math.min(1, (clientY - rect.top) / h));
    setHover(computeRef.current(xFrac, yFrac));
  }, []);
  const onLeave = useCallback(() => setHover(null), []);
  return { hover, onMove, onLeave };
}
