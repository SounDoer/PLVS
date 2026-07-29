import { useCallback, useEffect, useRef, useState } from "react";

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
 *
 * The gesture is driven from `window`, not from the drag handle, and deliberately does not use
 * `setPointerCapture`: React moves the dragged row's own DOM node when it travels downwards
 * (reconciliation moves the out-of-order child), and removing a node implicitly releases its
 * pointer capture. From then on the handle sees nothing -- the pointer is over a gap between
 * rows, or over a sibling button -- so the release never reached `endDrag` and the whole drag
 * was dropped while the list kept showing the order it never committed.
 */
export function usePointerReorder(ids, onReorder) {
  const [orderedIds, setOrderedIds] = useState(ids);
  const [draggingId, setDraggingId] = useState(null);
  const containerRef = useRef(null);
  const orderedIdsRef = useRef(ids);
  const dragStartOrderRef = useRef(ids);
  const draggingIdRef = useRef(null);
  const dragPointerRef = useRef(null);
  const parkedIdsRef = useRef(null);
  const listenersRef = useRef(null);
  const onReorderRef = useRef(onReorder);

  useEffect(() => {
    onReorderRef.current = onReorder;
  }, [onReorder]);

  useEffect(() => {
    // An unrelated store write landing mid-drag (a preset marked dirty, a rename) would reset
    // the order the pointer is producing, and `endDrag` would then find nothing changed since
    // the drag started and drop the gesture. Park it until the drag ends instead.
    if (draggingIdRef.current) {
      parkedIdsRef.current = ids;
      return undefined;
    }
    // Deferred a tick so a drag's own onReorder round-trip (store write -> new `ids` prop)
    // lands after the state the drag just produced, instead of visibly snapping back first.
    const timer = setTimeout(() => {
      orderedIdsRef.current = ids;
      setOrderedIds(ids);
    }, 0);
    return () => clearTimeout(timer);
  }, [ids]);

  const detach = useCallback(() => {
    const listeners = listenersRef.current;
    if (!listeners) return;
    listenersRef.current = null;
    window.removeEventListener("pointermove", listeners.move);
    window.removeEventListener("pointerup", listeners.end);
    window.removeEventListener("pointercancel", listeners.end);
  }, []);

  const moveDrag = useCallback((event) => {
    const activeId = draggingIdRef.current;
    if (!activeId || event.pointerId !== dragPointerRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    const current = orderedIdsRef.current;
    const next = reorderIdsAtPointer(current, activeId, event.clientY, rect);
    if (next === current) return;
    orderedIdsRef.current = next;
    setOrderedIds(next);
  }, []);

  const endDrag = useCallback(
    (event) => {
      if (!draggingIdRef.current || event.pointerId !== dragPointerRef.current) return;
      detach();
      dragPointerRef.current = null;
      draggingIdRef.current = null;
      setDraggingId(null);
      const parkedIds = parkedIdsRef.current;
      parkedIdsRef.current = null;
      if (orderedIdsRef.current.some((id, index) => dragStartOrderRef.current[index] !== id)) {
        onReorderRef.current(orderedIdsRef.current);
      } else if (parkedIds) {
        orderedIdsRef.current = parkedIds;
        setOrderedIds(parkedIds);
      }
    },
    [detach]
  );

  const startDrag = useCallback(
    (id, event) => {
      detach();
      dragStartOrderRef.current = orderedIdsRef.current;
      draggingIdRef.current = id;
      dragPointerRef.current = event.pointerId;
      setDraggingId(id);
      listenersRef.current = { move: moveDrag, end: endDrag };
      window.addEventListener("pointermove", moveDrag);
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    },
    [detach, endDrag, moveDrag]
  );

  useEffect(() => detach, [detach]);

  return { containerRef, orderedIds, draggingId, startDrag };
}
