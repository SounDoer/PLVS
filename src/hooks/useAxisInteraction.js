import { useCallback, useEffect, useRef, useState } from "react";
import {
  anchorFromPointer,
  applyRangeConstraints,
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
  // See applyRangeConstraints. `pinnedMax` also moves the zoom anchor to the top: zooming around
  // the cursor would fight a bound that cannot move.
  pinnedMax = false,
  mustInclude,
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
        anchor: pinnedMax
          ? max
          : anchorFromPointer({
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
      const bounded = applyRangeConstraints({
        ...next,
        absMin,
        absMax,
        minSpan,
        pinnedMax,
        mustInclude,
      });
      onRangeChange(bounded.min, bounded.max);
      pulseActive();
    },
    [
      absMax,
      absMin,
      axis,
      axisRef,
      max,
      min,
      minSpan,
      mustInclude,
      onRangeChange,
      pinnedMax,
      pulseActive,
      scale,
    ]
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
        // A pinned-max axis cannot be panned: panRange shifts both ends and then clamps the whole
        // window back inside the bounds, which on this axis is a no-op. Move the floor instead, by
        // the same dB the drag covered -- dragging down raises it, as dragging down anywhere else
        // brings higher values into view.
        const next = pinnedMax
          ? {
              min: drag.startMin + (deltaPx / size) * (drag.startMax - drag.startMin),
              max: absMax,
            }
          : panRange({
              min: drag.startMin,
              max: drag.startMax,
              absMin,
              absMax,
              deltaPx,
              axisPx: size,
              scale,
            });
        const bounded = applyRangeConstraints({
          ...next,
          absMin,
          absMax,
          minSpan,
          pinnedMax,
          mustInclude,
        });
        onRangeChange(bounded.min, bounded.max);
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
    [
      absMax,
      absMin,
      axis,
      axisRef,
      holdActive,
      max,
      min,
      minSpan,
      mustInclude,
      onRangeChange,
      pinnedMax,
      releaseActive,
      scale,
    ]
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
