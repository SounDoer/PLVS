import { useCallback, useEffect, useRef, useState } from "react";
import {
  anchorFromPointer,
  panRange,
  zoomRange,
  ZOOM_IN_FACTOR,
  ZOOM_OUT_FACTOR,
} from "../math/axisInteractionMath";
import { useAxisActivePulse } from "./useAxisActivePulse";
import { useAxisSize } from "./useAxisSize";

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
  const { axisRef, axisPx } = useAxisSize(axis);
  const dragRef = useRef(null);
  const moveCleanupRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const {
    active: isActive,
    pulse: pulseActive,
    hold: holdActive,
    release: releaseActive,
  } = useAxisActivePulse();
  const cursorStyle = axis === "y" ? "ns-resize" : "ew-resize";

  useEffect(() => () => moveCleanupRef.current?.(), []);

  const onWheel = useCallback(
    (e) => {
      e.preventDefault();
      const el = axisRef.current;
      if (!el || typeof onRangeChange !== "function") return;
      const rect = el.getBoundingClientRect();
      const next = zoomRange({
        min,
        max,
        absMin,
        absMax,
        minSpan,
        scale,
        anchor: anchorFromPointer({
          rect,
          clientX: e.clientX,
          clientY: e.clientY,
          axis,
          scale,
          min,
          max,
        }),
        factor: e.deltaY > 0 ? ZOOM_OUT_FACTOR : ZOOM_IN_FACTOR,
      });
      onRangeChange(next.min, next.max);
      pulseActive();
    },
    [absMax, absMin, axis, axisRef, max, min, minSpan, onRangeChange, pulseActive, scale]
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
      holdActive();

      const onMouseMove = (moveEvent) => {
        const drag = dragRef.current;
        const el = axisRef.current;
        if (!drag || !el) return;
        const rect = el.getBoundingClientRect();
        const size = Math.max(1, isY ? rect.height : rect.width);
        const currentPx = isY ? moveEvent.clientY : moveEvent.clientX;
        const rawDelta = currentPx - drag.startPx;
        const deltaPx = isY ? rawDelta : -rawDelta;
        const next = panRange({
          min: drag.startMin,
          max: drag.startMax,
          absMin,
          absMax,
          deltaPx,
          axisPx: size,
          scale,
        });
        onRangeChange(next.min, next.max);
      };

      const cleanup = () => {
        dragRef.current = null;
        setIsDragging(false);
        releaseActive();
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", cleanup);
        moveCleanupRef.current = null;
      };
      moveCleanupRef.current?.();
      moveCleanupRef.current = cleanup;
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", cleanup);
    },
    [absMax, absMin, axis, axisRef, holdActive, max, min, onRangeChange, releaseActive, scale]
  );

  const onDoubleClick = useCallback(
    (e) => {
      e.preventDefault();
      onRangeChange?.(defaultMin, defaultMax);
      pulseActive();
    },
    [defaultMax, defaultMin, onRangeChange, pulseActive]
  );

  return {
    axisRef,
    axisHandlers: {
      onWheel,
      onMouseDown,
      onDoubleClick,
      onMouseEnter: () => setIsHovered(true),
      onMouseLeave: () => setIsHovered(false),
    },
    axisPx,
    cursorStyle,
    isActive: isActive || isDragging,
    isDragging,
    isHovered,
  };
}
