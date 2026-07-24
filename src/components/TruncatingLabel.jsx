import { useTruncationTip } from "@/components/HoverTip";
import { cn } from "@/lib/utils";

/**
 * A single-line label that truncates with an ellipsis and reveals its full text in a themed hover
 * tip -- but only when it is actually clipped. Use it for names in `w-max` panels that grow to a
 * capped width and then have to cut long names off.
 *
 * @param {{ text: string, className?: string, side?: "top" | "bottom" | "left" | "right", align?: "start" | "center" | "end" }} props
 */
export function TruncatingLabel({ text, className, side = "top", align = "start" }) {
  const { anchorRef, showIfClipped, hideTip, tipNode } = useTruncationTip({
    tip: text,
    side,
    align,
  });
  return (
    <span
      ref={anchorRef}
      onMouseEnter={() => showIfClipped()}
      onMouseLeave={hideTip}
      className={cn("truncate", className)}
    >
      {text}
      {tipNode}
    </span>
  );
}
