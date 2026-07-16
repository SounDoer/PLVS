import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

const VIEWPORT_MARGIN = 8;
const TIP_GAP = 6;

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function getTipPosition(anchor, tip, side, align) {
  const rect = anchor.getBoundingClientRect();
  const tipWidth = tip?.offsetWidth ?? 0;
  const tipHeight = tip?.offsetHeight ?? 0;
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const alignedLeft =
    align === "start"
      ? rect.left
      : align === "end"
        ? rect.right - tipWidth
        : rect.left + rect.width / 2 - tipWidth / 2;
  const alignedTop =
    align === "start"
      ? rect.top
      : align === "end"
        ? rect.bottom - tipHeight
        : rect.top + rect.height / 2 - tipHeight / 2;

  if (side === "right") {
    return {
      left: clamp(
        rect.right + TIP_GAP,
        VIEWPORT_MARGIN,
        viewportWidth - tipWidth - VIEWPORT_MARGIN
      ),
      top: clamp(alignedTop, VIEWPORT_MARGIN, viewportHeight - tipHeight - VIEWPORT_MARGIN),
    };
  }
  if (side === "left") {
    return {
      left: clamp(
        rect.left - tipWidth - TIP_GAP,
        VIEWPORT_MARGIN,
        viewportWidth - tipWidth - VIEWPORT_MARGIN
      ),
      top: clamp(alignedTop, VIEWPORT_MARGIN, viewportHeight - tipHeight - VIEWPORT_MARGIN),
    };
  }
  if (side === "top") {
    return {
      left: clamp(alignedLeft, VIEWPORT_MARGIN, viewportWidth - tipWidth - VIEWPORT_MARGIN),
      top: clamp(
        rect.top - tipHeight - TIP_GAP,
        VIEWPORT_MARGIN,
        viewportHeight - tipHeight - VIEWPORT_MARGIN
      ),
    };
  }
  return {
    left: clamp(alignedLeft, VIEWPORT_MARGIN, viewportWidth - tipWidth - VIEWPORT_MARGIN),
    top: clamp(
      rect.bottom + TIP_GAP,
      VIEWPORT_MARGIN,
      viewportHeight - tipHeight - VIEWPORT_MARGIN
    ),
  };
}

/**
 * Low-level hover-reveal tip: manages the anchor ref, show/hide handlers, and the
 * portal-rendered tip node, without imposing a wrapper element. Use this when the tip's
 * anchor must be an existing element with its own positioning/layout (e.g. an
 * absolutely-positioned marker); otherwise prefer the `HoverTip` wrapper component below.
 *
 * @param {{ tip?: string, side?: "bottom" | "top" | "left" | "right", align?: "start" | "center" | "end", tipClassName?: string }} [opts]
 */
export function useHoverTip({ tip, side = "bottom", align = "center", tipClassName } = {}) {
  const anchorRef = useRef(null);
  const tipRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  const updatePosition = useCallback(() => {
    if (!anchorRef.current) return;
    setPosition(getTipPosition(anchorRef.current, tipRef.current, side, align));
  }, [align, side]);

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

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, tip, updatePosition]);

  const tipNode =
    tip && open && position
      ? createPortal(
          <span
            ref={tipRef}
            role="tooltip"
            className={cn(
              "fixed z-50 opacity-100 pointer-events-none",
              "transition-opacity duration-100 delay-100",
              "text-[length:var(--ui-fs-axis)] text-foreground bg-popover",
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
 *   side?: "bottom" | "top" | "left" | "right",
 *   align?: "start" | "center" | "end",
 *   children: import("react").ReactNode,
 *   className?: string,
 *   tipClassName?: string,
 * }} props
 */
export function HoverTip({
  tip,
  side = "bottom",
  align = "center",
  children,
  className,
  tipClassName,
}) {
  const { anchorRef, showTip, hideTip, tipNode } = useHoverTip({
    tip,
    side,
    align,
    tipClassName,
  });

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
