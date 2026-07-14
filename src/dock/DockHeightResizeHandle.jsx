import { useRef } from "react";
import {
  DOCK_DEFAULT_HEIGHT,
  DOCK_MAX_HEIGHT,
  DOCK_MIN_HEIGHT,
  clampDockHeight,
  dockHeightFromPointer,
  dockHeightKeyboardDelta,
} from "./dockSizing.js";
import { cn } from "@/lib/utils";

export function DockHeightResizeHandle({ edge, height, disabled = false, onHeightChange }) {
  const dragRef = useRef(null);
  const frameRef = useRef(null);
  const currentHeight = clampDockHeight(height);

  const commit = (nextHeight, persist) => {
    if (disabled || !onHeightChange) return;
    void Promise.resolve(onHeightChange(clampDockHeight(nextHeight), { persist })).catch(() => {});
  };

  return (
    <div
      role="separator"
      aria-label="Resize Dock height"
      aria-orientation="horizontal"
      aria-valuemin={DOCK_MIN_HEIGHT}
      aria-valuemax={DOCK_MAX_HEIGHT}
      aria-valuenow={currentHeight}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-testid="dock-height-resize-handle"
      className={cn(
        "group absolute left-0 right-0 z-20 h-2 touch-none outline-none",
        edge === "top" ? "bottom-0" : "top-0",
        disabled ? "pointer-events-none opacity-0" : "cursor-ns-resize"
      )}
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startY: event.clientY,
          startHeight: currentHeight,
          latestHeight: currentHeight,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const nextHeight = dockHeightFromPointer({
          edge,
          startHeight: drag.startHeight,
          startY: drag.startY,
          currentY: event.clientY,
        });
        if (nextHeight === drag.latestHeight) return;
        drag.latestHeight = nextHeight;
        if (frameRef.current !== null) return;
        frameRef.current = requestAnimationFrame(() => {
          frameRef.current = null;
          const activeDrag = dragRef.current;
          if (activeDrag) commit(activeDrag.latestHeight, false);
        });
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        commit(drag.latestHeight, true);
      }}
      onPointerCancel={() => {
        const drag = dragRef.current;
        dragRef.current = null;
        if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
        if (drag) commit(drag.latestHeight, true);
      }}
      onDoubleClick={() => commit(DOCK_DEFAULT_HEIGHT, true)}
      onKeyDown={(event) => {
        const step = event.shiftKey ? 16 : 4;
        const delta = dockHeightKeyboardDelta(edge, event.key, step);
        if (!delta) return;
        event.preventDefault();
        commit(currentHeight + delta, true);
      }}
    >
      <div
        className={cn(
          "absolute left-0 right-0 h-px bg-border/40 transition-colors",
          "group-hover:bg-primary/70 group-focus-visible:bg-primary",
          edge === "top" ? "bottom-0" : "top-0"
        )}
      />
    </div>
  );
}
