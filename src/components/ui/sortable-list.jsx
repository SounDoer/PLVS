import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Reorder, useDragControls, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

function sameOrder(left, right) {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function SortableRow({ id, pressed, positionalIds, startDrag, children }) {
  const controls = useDragControls();
  const reduceMotion = useReducedMotion();
  return (
    <Reorder.Item
      as="div"
      value={id}
      dragListener={false}
      dragControls={controls}
      layout="position"
      transition={reduceMotion ? { duration: 0 } : undefined}
      {...(positionalIds ? { tabIndex: -1 } : {})}
      data-reorder-pressed={pressed || undefined}
      className={cn("relative min-w-0 rounded-xs", pressed && "ring-1 ring-primary")}
    >
      {children({
        dragging: pressed,
        onPointerDown: (event) => startDrag(id, event, controls),
      })}
    </Reorder.Item>
  );
}

/**
 * Motion owns gesture geometry and layout. A pointer drag only changes the displayed order
 * until release, when the owner receives the final order once.
 * @param {{ ids: string[], onReorder?: (order: string[]) => unknown, renderRow: (id: string, index: number, handle: { dragging: boolean, onPointerDown: (event: import("react").PointerEvent<HTMLButtonElement>) => void }) => import("react").ReactNode, positionalIds?: boolean, className?: string, role?: string, "aria-label"?: string, "data-testid"?: string }} props
 */
export function SortableList({ ids, onReorder, renderRow, positionalIds = false, ...props }) {
  const [preview, setPreview] = useState(null);
  const [pressedId, setPressedId] = useState(null);
  const pointer = useRef(null);
  const owner = useRef({ ids, onReorder });
  const order = preview && sameOrder(preview.base, ids) ? preview.order : ids;

  useLayoutEffect(() => {
    owner.current = { ids, onReorder };
    if (preview && !sameOrder(preview.base, ids)) setPreview(null);
  }, [ids, onReorder, preview]);
  useEffect(() => () => pointer.current?.listeners.abort(), []);

  function commit(next, base) {
    // When IDs are positions, the owner's next render keeps those IDs but moves their content.
    // Keeping our permutation as well would apply the same move twice.
    if (positionalIds) {
      setPreview(null);
      owner.current.onReorder?.(next);
      return;
    }
    const pending = { base, order: next };
    setPreview(pending);
    const restore = () => setPreview((current) => (current === pending ? null : current));
    Promise.resolve(owner.current.onReorder?.(next)).then((result) => {
      if (result === false) restore();
    }, restore);
  }

  function startDrag(id, event, controls) {
    if (event.button !== 0 || event.isPrimary === false || pointer.current) return;
    // Keep a pointer drag from focusing the handle and pinning the row's focus-within actions.
    event.preventDefault();
    const listeners = new AbortController();
    const view = event.currentTarget.ownerDocument.defaultView;
    const session = { listeners, order };
    const pointerId = event.pointerId;
    pointer.current = session;
    setPressedId(id);

    function finish(save) {
      listeners.abort();
      pointer.current = null;
      setPressedId(null);
      if (save && sameOrder(ids, owner.current.ids) && !sameOrder(order, session.order)) {
        commit(session.order, ids);
      } else {
        setPreview(preview);
      }
    }

    // Motion registers its capture listener first and flushes any last move on pointerup.
    controls.start(event);
    const options = { capture: true, signal: listeners.signal };
    view.addEventListener("pointerup", (e) => e.pointerId === pointerId && finish(true), options);
    view.addEventListener(
      "pointercancel",
      (e) => e.pointerId === pointerId && finish(false),
      options
    );
    view.addEventListener(
      "blur",
      () => {
        controls.cancel();
        finish(false);
      },
      { signal: listeners.signal }
    );
  }

  function updateOrder(next) {
    if (!pointer.current) {
      commit(next, ids);
      return;
    }
    pointer.current.order = next;
    setPreview({ base: ids, order: next });
  }

  return (
    <Reorder.Group as="div" axis="y" values={order} onReorder={updateOrder} {...props}>
      {order.map((id, index) => (
        <SortableRow
          key={id}
          id={id}
          pressed={pressedId === id}
          positionalIds={positionalIds}
          startDrag={startDrag}
        >
          {(handle) => renderRow(id, index, handle)}
        </SortableRow>
      ))}
    </Reorder.Group>
  );
}
