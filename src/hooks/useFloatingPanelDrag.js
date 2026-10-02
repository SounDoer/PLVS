import { useCallback, useRef } from "react";
import { clampPanelPos } from "../lib/dragClamp.js";

export function useFloatingPanelDrag(panelRef, onMove) {
  const dragRef = useRef(null);

  const onPointerDown = useCallback(
    (event) => {
      if (event.button !== 0) return;
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
    [panelRef]
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
    onPointerDown,
    onPointerMove,
    onPointerUp: endDrag,
    onPointerCancel: endDrag,
    onLostPointerCapture: endDrag,
  };
}
