import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const SELECTION_EDGE_FADE_PERCENT = 22;
const SELECTION_EDGE_LINE_CLASS = "border-current/60";

/** Points toward the globally selected sample when it is outside this panel's time window. */
/** @param {{ direction: string, className?: string, color?: string }} props */
export function TimelineSelectionEdgeHint({
  direction,
  className,
  color = "var(--ui-loudness-selection)",
}) {
  if (!["left", "right", "top", "bottom"].includes(direction)) return null;

  const pointsLeft = direction === "left";
  const vertical = direction === "top" || direction === "bottom";
  const Icon =
    direction === "top"
      ? ChevronUp
      : direction === "bottom"
        ? ChevronDown
        : pointsLeft
          ? ChevronLeft
          : ChevronRight;

  return (
    <div
      data-testid="timeline-selection-edge-hint"
      data-direction={direction}
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute z-20",
        vertical ? "inset-x-0 h-4" : "inset-y-0 w-4",
        vertical ? (direction === "top" ? "top-0" : "bottom-0") : pointsLeft ? "left-0" : "right-0",
        className
      )}
      style={{ color }}
    >
      <div
        className="absolute inset-0"
        style={{
          background: vertical
            ? `linear-gradient(to ${direction === "top" ? "bottom" : "top"}, color-mix(in srgb, currentColor ${SELECTION_EDGE_FADE_PERCENT}%, transparent), transparent)`
            : pointsLeft
              ? `linear-gradient(to right, color-mix(in srgb, currentColor ${SELECTION_EDGE_FADE_PERCENT}%, transparent), transparent)`
              : `linear-gradient(to left, color-mix(in srgb, currentColor ${SELECTION_EDGE_FADE_PERCENT}%, transparent), transparent)`,
        }}
      />
      <div
        className={cn(
          "absolute border-dashed",
          vertical ? "inset-x-0" : "inset-y-0",
          SELECTION_EDGE_LINE_CLASS,
          vertical
            ? direction === "top"
              ? "top-0 border-t"
              : "bottom-0 border-b"
            : pointsLeft
              ? "left-0 border-l"
              : "right-0 border-r"
        )}
      />
      <Icon className="absolute left-1/2 top-1/2 size-3.5 -translate-x-1/2 -translate-y-1/2" />
    </div>
  );
}
