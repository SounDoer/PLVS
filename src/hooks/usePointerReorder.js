import { useEffect, useRef, useState } from "react";

export function reorderIdsAtPointer(ids, activeId, clientY, rect) {
  if (!rect || rect.height <= 0 || !ids.length || !Number.isFinite(clientY)) {
    return ids;
  }
  const from = ids.indexOf(activeId);
  const rowHeight = rect.height / ids.length;
  const to = Math.max(0, Math.min(ids.length - 1, Math.floor((clientY - rect.top) / rowHeight)));
  if (from < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}

/**
 * Pointer-based drag-to-reorder for a vertical list of ids. The caller owns the canonical
 * order (`ids`); this hook tracks the in-progress drag locally and calls `onReorder` with the
 * final order once a drag actually moves something.
 */
export function usePointerReorder(ids, onReorder) {
  const [orderedIds, setOrderedIds] = useState(ids);
  const [draggingId, setDraggingId] = useState(null);
  const containerRef = useRef(null);
  const orderedIdsRef = useRef(ids);
  const dragStartOrderRef = useRef(ids);
  const draggingIdRef = useRef(null);
  const dragPointerRef = useRef(null);

  useEffect(() => {
    // Deferred a tick so a drag's own onReorder round-trip (store write -> new `ids` prop)
    // lands after the state the drag just produced, instead of visibly snapping back first.
    const timer = setTimeout(() => {
      orderedIdsRef.current = ids;
      setOrderedIds(ids);
    }, 0);
    return () => clearTimeout(timer);
  }, [ids]);

  const startDrag = (id, event) => {
    dragStartOrderRef.current = orderedIdsRef.current;
    draggingIdRef.current = id;
    dragPointerRef.current = event.pointerId;
    setDraggingId(id);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event) => {
    const activeId = draggingIdRef.current;
    if (!activeId || event.pointerId !== dragPointerRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const current = orderedIdsRef.current;
    const next = reorderIdsAtPointer(current, activeId, event.clientY, rect);
    if (next === current) return;
    orderedIdsRef.current = next;
    setOrderedIds(next);
  };

  const endDrag = (event) => {
    if (!draggingIdRef.current || event.pointerId !== dragPointerRef.current) return;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    dragPointerRef.current = null;
    draggingIdRef.current = null;
    setDraggingId(null);
    if (orderedIdsRef.current.some((id, index) => dragStartOrderRef.current[index] !== id)) {
      onReorder(orderedIdsRef.current);
    }
  };

  return { containerRef, orderedIds, draggingId, startDrag, moveDrag, endDrag };
}
