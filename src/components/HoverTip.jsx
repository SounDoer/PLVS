import { cn } from "@/lib/utils";

const SIDE_CLASSES = {
  bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
  right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
};

/**
 * Wraps children with a hover-reveal text tip (custom CSS, themed via tokens).
 * The tip is an absolutely-positioned sibling of the children, so it does NOT
 * affect the children's accessible name. It is not portaled, so an ancestor with
 * `overflow` will clip it — choose `side`/`tipClassName` accordingly.
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
  return (
    <div className={cn("relative group", className)}>
      {children}
      {tip && (
        <span
          role="tooltip"
          className={cn(
            "absolute z-50",
            SIDE_CLASSES[side],
            "opacity-0 pointer-events-none group-hover:opacity-100",
            "transition-opacity duration-100 delay-100",
            "text-[11px] text-foreground bg-popover",
            "border border-white/10 rounded px-2 py-1",
            "whitespace-nowrap shadow-md",
            tipClassName
          )}
        >
          {tip}
        </span>
      )}
    </div>
  );
}
