import { RESIZE_HANDLE_LINE_CLASS } from "../lib/shellLayout.js";
import { useRef } from "react";
import { getDockPanelSizing } from "./dockPanelSizing.js";

/**
 * @param {{
 *   leftPanel: any,
 *   rightPanel: any,
 *   leftBasis: any,
 *   rightBasis: any,
 *   disabled?: any,
 *   onResize: any,
 *   onReset: any,
 * }} props
 */
export function DockPanelResizeHandle({
  leftPanel,
  rightPanel,
  leftBasis,
  rightBasis,
  disabled = false,
  onResize,
  onReset,
}) {
  const dragRef = useRef(null);
  const handleRef = useRef(null);
  const leftSizing = getDockPanelSizing(leftPanel.moduleId);
  const rightSizing = getDockPanelSizing(rightPanel.moduleId);

  const preferredWidths = () => {
    return {
      leftWidth: leftBasis || leftSizing.defaultWidth,
      rightWidth: rightBasis || rightSizing.defaultWidth,
    };
  };

  const emit = (/** @type {number} */ delta, /** @type {boolean} */ persist, base) => {
    if (disabled || !onResize) return;
    const widths = base ?? preferredWidths();
    onResize({
      leftPanelId: leftPanel.id,
      rightPanelId: rightPanel.id,
      ...widths,
      delta,
      persist,
    });
  };

  function finishDrag() {
    const drag = dragRef.current;
    dragRef.current = null;
    if (handleRef.current) delete handleRef.current.dataset.dragging;
    if (drag) emit(drag.latestDelta, true, drag.widths);
  }

  return (
    <div
      ref={handleRef}
      role="separator"
      aria-label={`Resize ${leftPanel.customTitle ?? leftPanel.moduleId} and ${
        rightPanel.customTitle ?? rightPanel.moduleId
      }`}
      aria-orientation="vertical"
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      data-testid="dock-panel-resize-handle"
      className={
        "group absolute -right-1 top-0 z-10 h-full w-2 touch-none outline-none " +
        (disabled ? "pointer-events-none opacity-0" : "cursor-ew-resize")
      }
      onPointerDown={(event) => {
        if (disabled || event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.dataset.dragging = "true";
        event.currentTarget.setPointerCapture?.(event.pointerId);
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          widths: preferredWidths(),
          latestDelta: 0,
        };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const delta = event.clientX - drag.startX;
        if (delta === drag.latestDelta) return;
        drag.latestDelta = delta;
        emit(delta, false, drag.widths);
      }}
      onPointerUp={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        dragRef.current = null;
        if (handleRef.current) delete handleRef.current.dataset.dragging;
        event.currentTarget.releasePointerCapture?.(event.pointerId);
        emit(drag.latestDelta, true, drag.widths);
      }}
      onPointerCancel={finishDrag}
      onLostPointerCapture={finishDrag}
      onDoubleClick={() => {
        if (!disabled) onReset?.(leftPanel.id, rightPanel.id);
      }}
      onKeyDown={(event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
        event.preventDefault();
        const step = event.shiftKey ? 16 : 4;
        emit(event.key === "ArrowRight" ? step : -step, true);
      }}
    >
      <div
        className={`absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 ${RESIZE_HANDLE_LINE_CLASS}`}
      />
    </div>
  );
}
