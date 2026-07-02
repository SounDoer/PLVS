import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const SIDE_CLASSES = {
  bottom: "-translate-x-1/2 mt-1.5",
  right: "-translate-y-1/2 ml-1.5",
};

function getTipPosition(anchor, side) {
  const rect = anchor.getBoundingClientRect();
  if (side === "right") {
    return {
      left: rect.right,
      top: rect.top + rect.height / 2,
    };
  }
  return {
    left: rect.left + rect.width / 2,
    top: rect.bottom,
  };
}

/**
 * Low-level hover-reveal tip: manages the anchor ref, show/hide handlers, and the
 * portal-rendered tip node, without imposing a wrapper element. Use this when the tip's
 * anchor must be an existing element with its own positioning/layout (e.g. an
 * absolutely-positioned marker); otherwise prefer the `HoverTip` wrapper component below.
 *
 * @param {{ tip?: string, side?: "bottom" | "right", tipClassName?: string }} [opts]
 */
export function useHoverTip({ tip, side = "bottom", tipClassName } = {}) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return;
    setPosition(getTipPosition(anchorRef.current, side));
  }, [side]);

  const showTip = useCallback(() => {
    updatePosition();
    setOpen(true);
  }, [updatePosition]);

  const hideTip = useCallback(() => {
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, updatePosition]);

  const tipNode =
    tip && open && position
      ? createPortal(
          <span
            role="tooltip"
            className={cn(
              "fixed z-50 opacity-100 pointer-events-none",
              SIDE_CLASSES[side],
              "transition-opacity duration-100 delay-100",
              "text-[11px] text-foreground bg-popover",
              "border border-white/10 rounded px-2 py-1",
              "whitespace-nowrap shadow-md",
              tipClassName
            )}
            style={{ left: position.left, top: position.top }}
          >
            {tip}
          </span>,
          document.body
        )
      : null;

  return { anchorRef, showTip, hideTip, tipNode };
}

/**
 * Wraps children with a hover-reveal text tip (custom CSS, themed via tokens).
 * The tip is portaled to the document body and fixed-positioned so it does not
 * affect scrollable ancestors or the children's accessible name.
 *
 * @param {{
 *   tip?: string,
 *   side?: "bottom" | "right",
 *   children: import("react").ReactNode,
 *   className?: string,
 *   tipClassName?: string,
 * }} props
 */
export function HoverTip({ tip, side = "bottom", children, className, tipClassName }) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({ tip, side, tipClassName });

  return (
    <div
      ref={anchorRef}
      className={cn("relative", className)}
      onMouseEnter={tip ? showTip : undefined}
      onMouseLeave={tip ? hideTip : undefined}
      onFocus={tip ? showTip : undefined}
      onBlur={tip ? hideTip : undefined}
    >
      {children}
      {tipNode}
    </div>
  );
}
