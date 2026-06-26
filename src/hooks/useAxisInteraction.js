import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  computeLinearPan,
  computeLinearZoom,
  computeLogPan,
  computeLogZoom,
  pixelToLinearValue,
  pixelToLogValue,
} from "../math/axisInteractionMath";

const ZOOM_IN_FACTOR = 0.85;
const ZOOM_OUT_FACTOR = 1.18;

export function useAxisInteraction({
  axis,
  min,
  max,
  absMin,
  absMax,
  defaultMin,
  defaultMax,
  minSpan,
  scale,
  onRangeChange,
}) {
  const axisRef = useRef(null);
  const dragRef = useRef(null);
  const moveCleanupRef = useRef(null);
  const [axisPx, setAxisPx] = useState(axis === "y" ? 300 : 500);
  const [isDragging, setIsDragging] = useState(false);
  const cursorStyle = axis === "y" ? "ns-resize" : "ew-resize";

  useLayoutEffect(() => {
    const el = axisRef.current;
    if (!el) return undefined;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      const next = axis === "y" ? rect.height : rect.width;
      if (next > 0) setAxisPx(next);
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [axis]);

  useEffect(
    () => () => {
      moveCleanupRef.current?.();
    },
    []
  );

  const onWheel = useCallback(
    (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const el = axisRef.current;
      if (!el || typeof onRangeChange !== "function") return;
      const rect = el.getBoundingClientRect();
      const isY = axis === "y";
      const size = Math.max(1, isY ? rect.height : rect.width);
      const rawPx = isY ? e.clientY - rect.top : e.clientX - rect.left;
      const px = isY ? rawPx : size - rawPx;
      const factor = e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR;
      const next =
        scale === "log"
          ? computeLogZoom({
              min,
              max,
              absMin,
              absMax,
              minOctaves: minSpan,
              anchor: pixelToLogValue(px, size, min, max),
              factor,
            })
          : computeLinearZoom({
              min,
              max,
              absMin,
              absMax,
              minSpan,
              anchor: pixelToLinearValue(px, size, min, max),
              factor,
            });
      onRangeChange(next.min, next.max);
    },
    [absMax, absMin, axis, max, min, minSpan, onRangeChange, scale]
  );

  const onMouseDown = useCallback(
    (e) => {
      if (e.button !== 0 || typeof onRangeChange !== "function") return;
      e.preventDefault();
      const isY = axis === "y";
      dragRef.current = {
        startPx: isY ? e.clientY : e.clientX,
        startMin: min,
        startMax: max,
      };
      setIsDragging(true);

      const onMouseMove = (moveEvent) => {
        const drag = dragRef.current;
        const el = axisRef.current;
        if (!drag || !el) return;
        const rect = el.getBoundingClientRect();
        const size = Math.max(1, isY ? rect.height : rect.width);
        const currentPx = isY ? moveEvent.clientY : moveEvent.clientX;
        const rawDelta = currentPx - drag.startPx;
        const deltaPx = -rawDelta;
        const next =
          scale === "log"
            ? computeLogPan({
                min: drag.startMin,
                max: drag.startMax,
                absMin,
                absMax,
                deltaPx,
                axisPx: size,
              })
            : computeLinearPan({
                min: drag.startMin,
                max: drag.startMax,
                absMin,
                absMax,
                deltaPx,
                axisPx: size,
              });
        onRangeChange(next.min, next.max);
      };

      const cleanup = () => {
        dragRef.current = null;
        setIsDragging(false);
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", cleanup);
        moveCleanupRef.current = null;
      };
      moveCleanupRef.current?.();
      moveCleanupRef.current = cleanup;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", cleanup);
    },
    [absMax, absMin, axis, max, min, onRangeChange, scale]
  );

  const onDoubleClick = useCallback(
    (e) => {
      e.preventDefault();
      onRangeChange?.(defaultMin, defaultMax);
    },
    [defaultMax, defaultMin, onRangeChange]
  );

  return {
    axisRef,
    axisHandlers: { onWheel, onMouseDown, onDoubleClick },
    axisPx,
    cursorStyle,
    isDragging,
  };
}
