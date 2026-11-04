import { useCallback, useRef } from "react";
import { useFloatingPanelHost } from "./FloatingPanelHostContext.jsx";
import { clampPanelPos } from "../lib/dragClamp.js";

export function useFloatingPanelDrag(panelRef, onMove) {
  const dragRef = useRef(null);
  const startDragging = useFloatingPanelHost();

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
      if (startDragging) return;
      const rect = panelRef.current?.getBoundingClientRect();
      if (!rect) return;
      dragRef.current = {
        dx: event.clientX - rect.left,
        dy: event.clientY - rect.top,
        w: rect.width,
        h: rect.height,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [panelRef, startDragging]
  );

  // Native window dragging starts on mousedown, after the WebView has received its mouse press.
  const onMouseDown = useCallback(
    (event) => {
      if (!startDragging || event.button !== 0) return;
      if (
        event.target instanceof Element &&
        event.target.closest("button, input, textarea, select, a, [role=tab]")
      )
        return;
      event.preventDefault();
      void startDragging();
    },
    [startDragging]
  );

  const onPointerMove = useCallback(
    (event) => {
      const drag = dragRef.current;
      if (!drag) return;
      onMove(
        clampPanelPos(
          { x: event.clientX - drag.dx, y: event.clientY - drag.dy },
          { w: drag.w, h: drag.h },
          { w: window.innerWidth, h: window.innerHeight }
        )
      );
    },
    [onMove]
  );

  const endDrag = useCallback(() => {
    dragRef.current = null;
  }, []);

  return {
    onMouseDown,
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
  };
}
